/**
 * ARTEVA Maison — inbound WhatsApp webhook processing
 *
 * Everything that arrives from Meta lands here: customer messages, delivery
 * receipts, read receipts, failures, and template status changes.
 *
 * Two rules shape the whole file.
 *
 *   Every event is claimed before it is processed. Meta retries anything it
 *   considers unacknowledged, so without a claim one customer message becomes
 *   three auto-replies. The claim is an insert against a unique index, not a
 *   read-then-write, because two retries arriving together would both pass a
 *   read check.
 *
 *   Nothing here may throw into the request. The webhook has already been
 *   answered with 200 by the time this runs — Meta resends anything slow, so
 *   acknowledging first and working afterwards is the only correct order. A
 *   rejection escaping this module would be an unhandled rejection, not an
 *   error response.
 */

const crypto = require('crypto');

const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppContact = require('../models/WhatsAppContact');

/** Meta's message types we can store media for. */
const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video', 'sticker']);

/** MIME types we are willing to keep. Anything else is recorded, not stored. */
const ALLOWED_MEDIA_MIME = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp)|audio\/(aac|mp4|mpeg|amr|ogg)|application\/pdf)/i;

/**
 * Human-readable summary of a non-text message, for the conversation list.
 * Storing "[image]" beats storing nothing when someone scans the history.
 */
function describeMessage(message) {
    switch (message.type) {
        case 'text':
            return message.text?.body || '';
        case 'image':
            return message.image?.caption || '[image]';
        case 'video':
            return message.video?.caption || '[video]';
        case 'document':
            return message.document?.caption || message.document?.filename || '[document]';
        case 'audio':
            return '[audio]';
        case 'sticker':
            return '[sticker]';
        case 'location':
            return `[location ${message.location?.latitude},${message.location?.longitude}]`;
        case 'contacts':
            return '[contact card]';
        case 'reaction':
            return `[reaction ${message.reaction?.emoji || ''}]`;
        case 'button':
            return message.button?.text || '[button reply]';
        case 'interactive':
            return message.interactive?.button_reply?.title
                || message.interactive?.list_reply?.title
                || '[interactive reply]';
        case 'order':
            return '[catalogue order]';
        default:
            return `[${message.type || 'unknown'}]`;
    }
}

/**
 * The text a human actually typed, or null.
 *
 * Interactive and button replies count: the customer chose those words, so the
 * AI should see them. A sticker or an image caption does not — feeding "[image]"
 * to a language model produces a confident answer about nothing.
 */
function extractReplyableText(message) {
    if (message.type === 'text') return message.text?.body || null;
    if (message.type === 'button') return message.button?.text || null;
    if (message.type === 'interactive') {
        return message.interactive?.button_reply?.title
            || message.interactive?.list_reply?.title
            || null;
    }
    return null;
}

class WhatsAppInboundProcessor {
    /**
     * Entry point for a verified webhook body.
     *
     * @param {object} body  the parsed payload, already signature-checked
     * @returns {Promise<{processed:number, skipped:number, failed:number}>}
     */
    async processWebhook(body) {
        const tally = { processed: 0, skipped: 0, failed: 0 };

        // Defensive throughout: Meta adds fields, and a payload shape we have
        // not seen must degrade to "ignored", never to a crash.
        const entries = Array.isArray(body?.entry) ? body.entry : [];

        for (const entry of entries) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];

            for (const change of changes) {
                const value = change?.value || {};
                const field = change?.field;

                // Template approval / rejection / pausing.
                if (field === 'message_template_status_update') {
                    await this._runClaimed(
                        `template:${value.message_template_id}:${value.event}`,
                        'template_status',
                        value,
                        tally,
                        () => this.handleTemplateStatus(value)
                    );
                    continue;
                }

                for (const status of (Array.isArray(value.statuses) ? value.statuses : [])) {
                    // The status is part of the key: one message legitimately
                    // reports sent, then delivered, then read.
                    await this._runClaimed(
                        `status:${status.id}:${status.status}`,
                        'status',
                        status,
                        tally,
                        () => this.handleStatus(status)
                    );
                }

                for (const message of (Array.isArray(value.messages) ? value.messages : [])) {
                    await this._runClaimed(
                        `msg:${message.id}`,
                        'message',
                        message,
                        tally,
                        () => this.handleMessage(message, value)
                    );
                }
            }
        }

        return tally;
    }

    /**
     * Claim an event and run the handler only if the claim succeeded.
     * Errors are recorded against the event and swallowed — see the file note.
     */
    async _runClaimed(eventKey, kind, payload, tally, handler) {
        if (!eventKey || eventKey.includes('undefined')) {
            tally.skipped++;
            return;
        }

        const payloadHash = crypto
            .createHash('sha256')
            .update(JSON.stringify(payload || {}))
            .digest('hex');

        let claimed;
        try {
            claimed = await WhatsAppWebhookEvent.claim(eventKey, kind, payloadHash);
        } catch (err) {
            // The ledger itself is unavailable. Processing anyway risks a
            // duplicate reply; not processing loses the message. A duplicate
            // greeting is the lesser harm, so we continue and say so loudly.
            console.error(`[WA-IN] Idempotency store unavailable for ${eventKey}: ${err.message}`);
            claimed = true;
        }

        if (!claimed) {
            console.log(`[WA-IN] ${eventKey} already handled — ignoring retry`);
            tally.skipped++;
            return;
        }

        try {
            await handler();
            tally.processed++;
            await WhatsAppWebhookEvent.settle(eventKey);
        } catch (err) {
            tally.failed++;
            console.error(`[WA-IN] ${eventKey} failed: ${err.message}`);
            await WhatsAppWebhookEvent.settle(eventKey, err.message);
        }
    }

    // ── Inbound messages ────────────────────────────────────────────────────

    /**
     * A customer sent us something.
     *
     * @param {object} message Meta's message object
     * @param {object} value   the surrounding change value (holds contacts)
     */
    async handleMessage(message, value) {
        const waId = message.from;
        if (!waId) return;

        const profileName = value?.contacts?.[0]?.profile?.name || null;
        const contact = await WhatsAppContact.upsertFromWebhook(waId, profileName);

        const body = describeMessage(message);
        const timestamp = message.timestamp
            ? new Date(Number(message.timestamp) * 1000)
            : new Date();

        const record = await WhatsAppMessage.create({
            messageId: message.id,
            direction: 'inbound',
            type: message.type || 'unknown',
            from: waId,
            to: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
            body,
            status: 'delivered',
            deliveredAt: timestamp,
            replyTo: message.context?.id || null,
            context: 'inbound',
        });

        if (contact) {
            contact.lastInboundAt = timestamp;
            contact.messageCount = (contact.messageCount || 0) + 1;
            await contact.save().catch(() => { /* counter, not critical */ });
        }

        console.log(`[WA-IN] ${message.type} from ${waId}${profileName ? ` (${profileName})` : ''}`);

        // Media is fetched after the message row exists, so a download failure
        // still leaves a record that something arrived.
        if (MEDIA_TYPES.has(message.type)) {
            this.storeInboundMedia(record, message)
                .catch(err => console.error(`[WA-IN] media store failed: ${err.message}`));
        }

        // Blue ticks. Best effort, never awaited into the critical path.
        const client = require('./whatsappCloudClient');
        client.markAsRead(message.id).catch(() => { /* cosmetic */ });

        // Hand the human-typed text to the existing reply pipeline.
        const text = extractReplyableText(message);
        if (text) {
            const whatsappService = require('./whatsappService');
            await whatsappService.handleInboundMessage(waId, text, {
                messageId: message.id,
                profileName,
                /* The message this one replies to. An owner swiping to reply on
                 * an escalation alert is how the relay knows which customer the
                 * reply belongs to. */
                replyTo: message.context && message.context.id,
            });
        }
    }

    /**
     * Pull media out of Meta and into our own storage.
     *
     * Meta's download URL is signed, short-lived and only works with our
     * bearer token, so it can never be handed to a browser or stored as the
     * canonical location. Cloudinary already holds every other image this
     * shop serves, which also keeps large files off the Raspberry Pi's card.
     */
    async storeInboundMedia(record, message) {
        const payload = message[message.type] || {};
        const mediaId = payload.id;
        if (!mediaId) return;

        record.media = {
            whatsappMediaId: mediaId,
            mimeType: payload.mime_type,
            sha256: payload.sha256,
            filename: payload.filename,
        };
        await record.save().catch(() => {});

        const client = require('./whatsappCloudClient');
        const dl = await client.downloadMedia(mediaId);
        if (!dl.success) {
            console.warn(`[WA-IN] could not download media ${mediaId}: ${dl.error}`);
            return;
        }

        if (!ALLOWED_MEDIA_MIME.test(dl.mimeType || '')) {
            // Recorded, deliberately not stored. Accepting arbitrary types from
            // an inbound channel is how a media store becomes a file drop.
            console.warn(`[WA-IN] refusing media of type ${dl.mimeType}`);
            record.media.mimeType = dl.mimeType;
            record.media.fileSize = dl.fileSize;
            await record.save().catch(() => {});
            return;
        }

        try {
            const { uploadToCloudinary } = require('../config/cloudinary');
            const uploaded = await uploadToCloudinary(dl.buffer, 'whatsapp');
            record.media = {
                ...record.media,
                mimeType: dl.mimeType,
                sha256: dl.sha256,
                fileSize: dl.fileSize,
                url: uploaded.url,
                publicId: uploaded.publicId,
            };
            await record.save();
            console.log(`[WA-IN] stored ${dl.mimeType} (${Math.round(dl.fileSize / 1024)}KB) for ${record.from}`);
        } catch (err) {
            // Cloudinary is optional infrastructure for this path. The message
            // and its metadata are already saved; only the copy is lost.
            console.error(`[WA-IN] media upload failed: ${err.message}`);
        }
    }

    // ── Status receipts ─────────────────────────────────────────────────────

    /**
     * Meta reporting what happened to something we sent.
     *
     * Ordering is not guaranteed, which the model handles: a `sent` arriving
     * after `read` is dropped rather than allowed to regress the record.
     */
    async handleStatus(status) {
        const messageId = status.id;
        if (!messageId) return;

        const error = Array.isArray(status.errors) ? status.errors[0] : null;
        const timestamp = status.timestamp
            ? new Date(Number(status.timestamp) * 1000)
            : new Date();

        const changed = await WhatsAppMessage.applyStatus(messageId, status.status, {
            timestamp,
            errorCode: error?.code,
            errorMessage: error?.title || error?.message,
        });

        if (error) {
            console.warn(`[WA-IN] ${status.recipient_id} ${status.status}: ${error.code} ${error.title || error.message || ''}`);
        } else if (changed) {
            console.log(`[WA-IN] ${status.recipient_id} -> ${status.status}`);
        }
    }

    /**
     * A template was approved, rejected, paused or disabled.
     *
     * Logged rather than acted on: the send path already treats a template
     * error as permanent and reports it, and silently swapping templates
     * around under the shop would be worse than telling someone.
     */
    async handleTemplateStatus(value) {
        const name = value.message_template_name || value.message_template_id;
        const event = value.event || 'unknown';
        const reason = value.reason ? ` (${value.reason})` : '';
        const level = event === 'APPROVED' ? 'log' : 'warn';
        console[level](`[WA-IN] template ${name}: ${event}${reason}`);
    }
}

module.exports = new WhatsAppInboundProcessor();
module.exports.WhatsAppInboundProcessor = WhatsAppInboundProcessor;
module.exports.describeMessage = describeMessage;
module.exports.extractReplyableText = extractReplyableText;
