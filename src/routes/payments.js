const express = require('express');
const router = express.Router();
const {
    createCheckoutSession,
    handleWebhook,
    getSessionStatus,
    processCOD,
    processKNET
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

// Webhook needs raw body, handled specially in server.js
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Protected routes
router.post('/create-checkout-session', protect, createCheckoutSession);
router.get('/session/:sessionId', protect, getSessionStatus);
router.post('/cod', protect, processCOD);
router.post('/knet', protect, processKNET);

module.exports = router;
