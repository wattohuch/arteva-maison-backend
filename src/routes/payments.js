const express = require('express');
const router = express.Router();
const {
    getPaymentMethods,
    createPaymentSession,
    executePayment,
    verifyPayment,
    handlePaymentCallback,
    handleWebhook,
    processCOD
} = require('../controllers/paymentControllerMyFatoorah');
const { protect } = require('../middleware/auth');

// Public routes
router.get('/methods', getPaymentMethods);
router.get('/callback', handlePaymentCallback); // MyFatoorah redirects here after payment
router.get('/verify/:paymentId', verifyPayment);
router.post('/webhook', handleWebhook);

// Protected routes
router.post('/create-session', protect, createPaymentSession);
router.post('/execute', protect, executePayment);
router.post('/cod', protect, processCOD);

module.exports = router;
