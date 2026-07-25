const express = require('express');
const router = express.Router();
const {
    getPaymentMethods,
    createPaymentSession,
    executePayment,
    verifyPayment,
    handlePaymentCallback,
    handleWebhook,
    processCOD,
    initApplePaySession
} = require('../controllers/paymentControllerMyFatoorah');
const {
    createDeemaCheckout,
    handleDeemaCallback,
    handleDeemaWebhook,
    verifyDeemaPayment,
    reconcileDeemaPayments
} = require('../controllers/paymentControllerDeema');
const { protect, admin } = require('../middleware/auth');

// ── MyFatoorah routes ──
router.get('/methods', getPaymentMethods);
router.get('/callback', handlePaymentCallback);
router.get('/verify/:paymentId', verifyPayment);
router.post('/webhook', handleWebhook);
router.post('/create-session', protect, createPaymentSession);
router.post('/execute', protect, executePayment);
router.post('/cod', protect, processCOD);

// Apple Pay — merchant validation happens server-side because it needs the
// MyFatoorah secret key. Payment itself still settles through /execute and is
// confirmed by the same callback/webhook verification as every other method.
router.post('/applepay/session', protect, initApplePaySession);

// ── Deema BNPL routes ──
router.post('/deema/checkout', protect, createDeemaCheckout);
router.get('/deema/callback', handleDeemaCallback);    // Deema redirects here after BNPL approval
router.post('/deema/webhook', handleDeemaWebhook);     // Server-to-server notification
router.get('/deema/verify/:chargeId', verifyDeemaPayment);
router.post('/deema/reconcile', protect, admin, reconcileDeemaPayments); // Admin: fix orphaned payments

module.exports = router;

