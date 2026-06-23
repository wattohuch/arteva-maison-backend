const express = require('express');
const router = express.Router();
const {
    createOrder,
    getMyOrders,
    getOrder,
    getOrderByNumber,
    getAllOrders,
    updateOrderStatus,
    cancelOrder,
    checkCanCancel,
    trackOrderPublic,
    getOrderForReceipt,
    getReceiptHTML
} = require('../controllers/orderController');
const { protect, admin, optionalAuth } = require('../middleware/auth');

// PUBLIC routes — no auth needed
router.get('/track/:orderNumber/:token', trackOrderPublic);
router.get('/receipt/:orderNumber', optionalAuth, getOrderForReceipt);
router.get('/receipt/:orderNumber/html', optionalAuth, getReceiptHTML);

// All remaining order routes require authentication
router.use(protect);

router.post('/', createOrder);
router.get('/', getMyOrders);
router.get('/admin', admin, getAllOrders);
router.get('/by-number/:orderNumber', getOrderByNumber);
router.get('/:id', getOrder);
router.get('/:id/can-cancel', checkCanCancel);
router.put('/:id/status', admin, updateOrderStatus);
router.post('/:id/cancel', cancelOrder);

module.exports = router;
