require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { errorHandler, requestId, notFoundHandler } = require('./middleware/error');
const { reportPaymentConfig } = require('./config/paymentConfig');
const { reportWhatsAppConfig } = require('./config/whatsappConfig');
const { startBackupScheduler, updateActivity, forceBackup } = require('./autoBackup');
const { initializeSocket } = require('./socketHandler');
const Order = require('./models/Order');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

// Production-safe logger
const log = {
    info: (...args) => { if (!isProd) console.log('[INFO]', ...args); },
    error: (...args) => console.error('[ERROR]', ...args),
    warn: (...args) => { if (!isProd) console.warn('[WARN]', ...args); }
};

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);

// Trust proxy - Required for Render and rate limiting
app.set('trust proxy', 1);

// ============================================
// STATIC ASSETS (must be BEFORE helmet to avoid CORP blocking)
// ============================================

// Serve uploaded images (products, categories) with cross-origin headers
// This MUST come before helmet() because Helmet sets Cross-Origin-Resource-Policy: same-origin
// which blocks cross-origin image loads from the frontend (Vercel) to backend (Render)
app.use('/assets/images', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24hr cache
    next();
}, express.static(path.join(__dirname, '../../assets/images')));

// ============================================
// SECURITY & PERFORMANCE MIDDLEWARE
// ============================================

// Compression (gzip) — must be before routes
app.use(compression());

// Helmet — security headers with CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", process.env.FRONTEND_URL || "https://www.artevamaisonkw.com", "https://*.onrender.com", "wss://*.onrender.com"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false, // Allow cross-origin images
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// Rate limiting — skip in dev or when request originates from localhost / 127.0.0.1
const skipRateLimit = (req) => {
    if (!isProd) return true;
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const host = req.headers.host || '';
    if (ip.includes('127.0.0.1') || ip.includes('::1') || ip === '::ffff:127.0.0.1' || host.includes('localhost')) {
        return true;
    }
    return false;
};

// General API — 300 req / 15 min in production
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    skip: skipRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' }
});

// Auth routes — stricter (30 attempts / 15 min) to deter brute force
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    skip: skipRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts, please try again later.' }
});

// Payment routes — tightest limit to prevent abuse
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    skip: skipRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many payment attempts, please try again later.' }
});

// CORS configuration
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = [
            process.env.FRONTEND_URL,
            'https://artevamaisonkw.com',
            'https://www.artevamaisonkw.com',
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'http://localhost:3000',
            'http://127.0.0.1:3000'
        ];

        // Allow requests with no origin (mobile apps, Postman, server-to-server)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 || origin === 'https://arteva-maison-frontend.vercel.app' || origin.includes('localhost') || origin.includes('127.0.0.1')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};

// Initialize Socket.IO with the HTTP server
const io = initializeSocket(server, corsOptions);
app.locals.io = io;

app.use(cors(corsOptions));

// Correlation id — echoed in every error body and log line
app.use(requestId);

// Body parser with size limits.
// The raw buffer is kept for /api/meta/* only: Meta signs its webhooks with an
// HMAC over the exact bytes it sent, so a re-serialised body cannot be
// verified. Holding it for every route would be a needless copy per request.
app.use(express.json({
    limit: '10kb',
    verify: (req, res, buf) => {
        if (req.originalUrl.startsWith('/api/meta/')) req.rawBody = buf;
    },
}));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// NoSQL injection prevention — strips $-prefixed and dotted keys from bodies.
// Express 5 makes req.query/req.params read-only, which is why this is a local
// middleware rather than express-mongo-sanitize (that package mutates them and
// throws on Express 5).
const sanitizeRequest = require('./middleware/sanitize');
app.use(sanitizeRequest);
// Per-route input validation lives in src/validators and is applied through
// src/middleware/validate.js. Coverage is partial — see AUDIT.md.

// Logging — only in development
if (!isProd) {
    const morgan = require('morgan');
    app.use(morgan('dev'));
}

// Track user activity for smart backups (silent)
app.use((req, res, next) => {
    updateActivity();
    next();
});

// ============================================
// API ROUTES
// ============================================

/* Auth routes with stricter rate limiting.
 *
 * /refresh is exempt. It is not an attack surface the way /login is — the
 * refresh token IS the credential, so there is nothing to guess — and it fires
 * on a schedule the user does not control. A shop where several staff share an
 * outbound IP would otherwise burn the 30-per-15-minutes budget on routine
 * session renewals and lock everyone out of the dashboard, which is the exact
 * symptom this work is meant to remove. It gets its own, looser limit. */
const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    skip: skipRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many refresh attempts, please try again shortly.' }
});

app.use('/api/auth/refresh', refreshLimiter, require('./routes/auth'));
app.use('/api/auth', authLimiter, require('./routes/auth'));

// Standard API routes
app.use('/api/products', apiLimiter, require('./routes/products'));
app.use('/api/categories', apiLimiter, require('./routes/categories'));
app.use('/api/cart', apiLimiter, require('./routes/cart'));
app.use('/api/orders', apiLimiter, require('./routes/orders'));
app.use('/api/payments', paymentLimiter, require('./routes/payments'));
app.use('/api/contact', apiLimiter, require('./routes/contact'));
app.use('/api/delivery', apiLimiter, require('./routes/delivery'));
// Mounted ahead of the general /api/admin router so the promo-code paths are
// resolved by their own router rather than falling through it.
app.use('/api/admin/promo-codes', apiLimiter, require('./routes/promoCodes'));
app.use('/api/admin', apiLimiter, require('./routes/admin'));
app.use('/api/driver', apiLimiter, require('./routes/driver'));
app.use('/api/images', apiLimiter, require('./routes/images'));
app.use('/api/hero', apiLimiter, require('./routes/hero'));
app.use('/api/push', apiLimiter, require('./routes/pushRoutes'));
// Same router is also mounted at /api/admin/promo-codes above — one set of
// handlers and one set of guards, addressable from either prefix. The
// admin-only endpoints carry `admin` middleware inside the router, so the
// alias grants no extra access.
app.use('/api/promo-codes', apiLimiter, require('./routes/promoCodes'));
app.use('/api/whatsapp', apiLimiter, require('./routes/whatsapp'));
// Meta: catalogue feed, WhatsApp Cloud API webhook, integration status
app.use('/api/meta', apiLimiter, require('./routes/meta'));

// Site Visit Tracking — lightweight public endpoint (no auth required)
app.post('/api/site-visit', apiLimiter, async (req, res) => {
    try {
        const SiteVisit = require('./models/SiteVisit');
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.headers['x-real-ip']
            || req.connection?.remoteAddress
            || req.ip
            || 'unknown';
        const userAgent = req.headers['user-agent'] || '';
        const referrer = req.headers['referer'] || req.headers['referrer'] || '';
        const page = req.body?.page || '/';
        const today = new Date().toISOString().split('T')[0];

        await SiteVisit.findOneAndUpdate(
            { ip, date: today },
            { $setOnInsert: { ip, date: today, userAgent, referrer, page } },
            { upsert: true, new: false }
        );

        res.json({ success: true });
    } catch (e) {
        // Duplicate key = already tracked today, silently succeed
        if (e.code === 11000) return res.json({ success: true });
        res.json({ success: true }); // Never fail — tracking is non-critical
    }
});

// Health check (no rate limiting)
// Surfaces payment gateway readiness so a misconfigured key is visible from
// monitoring rather than only when a shopper reaches checkout.
app.get('/api/health', (req, res) => {
    const { getMyFatoorahStatus, getDeemaStatus } = require('./config/paymentConfig');
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        socketConnected: !!io,
        gateways: {
            myfatoorah: getMyFatoorahStatus().configured,
            deema: getDeemaStatus().configured
        }
    });
});

// 404 handler — same JSON shape as real errors
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// ============================================
// PROCESS ERROR HANDLERS
// ============================================
process.on('unhandledRejection', (reason) => {
    log.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error);
    // Give time for logging, then exit gracefully
    setTimeout(() => process.exit(1), 1000);
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
    log.info(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);

    // Report payment gateway readiness at boot. Always logged (including in
    // production) — a placeholder API key is the kind of thing that must be
    // loud, not discovered when a customer fails to check out.
    reportPaymentConfig(console);

    /* Say plainly at boot whether WhatsApp can actually send and receive.
     * A half-configured integration that only reveals itself when an order
     * confirmation quietly fails is worse than one that is obviously off. */
    reportWhatsAppConfig();

    // Email service initializes automatically on module load
    // (see emailService.js - Resend API, initializes on require())

    // Clean up expired payment orders (awaiting_payment older than 1 hour)
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const result = await Order.updateMany(
            {
                paymentStatus: 'awaiting_payment',
                createdAt: { $lt: oneHourAgo }
            },
            {
                $set: {
                    paymentStatus: 'payment_expired',
                    orderStatus: 'cancelled',
                    notes: 'Payment not completed within 1 hour — automatically expired'
                }
            }
        );
        if (result.modifiedCount > 0) {
            console.log(`🧹 Expired ${result.modifiedCount} abandoned payment orders`);
        }
    } catch (err) {
        console.error('Failed to clean up expired orders:', err.message);
    }

    // Start automatic backup scheduler
    startBackupScheduler();

    // Promo code auto-expiry system — check every 5 minutes
    setInterval(async () => {
        try {
            const PromoCode = require('./models/PromoCode');
            const result = await PromoCode.updateMany(
                {
                    isActive: true,
                    expiresAt: { $lt: new Date() }
                },
                { $set: { isActive: false } }
            );
            if (result.modifiedCount > 0) {
                console.log(`[PROMO] 🕐 Auto-expired ${result.modifiedCount} promo code(s)`);
            }
        } catch (err) {
            // Silent — promo expiry is not critical
        }
    }, 5 * 60 * 1000); // Every 5 minutes

    // Keep-alive self-ping every 14 minutes (Render free-tier)
    // Pauses between 4:00-4:59 AM Kuwait time (UTC+3) to save ~31 hrs/month
    if (isProd) {
        const PING_INTERVAL = 14 * 60 * 1000;
        const SLEEP_HOUR = 4; // 4 AM Kuwait time — lowest traffic hour
        const KUWAIT_OFFSET = 3; // UTC+3
        const backendUrl = process.env.RENDER_EXTERNAL_URL || 'https://arteva-maison-backend-gy1x.onrender.com';

        setInterval(() => {
            // Get current hour in Kuwait time (UTC+3)
            const now = new Date();
            const kuwaitHour = (now.getUTCHours() + KUWAIT_OFFSET) % 24;

            if (kuwaitHour === SLEEP_HOUR) {
                // Skip ping — let Render auto-sleep the service
                return;
            }

            const url = `${backendUrl}/api/health`;
            const lib = url.startsWith('https') ? require('https') : require('http');
            lib.get(url, () => { }).on('error', () => { });
        }, PING_INTERVAL);
    }
});

module.exports = { app, server, io };
