require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const connectDB = require('./config/db');
const { errorHandler } = require('./middleware/error');
const { startBackupScheduler, updateActivity, forceBackup } = require('./autoBackup');
const { initializeSocket } = require('./socketHandler');
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

// Rate limiting — general API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' }
});

// Stricter rate limiting — auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts, please try again later.' }
});

// CORS configuration
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = [
            process.env.FRONTEND_URL,
            'https://artevamaisonkw.com',
            'https://www.artevamaisonkw.com'
        ];

        // Allow requests with no origin (mobile apps, Postman, server-to-server)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app')) {
            callback(null, true);
        } else if (!isProd && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
            // Only allow localhost in development
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

// Body parser with size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// NoSQL injection prevention - DISABLED temporarily due to Express 5.x incompatibility
// TODO: Re-enable with Express 5.x compatible version or alternative solution
// app.use(mongoSanitize({
//     replaceWith: '_',
//     onSanitize: ({ req, key }) => {
//         console.warn(`Sanitized key: ${key}`);
//     }
// }));

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

// Auth routes with stricter rate limiting
app.use('/api/auth', authLimiter, require('./routes/auth'));

// Standard API routes
app.use('/api/products', apiLimiter, require('./routes/products'));
app.use('/api/categories', apiLimiter, require('./routes/categories'));
app.use('/api/cart', apiLimiter, require('./routes/cart'));
app.use('/api/orders', apiLimiter, require('./routes/orders'));
app.use('/api/payments', apiLimiter, require('./routes/payments'));
app.use('/api/contact', apiLimiter, require('./routes/contact'));
app.use('/api/delivery', apiLimiter, require('./routes/delivery'));
app.use('/api/admin', apiLimiter, require('./routes/admin'));
app.use('/api/driver', apiLimiter, require('./routes/driver'));

// Health check (no rate limiting)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        socketConnected: !!io
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

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

    // Lazy-load and initialize email service
    const { initializeEmailService } = require('./services/emailService');
    await initializeEmailService();

    // Start automatic backup scheduler
    startBackupScheduler();

    // Keep-alive self-ping every 14 minutes (Render free-tier)
    if (isProd) {
        const PING_INTERVAL = 14 * 60 * 1000;
        const backendUrl = process.env.RENDER_EXTERNAL_URL || 'https://arteva-maison-backend-gy1x.onrender.com';

        setInterval(() => {
            const url = `${backendUrl}/api/health`;
            const lib = url.startsWith('https') ? require('https') : require('http');
            lib.get(url, () => { }).on('error', () => { });
        }, PING_INTERVAL);
    }
});

module.exports = { app, server, io };
