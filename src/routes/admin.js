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
    authenticateRevenueAccess,
    requestRevenueOTP,
    verifyRevenueOTP,
    generateReceipt,
    setRevenuePassword,
    getRevenueAnalytics,
    updateProductDiscount,
    getCustomerOrderHistory,
    updateOrderReceipt
} = require('../controllers/adminController');
const { protect, admin } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Stats
router.get('/stats', protect, admin, getDashboardStats);

// Superuser check
router.get('/check-superuser', protect, checkSuperuser);

// Revenue password setup (first time)
router.post('/set-revenue-password', protect, setRevenuePassword);

// Revenue access authentication
router.post('/revenue-auth', protect, authenticateRevenueAccess);
router.post('/revenue-otp/request', protect, requestRevenueOTP);
router.post('/revenue-otp/verify', protect, verifyRevenueOTP);

// Revenue History (superuser only)
router.get('/revenue-history', protect, admin, getRevenueHistory);

// Receipt generation (superuser only)
router.get('/receipt/:orderId', protect, generateReceipt);

// Analytics
router.get('/analytics/product-views', protect, admin, getProductViewAnalytics);
router.get('/analytics/visitor-log', protect, admin, getIPVisitorLog);

// Revenue Analytics (superuser only - detailed per-product breakdown)
router.get('/revenue-analytics', protect, admin, getRevenueAnalytics);

// Product Discounts
router.put('/products/:id/discount', protect, admin, updateProductDiscount);

// Customer order history (for revenue modal drill-down)
router.get('/customer-orders/:email', protect, admin, getCustomerOrderHistory);

// Manual receipt re-print
router.post('/print-receipt/:orderId', protect, admin, async (req, res) => {
    try {
        const { printExistingOrderReceipt } = require('../services/printService');
        const result = await printExistingOrderReceipt(req.params.orderId);
        res.json({ success: result.success, message: result.success ? 'Receipt sent to printer' : result.error });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// WhatsApp connection status check
router.get('/whatsapp-status', protect, admin, async (req, res) => {
    try {
        const whatsapp = require('../services/whatsappService');
        const connected = await whatsapp.checkStatus();
        res.json({
            success: true,
            connected,
            provider: 'Green API',
            instanceId: process.env.GREEN_API_INSTANCE_ID || 'NOT SET',
            ownerPhone: process.env.WHATSAPP_OWNER_PHONE || 'NOT SET',
            message: connected
                ? '✅ WhatsApp (Green API) is connected and ready'
                : '❌ Not connected. Go to https://console.green-api.com and scan QR code'
        });
    } catch (e) {
        res.json({ success: false, connected: false, message: e.message });
    }
});

// Print Agent Polling (no JWT — uses shared API key for Windows 7 compatibility)
const PRINT_AGENT_KEY = process.env.PRINT_AGENT_KEY || 'arteva-print-2026';

router.get('/print-queue/poll', async (req, res) => {
    if (req.query.key !== PRINT_AGENT_KEY) {
        return res.status(401).json({ success: false, message: 'Invalid key' });
    }
    try {
        const Order = require('../models/Order');
        // Find paid orders not yet printed (no printedAt flag)
        const orders = await Order.find({
            paymentStatus: 'paid',
            printedAt: { $exists: false }
        })
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

        res.json({ success: true, count: orders.length, orders });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/print-queue/done/:orderId', async (req, res) => {
    if (req.query.key !== PRINT_AGENT_KEY) {
        return res.status(401).json({ success: false, message: 'Invalid key' });
    }
    try {
        const Order = require('../models/Order');
        await Order.findByIdAndUpdate(req.params.orderId, { printedAt: new Date() });
        res.json({ success: true });
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
router.put('/orders/:id/status', protect, admin, updateOrderStatus);
router.put('/orders/:id/assign', protect, admin, assignDriver);
router.put('/orders/:id/receipt', protect, admin, updateOrderReceipt);

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

module.exports = router;
