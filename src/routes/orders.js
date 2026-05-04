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
    checkCanCancel
} = require('../controllers/orderController');
const { protect, admin } = require('../middleware/auth');

// All order routes require authentication
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
