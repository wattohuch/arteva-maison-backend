const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const {
    getCatalogFeed,
    verifyWhatsAppWebhook,
    handleWhatsAppWebhook,
    getMetaStatus,
} = require('../controllers/metaController');

// Product feed for Commerce Manager. Public by necessity — Meta's crawler
// carries no credentials, and every field is already public on the storefront.
router.get('/catalog.xml', getCatalogFeed);

// WhatsApp Cloud API webhook. GET is Meta's one-time verification handshake;
// POST carries inbound messages and delivery receipts, and is authenticated by
// the X-Hub-Signature-256 header rather than by a session.
router.get('/whatsapp', verifyWhatsAppWebhook);
router.post('/whatsapp', handleWhatsAppWebhook);

// Which parts of the Meta setup are actually configured.
router.get('/status', protect, admin, getMetaStatus);

module.exports = router;
