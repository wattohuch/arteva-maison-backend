require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { errorHandler } = require('./middleware/error');
const { startBackupScheduler, updateActivity, forceBackup } = require('./autoBackup');
const { initializeSocket } = require('./socketHandler');
const path = require('path');

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);

// Serve static assets (for email images)
// Protect backend files
app.use('/backend', (req, res) => res.status(403).send('Access Denied'));

// Serve static assets and frontend files
app.use(express.static(path.join(__dirname, '../../')));

// CORS configuration - shared between Express and Socket.IO
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = [
            process.env.FRONTEND_URL,
            'https://artevamaisonkw.com',
            'https://www.artevamaisonkw.com'
        ];

        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 ||
            origin.endsWith('.vercel.app') ||
            origin.includes('localhost') ||
            origin.includes('127.0.0.1')) {
            callback(null, true);
        } else {
            console.log('Blocked by CORS:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};

// Initialize Socket.IO with the HTTP server
const io = initializeSocket(server, corsOptions);

// Make io available to routes via app.locals
app.locals.io = io;

// Security middleware
app.use(helmet());

// CORS - Allow your website
app.use(cors(corsOptions));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'production') {
    app.use(morgan('dev'));
}

// Track user activity for smart backups
app.use((req, res, next) => {
    updateActivity(); // Record that someone is using the site
    next();
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/contact', require('./routes/contact'));


app.use('/api/delivery', require('./routes/delivery'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/driver', require('./routes/driver'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        socketConnected: io ? true : false
    });
});

// Manual backup trigger (for admin use)
app.post('/api/admin/backup', async (req, res) => {
    // In production, add admin authentication here
    const result = await forceBackup();
    res.json({
        success: result,
        message: result ? 'Backup completed' : 'Backup failed'
    });
});

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Initialize email service
const { initializeEmailService } = require('./services/emailService');

// Use server.listen instead of app.listen for Socket.IO
server.listen(PORT, async () => {
    console.log(`\n🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`🔌 Socket.IO ready for real-time connections`);

    // Initialize and verify email service
    console.log('\n📧 Initializing email service...');
    const emailResult = await initializeEmailService();
    if (emailResult.success) {
        console.log('✅ Email service is operational');
    } else {
        console.log('❌ Email service failed to start:', emailResult.error);
    }

    // Start automatic backup scheduler
    startBackupScheduler();
});

module.exports = { app, server, io };

