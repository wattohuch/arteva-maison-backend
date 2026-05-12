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
        res.json({
            success: true,
            connected: whatsapp.isConnected || false,
            ownerPhone: process.env.WHATSAPP_OWNER_PHONE || 'NOT SET',
            message: whatsapp.isConnected
                ? '✅ WhatsApp is connected and ready to send messages'
                : '❌ WhatsApp is NOT connected. Check Render logs for pairing code.'
        });
    } catch (e) {
        res.json({ success: false, connected: false, message: e.message });
    }
});

// Test order simulation (admin only)
router.post('/simulate-order', protect, admin, async (req, res) => {
    try {
        const Order = require('../models/Order');
        const Product = require('../models/Product');
        const testPhone = req.body.phone || '96597295917';

        const product = await Product.findOne({ isActive: true }).lean();
        if (!product) return res.status(400).json({ success: false, message: 'No active products' });

        const orderNumber = 'TEST-' + Date.now().toString(36).toUpperCase();
        const order = new Order({
            orderNumber,
            user: req.user._id,
            items: [{
                product: product._id,
                name: product.name,
                nameAr: product.nameAr || product.name,
                price: product.price,
                quantity: 1,
                image: product.images?.[0]?.url || ''
            }],
            shippingAddress: {
                street: 'Test Street 123', city: 'Kuwait City',
                state: 'Al Asimah', country: 'Kuwait',
                zipCode: '12345', phone: testPhone
            },
            paymentMethod: 'card',
            paymentStatus: 'paid',
            orderStatus: 'confirmed',
            subtotal: product.price,
            deliveryFee: 2.0,
            total: product.price + 2.0,
            currency: 'KWD',
            notes: '🧪 TEST ORDER — Delete after testing'
        });
        await order.save();

        const results = { order: orderNumber, whatsappOwner: false, whatsappCustomer: false, print: false };

        // WhatsApp
        try {
            const whatsapp = require('../services/whatsappService');
            const testUser = { name: req.user.name, email: req.user.email, phone: testPhone, language: 'en' };
            const ownerRes = await whatsapp.notifyOwnerPaymentReceived(order, testUser);
            results.whatsappOwner = ownerRes.success;
            const custRes = await whatsapp.notifyCustomerNewOrder(order, testUser);
            results.whatsappCustomer = custRes.success;
        } catch (e) { results.whatsappError = e.message; }

        // Print
        try {
            const { printExistingOrderReceipt } = require('../services/printService');
            const printRes = await printExistingOrderReceipt(order._id);
            results.print = printRes?.success || false;
            if (printRes?.error) results.printError = printRes.error;
            if (printRes?.message) results.printMessage = printRes.message;
        } catch (e) { results.printError = e.message; }

        // Emit socket event
        try {
            const io = req.app.get('io');
            if (io) io.emit('new_order', { orderNumber, total: order.total });
        } catch (e) {}

        res.json({ success: true, message: 'Test order created', data: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
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
