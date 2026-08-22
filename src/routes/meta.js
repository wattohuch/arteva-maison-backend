const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { protect, admin } = require('../middleware/auth');
const {
    getCatalogFeed,
    getProductPreview,
    verifyWhatsAppWebhook,
    handleWhatsAppWebhook,
    getMetaStatus,
} = require('../controllers/metaController');

// Product feed for Commerce Manager. Public by necessity — Meta's crawler
// carries no credentials, and every field is already public on the storefront.
router.get('/catalog.xml', getCatalogFeed);

// Link preview for shared product URLs. Vercel sends only crawler traffic here
// (see vercel.json) — real visitors go on getting the SPA from the CDN.
router.get('/og/product/:slug', getProductPreview);

/* The webhook gets its own ceiling, well above the general API limiter.
 *
 * A busy day of order notifications produces a delivery receipt and a read
 * receipt for every message sent, and Meta batches and retries — so the
 * general 300-per-15-minutes would start dropping legitimate receipts, and a
 * dropped receipt is a message whose status is wrong forever. High enough that
 * only something abnormal reaches it, which is the point: it is a backstop
 * against a flood, not a throttle on normal traffic. Unsigned requests are
 * already rejected by the handler before any work is done. */
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.WHATSAPP_WEBHOOK_RATE_LIMIT || 600),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Webhook rate limit exceeded.' },
});

// WhatsApp Cloud API webhook. GET is Meta's one-time verification handshake;
// POST carries inbound messages and delivery receipts, and is authenticated by
// the X-Hub-Signature-256 header rather than by a session.
router.get('/whatsapp', webhookLimiter, verifyWhatsAppWebhook);
router.post('/whatsapp', webhookLimiter, handleWhatsAppWebhook);

// Which parts of the Meta setup are actually configured.
router.get('/status', protect, admin, getMetaStatus);

module.exports = router;
