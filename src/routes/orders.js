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
const validate = require('../middleware/validate');
const { mongoIdParam, paginationRules } = require('../validators/commonValidators');
const { orderNumberParam } = require('../validators/deliveryValidators');

// PUBLIC routes — no auth needed
router.get('/track/:orderNumber/:token', trackOrderPublic);
router.get('/receipt/:orderNumber', optionalAuth, validate(orderNumberParam), getOrderForReceipt);
router.get('/receipt/:orderNumber/html', optionalAuth, validate(orderNumberParam), getReceiptHTML);

// All remaining order routes require authentication
router.use(protect);

router.post('/', createOrder);
router.get('/', validate(paginationRules), getMyOrders);
router.get('/admin', admin, validate(paginationRules), getAllOrders);
router.get('/by-number/:orderNumber', validate(orderNumberParam), getOrderByNumber);
router.get('/:id', validate(mongoIdParam('id')), getOrder);
router.get('/:id/can-cancel', validate(mongoIdParam('id')), checkCanCancel);
router.put('/:id/status', admin, validate(mongoIdParam('id')), updateOrderStatus);
router.post('/:id/cancel', validate(mongoIdParam('id')), cancelOrder);

module.exports = router;
