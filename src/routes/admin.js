const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getAdminProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    getAdminOrders,
    updateOrderStatus,
    assignDriver,
    getAdminUsers,
    updateUserRole,
    deleteUser,
    sendOfferEmail,
    getProductViewAnalytics,
    getIPVisitorLog,
    getRevenueHistory,
    checkSuperuser,
    getRevenueAccessStatus,
    getRevenueTotal,
    authenticateRevenueAccess,
    requestRevenueOTP,
    verifyRevenueOTP,
    generateReceipt,
    generatePrintStationToken,
    setRevenuePassword,
    getRevenueAnalytics,
    updateProductDiscount,
    getCustomerOrderHistory,
    updateOrderReceipt,
    createOrder,
    processRefund,
    deleteOrder,
    getSiteSettings,
    updateSiteSettings,
    getSiteVisitStats
} = require('../controllers/adminController');
const { getRevenueOverview } = require('../controllers/revenueController');
const { protect, admin, owner, ownerOnly, revenueUnlocked } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Site Settings (public GET for frontend, protected PUT for admin)
router.get('/site-settings', getSiteSettings);
router.put('/site-settings', protect, admin, updateSiteSettings);

// Stats
router.get('/stats', protect, admin, getDashboardStats);

// Superuser check
router.get('/check-superuser', protect, checkSuperuser);

// ── Revenue ──
// `owner` is the shop owner and the only role revenue is visible to.
// `superuser` is the developer account: it administers everything else but is
// deliberately kept out of the takings, so these use `ownerOnly`, not `owner`.
// On top of the role check, reading revenue also needs an unlock token minted
// by /revenue-auth, so an open owner session is not enough on its own.

// Whether this account can open revenue, and whether it has a password yet
router.get('/revenue/status', protect, getRevenueAccessStatus);

// Revenue password setup (first time)
router.post('/set-revenue-password', protect, ownerOnly, setRevenuePassword);

// Revenue access authentication
router.post('/revenue-auth', protect, ownerOnly, authenticateRevenueAccess);
router.post('/revenue-otp/request', protect, ownerOnly, requestRevenueOTP);
router.post('/revenue-otp/verify', protect, ownerOnly, verifyRevenueOTP);

// Revenue History (owner only)
router.get('/revenue-history', protect, ownerOnly, revenueUnlocked, getRevenueHistory);

// Receipt generation (superuser only)
router.get('/receipt/:orderId', protect, generateReceipt);

// Generate print station token
router.post('/generate-print-token', protect, admin, generatePrintStationToken);

// Analytics
router.get('/analytics/product-views', protect, admin, getProductViewAnalytics);
router.get('/analytics/visitor-log', protect, admin, getIPVisitorLog);
router.get('/analytics/site-visits', protect, admin, getSiteVisitStats);

// Revenue Analytics (owner only - detailed per-product breakdown)
router.get('/revenue-analytics', protect, ownerOnly, revenueUnlocked, getRevenueAnalytics);

// Product Discounts
router.put('/products/:id/discount', protect, admin, updateProductDiscount);

// Customer order history (for revenue modal drill-down)
router.get('/customer-orders/:email', protect, admin, getCustomerOrderHistory);

// Manual receipt re-print
router.post('/print-receipt/:orderId', protect, admin, async (req, res) => {
    try {
        const Order = require('../models/Order');
        // Unset printedAt so the Raspberry Pi poll loop picks it up within 30s
        await Order.findByIdAndUpdate(req.params.orderId, { $unset: { printedAt: 1 } });
        res.json({ success: true, message: 'Receipt sent to print queue! The Pi will print it in < 30 seconds.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Printer status check — diagnose connectivity
router.get('/printer/status', protect, admin, async (req, res) => {
    try {
        const { checkPrinterStatus } = require('../services/printService');
        const status = await checkPrinterStatus();
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Send test page to printer
router.post('/printer/test', protect, admin, async (req, res) => {
    try {
        const { sendTestPage } = require('../services/printService');
        const result = await sendTestPage();
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Update printer URL (for when IP changes)
router.put('/printer/url', protect, admin, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL required' });
    // Update runtime env (persists until restart)
    process.env.PRINTER_IPP_URL = url;
    console.log(`[PRINT] 🖨️ Printer URL updated to: ${url}`);
    res.json({ success: true, message: `Printer URL updated to ${url}`, note: 'Update your Render env var to persist across deploys' });
});

// WhatsApp connection status check
router.get('/whatsapp-status', protect, admin, async (req, res) => {
    try {
        const whatsapp = require('../services/whatsappService');
        const ownerPhones = await whatsapp.getOwnerPhones();
        const connected = await whatsapp.checkStatus();
        res.json({
            success: true,
            connected,
            provider: 'Green API',
            instanceId: process.env.GREEN_API_INSTANCE_ID || 'NOT SET',
            apiUrl: process.env.GREEN_API_URL || 'NOT SET (using default)',
            tokenSet: !!(process.env.GREEN_API_TOKEN),
            ownerPhones: ownerPhones,
            ownerPhoneCount: ownerPhones.length,
            message: !process.env.GREEN_API_INSTANCE_ID || !process.env.GREEN_API_TOKEN
                ? '❌ GREEN_API_INSTANCE_ID or GREEN_API_TOKEN not set in env vars. WhatsApp is DISABLED.'
                : connected
                    ? `✅ WhatsApp ready — will notify ${ownerPhones.length} owner(s): ${ownerPhones.join(', ')}`
                    : '❌ Not connected. Go to https://console.green-api.com and scan QR code'
        });
    } catch (e) {
        res.json({ success: false, connected: false, message: e.message });
    }
});

// ═══════════════════════════════════════════════════
// AGENT ENDPOINTS (Raspberry Pi print + WhatsApp workers)
//
// These carry no JWT — the devices authenticate with a shared key. That makes
// the key the ONLY thing standing between the public internet and
// /print-queue/poll, which returns full customer records: names, emails,
// phone numbers and delivery addresses.
//
// The fallback below is a literal committed to this repository. If
// PRINT_AGENT_KEY is unset in production, that customer data is readable by
// anyone who has seen this file. The default is kept so an existing print
// station does not stop working on deploy, but it is now logged loudly at
// boot so it cannot pass unnoticed.
// ═══════════════════════════════════════════════════
const DEFAULT_AGENT_KEY = 'arteva-print-2026';
const PRINT_AGENT_KEY = process.env.PRINT_AGENT_KEY || DEFAULT_AGENT_KEY;

if (PRINT_AGENT_KEY === DEFAULT_AGENT_KEY) {
    console.warn(
        '\n╔══════════════════════════════════════════════════════════════╗\n' +
        '║  ⚠  SECURITY: PRINT_AGENT_KEY is not set.                     ║\n' +
        '║                                                              ║\n' +
        '║  The agent endpoints are running on the public default key   ║\n' +
        '║  committed to this repository. /api/admin/print-queue/poll   ║\n' +
        '║  exposes customer names, emails, phones and addresses to      ║\n' +
        '║  anyone who knows it.                                        ║\n' +
        '║                                                              ║\n' +
        '║  Set PRINT_AGENT_KEY to a random secret on the server AND    ║\n' +
        '║  on each Raspberry Pi agent.                                 ║\n' +
        '╚══════════════════════════════════════════════════════════════╝\n'
    );
}

/**
 * Accept the key from the X-API-Key header (preferred) or a query parameter.
 *
 * Compared with `timingSafeEqual` rather than `===`: a plain string comparison
 * exits at the first differing byte, which leaks the key one character at a
 * time to an attacker who can measure response times.
 */
function checkAgentKey(req) {
    const provided = req.headers['x-api-key'] || req.query.key;
    if (typeof provided !== 'string') return false;

    const a = Buffer.from(provided);
    const b = Buffer.from(PRINT_AGENT_KEY);
    // timingSafeEqual throws on length mismatch, so guard first. Length alone
    // is not a useful signal to an attacker.
    if (a.length !== b.length) return false;
    return require('crypto').timingSafeEqual(a, b);
}

router.get('/print-queue/poll', async (req, res) => {
    if (!checkAgentKey(req)) {
        return res.status(401).json({ success: false, message: 'Invalid key' });
    }
    try {
        const Order = require('../models/Order');
        // Find paid orders not yet printed, created within last 7 days only
        // This prevents stale old orders from resurfacing after agent restart
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const orders = await Order.find({
            paymentStatus: 'paid',
            orderStatus: { $nin: ['cancelled'] },
            printedAt: { $exists: false },
            createdAt: { $gte: sevenDaysAgo }
        })
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

        console.log(`[PRINT-POLL] Found ${orders.length} unprinted order(s) from last 7 days`);
        res.json({ success: true, count: orders.length, orders });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/print-queue/done/:orderId', async (req, res) => {
    if (!checkAgentKey(req)) {
        return res.status(401).json({ success: false, message: 'Invalid key' });
    }
    try {
        const Order = require('../models/Order');
        // Idempotent: only set printedAt if not already set
        const result = await Order.findOneAndUpdate(
            { _id: req.params.orderId, printedAt: { $exists: false } },
            { printedAt: new Date() },
            { new: true }
        );
        if (!result) {
            console.log(`[PRINT-DONE] Order ${req.params.orderId} already marked as printed`);
            return res.json({ success: true, message: 'Already marked as printed' });
        }
        console.log(`[PRINT-DONE] Marked order ${result.orderNumber} as printed`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ═══════════════════════════════════════════════════
// RASPBERRY PI WHATSAPP AGENT ENDPOINTS
// ═══════════════════════════════════════════════════

router.get('/whatsapp-queue/poll', async (req, res) => {
    if (!checkAgentKey(req)) {
        return res.status(401).json({ success: false, message: 'Invalid key' });
    }
    try {
        const WhatsAppQueue = require('../models/WhatsAppQueue');
        // Fetch up to 10 pending messages
        const messages = await WhatsAppQueue.find({ status: 'pending' })
            .sort({ createdAt: 1 })
            .limit(10)
            .lean();

        res.json({ success: true, count: messages.length, messages });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/whatsapp-queue/status/:id', async (req, res) => {
    if (!checkAgentKey(req)) {
        return res.status(401).json({ success: false, message: 'Invalid key' });
    }
    try {
        const { status, errorLog } = req.body;
        const WhatsAppQueue = require('../models/WhatsAppQueue');
        
        const updateData = { status, $inc: { attempts: 1 } };
        if (errorLog) updateData.errorLog = errorLog;

        const result = await WhatsAppQueue.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        );

        res.json({ success: true, message: result });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Re-queue transient failures (called by WhatsApp agent on reconnect)
router.post('/whatsapp-queue/requeue-transient', async (req, res) => {
    if (!checkAgentKey(req)) {
        return res.status(401).json({ success: false, message: 'Invalid key' });
    }
    try {
        const WhatsAppQueue = require('../models/WhatsAppQueue');
        // Only re-queue messages that failed due to transient connection errors
        // and were created within the last 24 hours (don't resurrect ancient failures)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = await WhatsAppQueue.updateMany(
            {
                status: 'failed',
                createdAt: { $gte: oneDayAgo },
                $or: [
                    { errorLog: /connection closed/i },
                    { errorLog: /connection lost/i },
                    { errorLog: /will retry on reconnect/i },
                    { errorLog: /will be re-queued/i }
                ]
            },
            {
                $set: { status: 'pending', errorLog: 'Re-queued after reconnect' },
                $inc: { attempts: 0 }  // Keep attempt count for diagnostics
            }
        );
        console.log(`[WA-REQUEUE] Re-queued ${result.modifiedCount} transient failure(s)`);
        res.json({ success: true, requeued: result.modifiedCount });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Products
router.route('/products')
    .get(protect, admin, getAdminProducts)
    .post(protect, admin, upload.array('images', 5), createProduct);

router.route('/products/:id')
    .put(protect, admin, upload.array('images', 5), updateProduct)
    .delete(protect, admin, deleteProduct);

// Orders
router.get('/orders', protect, admin, getAdminOrders);
router.post('/orders', protect, admin, createOrder);
router.put('/orders/:id/status', protect, admin, updateOrderStatus);
router.put('/orders/:id/assign', protect, admin, assignDriver);
router.put('/orders/:id/receipt', protect, admin, updateOrderReceipt);
router.post('/orders/:id/refund', protect, admin, processRefund);
// Owner-only: deleting an order destroys an accounting record and restores
// stock, so it sits behind the stricter guard rather than plain `admin`.
router.delete('/orders/:id', protect, owner, deleteOrder);

// Unified revenue model (online orders + manual receipts)
router.get('/revenue/overview', protect, ownerOnly, revenueUnlocked, getRevenueOverview);

// Headline total behind the blurred dashboard tile
router.get('/revenue/total', protect, ownerOnly, revenueUnlocked, getRevenueTotal);

// Users
router.route('/users')
    .get(protect, admin, getAdminUsers);

router.route('/users/:id')
    .put(protect, admin, updateUserRole)
    .delete(protect, admin, deleteUser);

// Email (with image attachments support)
router.post('/send-email', protect, admin, upload.array('images', 5), sendOfferEmail);

// Backup management
const { listBackups, downloadBackup, createBackup, restoreBackup } = require('../controllers/backupController');
router.get('/backups', protect, admin, listBackups);
router.get('/backups/:backupName/download', protect, admin, downloadBackup);
router.post('/backups/create', protect, admin, createBackup);
router.post('/backups/:backupName/restore', protect, admin, restoreBackup);

// One-time migration: backfill tracking tokens for existing orders
router.post('/migrate/tracking-tokens', protect, admin, async (req, res) => {
    try {
        const Order = require('../models/Order');
        const crypto = require('crypto');
        const orders = await Order.find({ $or: [{ trackingToken: { $exists: false } }, { trackingToken: null }, { trackingToken: '' }] });
        let count = 0;
        for (const order of orders) {
            order.trackingToken = crypto.randomBytes(16).toString('hex');
            await order.save();
            count++;
        }
        res.json({ success: true, message: `Backfilled ${count} orders with tracking tokens` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
