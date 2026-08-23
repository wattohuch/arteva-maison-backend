const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { protect, admin } = require('../middleware/auth');
const multer = require('multer');
const wa = require('../controllers/whatsappController');

/**
 * ARTEVA Maison — retired WhatsApp webhook
 *
 * This file used to host a second, independent webhook at
 * /api/whatsapp/webhook. It had two problems that together made it the most
 * dangerous endpoint in the codebase:
 *
 *   1. No signature verification. Meta signs every webhook with the app
 *      secret; this route checked nothing. Anyone who learned the URL could
 *      post a fabricated customer message.
 *
 *   2. It sent messages in response. The handler ran the AI assistant and
 *      forwarded to the owners, both of which send WhatsApp messages from the
 *      business number. So a stranger posting JSON here could make the shop's
 *      number message any phone they named — burning quota, and putting the
 *      number at risk of being reported and restricted by Meta.
 *
 * It also carried a hardcoded fallback verify token in source, which meant the
 * handshake would succeed for anyone who read this repository.
 *
 * Everything it did now lives behind the verified webhook at
 * /api/meta/whatsapp — including the AI assistant, which moved into
 * whatsappService.handleInboundMessage.
 *
 * The routes are kept rather than deleted so anyone still pointing Meta here
 * gets a clear answer instead of a 404 they have to guess at. 410 Gone is the
 * accurate status: it existed, it is deliberately finished, do not retry.
 */

const MOVED = {
    success: false,
    code: 'WEBHOOK_MOVED',
    message: 'This webhook has moved to POST /api/meta/whatsapp, which verifies Meta\'s X-Hub-Signature-256. Update the Callback URL in the Meta app dashboard.',
};

router.all('/webhook', (req, res) => {
    console.warn(
        `[WA-LEGACY] ${req.method} /api/whatsapp/webhook is retired — Meta is still pointed at the old URL. ` +
        'Update the Callback URL to /api/meta/whatsapp.'
    );
    res.status(410).json(MOVED);
});

/* Outbound sending is rate limited on top of the global API limiter.
 * Meta throttles a business number and, past a point, restricts it — so a
 * loop in a dashboard script must hit our ceiling long before it hits theirs.
 * Generous enough for a human working through a support queue. */
/* WhatsApp media is not only images — documents, audio and video all go
 * through the same endpoint — so the shared upload middleware cannot be
 * reused: its filter rejects anything that is not an image, which is correct
 * for product photographs and wrong here. Types are restricted to what Meta
 * actually accepts rather than left open. */
const WA_MEDIA_MIME = /^(image\/(jpeg|png|webp)|video\/(mp4|3gpp)|audio\/(aac|mp4|mpeg|amr|ogg)|application\/pdf)$/i;

const mediaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 },   // Meta's own ceiling
    fileFilter: (req, file, cb) => {
        if (WA_MEDIA_MIME.test(file.mimetype)) return cb(null, true);
        cb(new Error(`WhatsApp does not accept ${file.mimetype}`), false);
    },
});

const sendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.WHATSAPP_SEND_RATE_LIMIT || 30),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many WhatsApp sends. Slow down.' },
});

// ── Health ──
// Public: an uptime monitor should not need an admin session, and the response
// carries configuration booleans rather than any credential.
/* ── Twilio inbound ──
 *
 * Public and unauthenticated by design: Twilio signs each request and that
 * signature is the authentication, checked inside the handler. Mounted here
 * rather than under /api/meta because the payload shape, the signature scheme
 * and the reply convention are all Twilio's, not Meta's.
 *
 * Twilio POSTs form-encoded, which express.urlencoded already parses app-wide.
 */
const twilioHook = require('../controllers/twilioWebhookController');
router.post('/twilio', twilioHook.handleTwilioInbound);
router.post('/twilio/status', twilioHook.handleTwilioStatus);

router.get('/health', wa.health);

// ── Outbound ──
router.post('/messages/text', protect, admin, sendLimiter, wa.sendText);
router.post('/messages/template', protect, admin, sendLimiter, wa.sendTemplate);
router.post('/messages/media', protect, admin, sendLimiter, wa.sendMedia);
router.post('/messages/media/upload', protect, admin, sendLimiter, mediaUpload.single('file'), wa.uploadMedia);
router.post('/messages/location', protect, admin, sendLimiter, wa.sendLocation);
router.post('/messages/interactive', protect, admin, sendLimiter, wa.sendInteractive);
router.post('/messages/:id/read', protect, admin, wa.markRead);

// ── Templates ──
// Which templates Meta has approved, and the exact env var value each one
// should take — so nobody has to retype a name out of the dashboard.
router.get('/templates', protect, admin, wa.listTemplates);
// Files the templates this shop needs with Meta. Idempotent, so re-running
// after a partial failure submits only what is missing.
router.post('/templates/provision', protect, admin, wa.provisionTemplates);

// ── History ──
router.get('/conversations', protect, admin, wa.listConversations);
router.get('/conversations/:waId', protect, admin, wa.getConversation);
router.get('/messages/:id', protect, admin, wa.getMessage);

module.exports = router;
