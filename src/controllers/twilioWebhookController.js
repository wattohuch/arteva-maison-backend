/**
 * ARTÉVA Maison — inbound WhatsApp from Twilio
 *
 * A customer messages the shop; this is where it lands. The conversation logic
 * itself is NOT here — it lives in whatsappService.handleInboundMessage, which
 * already greets, answers with Gemini using the live catalogue, and hands over
 * to a human when the customer asks for one. This file is only the doorway:
 * prove the request is really from Twilio, ignore repeats, and pass the message
 * on.
 *
 * ── Three things Twilio does differently from Meta ──
 *
 *  1. It POSTs `application/x-www-form-urlencoded`, not JSON.
 *  2. Its signature is HMAC-SHA1 over the full URL with the POST parameters
 *     appended in sorted order — not over the raw body. So unlike the Meta
 *     webhook, this one needs the PARSED body and cannot use req.rawBody.
 *  3. It expects TwiML back, or an empty 204. We answer 204 and send replies
 *     through the API instead, because a reply composed by Gemini takes longer
 *     than Twilio is willing to hold the connection open.
 */

const crypto = require('crypto');
const { asyncHandler } = require('../middleware/error');

/**
 * Recompute Twilio's signature and compare.
 *
 * The endpoint is public and unauthenticated by design — this signature is its
 * only authentication. Without it, anyone who learned the URL could forge
 * customer messages and make the shop's number reply to strangers, at the
 * shop's expense.
 *
 * @param {string} url   the exact URL Twilio was configured with
 * @param {object} params parsed POST body
 * @param {string} token  Twilio auth token
 * @param {string} header value of X-Twilio-Signature
 */
function verifyTwilioSignature(url, params, token, header) {
    if (!header || !token) return false;

    /* Twilio's scheme: start from the full URL, then append each POST
     * parameter as key+value, with keys sorted lexicographically. */
    const payload = Object.keys(params || {})
        .sort()
        .reduce((acc, key) => acc + key + params[key], url);

    const expected = crypto
        .createHmac('sha1', token)
        .update(Buffer.from(payload, 'utf-8'))
        .digest('base64');

    const a = Buffer.from(expected);
    const b = Buffer.from(String(header));
    // Length differs → not equal, and timingSafeEqual would throw.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * The URL Twilio signed.
 *
 * Must match what is configured in the Twilio console byte for byte, including
 * scheme and host. Behind Render's proxy `req.protocol` reports http, so the
 * forwarded headers are preferred — getting this wrong makes every signature
 * mismatch, which looks exactly like an attack and is in fact a config error.
 */
function publicUrl(req) {
    if (process.env.TWILIO_WEBHOOK_URL) return process.env.TWILIO_WEBHOOK_URL;

    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}${req.originalUrl.split('?')[0]}`;
}

/** Messages already handled, so Twilio's retries do not re-answer. */
const seenMessageSids = new Map();
const SEEN_TTL_MS = 30 * 60 * 1000;

function alreadyHandled(sid) {
    if (!sid) return false;

    const now = Date.now();
    // Opportunistic sweep — this map would otherwise grow for the process's life.
    if (seenMessageSids.size > 500) {
        for (const [key, at] of seenMessageSids) {
            if (now - at > SEEN_TTL_MS) seenMessageSids.delete(key);
        }
    }

    const seenAt = seenMessageSids.get(sid);
    if (seenAt && now - seenAt < SEEN_TTL_MS) return true;

    seenMessageSids.set(sid, now);
    return false;
}

// @desc    Inbound WhatsApp message from Twilio
// @route   POST /api/whatsapp/twilio
// @access  Public — authenticated by signature only
const handleTwilioInbound = asyncHandler(async (req, res) => {
    const token = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.get('x-twilio-signature');
    const params = req.body || {};

    if (token) {
        if (!verifyTwilioSignature(publicUrl(req), params, token, signature)) {
            console.warn('[TWILIO-IN] Rejected a webhook with a bad signature');
            return res.sendStatus(403);
        }
    } else if (process.env.NODE_ENV === 'production') {
        /* Fail closed. Same reasoning as the Meta webhook: with no token there
         * is nothing to verify against, so every forged request would be
         * treated as a real customer. Development runs unsigned so the handler
         * can be exercised locally. */
        console.error('[TWILIO-IN] Refusing webhook: TWILIO_AUTH_TOKEN is not set, so authenticity cannot be verified');
        return res.sendStatus(403);
    }

    // Twilio addresses carry a channel prefix the rest of the system knows
    // nothing about.
    const from = String(params.From || '').replace(/^whatsapp:/, '');
    const body = String(params.Body || '').trim();
    const sid = params.MessageSid || params.SmsMessageSid;

    /* Acknowledge before doing any work. Twilio retries anything it does not
     * see acknowledged quickly, and a Gemini round trip is far slower than its
     * patience — without this, one customer message becomes several replies. */
    res.sendStatus(204);

    if (alreadyHandled(sid)) {
        console.log(`[TWILIO-IN] ${sid} already handled — ignoring retry`);
        return;
    }

    if (!from || !body) {
        // Media-only messages and status pings both land here.
        console.log(`[TWILIO-IN] Nothing to answer (from=${from || 'none'}, body=${body ? 'present' : 'empty'})`);
        return;
    }

    try {
        const whatsapp = require('../services/whatsappService');
        const result = await whatsapp.handleInboundMessage(from, body);
        console.log(`[TWILIO-IN] ${from}: ${JSON.stringify(result).slice(0, 120)}`);
    } catch (err) {
        console.error(`[TWILIO-IN] Failed handling message from ${from}: ${err.message}`);
    }
});

// @desc    Delivery status callback from Twilio
// @route   POST /api/whatsapp/twilio/status
// @access  Public — authenticated by signature only
//
// Twilio answers a send with "queued", which is not delivery. This is where the
// real outcome arrives, and it is the only place a silent failure — a number
// that is not on WhatsApp, a customer who blocked the shop — becomes visible.
const handleTwilioStatus = asyncHandler(async (req, res) => {
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (token && !verifyTwilioSignature(publicUrl(req), req.body || {}, token, req.get('x-twilio-signature'))) {
        return res.sendStatus(403);
    }

    res.sendStatus(204);

    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body || {};
    if (!MessageSid) return;

    if (ErrorCode) {
        console.error(`[TWILIO-STATUS] ${MessageSid} → ${MessageStatus} (${ErrorCode}: ${ErrorMessage || 'no detail'})`);
    } else {
        console.log(`[TWILIO-STATUS] ${MessageSid} → ${MessageStatus}`);
    }

    // Record it against the outbound row so the log shows what actually
    // happened rather than only what was attempted.
    try {
        const WhatsAppMessage = require('../models/WhatsAppMessage');
        await WhatsAppMessage.updateOne(
            { messageId: MessageSid },
            {
                status: MessageStatus,
                ...(ErrorCode ? { errorCode: Number(ErrorCode), errorMessage: ErrorMessage } : {}),
            }
        );
    } catch (err) {
        // Bookkeeping must never break the callback.
        console.error(`[TWILIO-STATUS] Could not record ${MessageSid}: ${err.message}`);
    }
});

module.exports = { handleTwilioInbound, handleTwilioStatus, verifyTwilioSignature };
