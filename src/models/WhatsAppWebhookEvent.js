const mongoose = require('mongoose');

/**
 * One row per webhook payload Meta has delivered to us.
 *
 * This exists for exactly one reason: Meta retries. A webhook that is slow,
 * errors, or simply looks unacknowledged is sent again, sometimes several
 * times. Without a record of what has already been handled, one customer
 * message becomes three auto-replies and one delivery receipt overwrites a
 * later status with an earlier one.
 *
 * `eventKey` is the idempotency key. It is unique, and the insert is what
 * claims the event — see `claim()`. Claiming by insert rather than by
 * "read, then decide, then write" is deliberate: two workers processing
 * retries of the same payload at the same moment would both pass a read
 * check, and only a unique index can actually settle the race.
 */
const whatsappWebhookEventSchema = new mongoose.Schema({
    /**
     * Meta's own id for the thing that happened, prefixed by its kind:
     *   msg:wamid.HBg...    an inbound message
     *   status:wamid.HBg...:delivered   a status transition
     *
     * The status kind carries the status in the key because a single message
     * legitimately produces sent → delivered → read, and each must be
     * processed once rather than the first one locking out the rest.
     */
    eventKey: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    kind: {
        type: String,
        enum: ['message', 'status', 'template_status', 'unknown'],
        default: 'unknown',
    },
    /** sha256 of the raw payload — lets us spot Meta resending altered bodies. */
    payloadHash: { type: String },
    status: {
        type: String,
        enum: ['processing', 'processed', 'failed'],
        default: 'processing',
        index: true,
    },
    attempts: { type: Number, default: 1 },
    error: { type: String },
    processedAt: { type: Date },
}, { timestamps: true });

/*
 * Webhook events are a de-duplication ledger, not an archive. Thirty days is
 * far beyond Meta's retry window (hours) while still leaving enough history to
 * investigate "did we ever receive that?" after a weekend.
 */
whatsappWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

/**
 * Claim an event for processing.
 *
 * @returns {Promise<boolean>} true if this caller now owns the event, false if
 *          it was already claimed — in which case the caller must do nothing.
 */
whatsappWebhookEventSchema.statics.claim = async function (eventKey, kind, payloadHash) {
    try {
        await this.create({ eventKey, kind, payloadHash });
        return true;
    } catch (err) {
        // 11000 = duplicate key. Someone got here first; that is the answer,
        // not an error. Anything else is a real database problem and should
        // surface rather than be swallowed into a silent "already handled".
        if (err && err.code === 11000) return false;
        throw err;
    }
};

/** Mark a claimed event finished, successfully or not. */
whatsappWebhookEventSchema.statics.settle = async function (eventKey, error) {
    await this.updateOne(
        { eventKey },
        {
            status: error ? 'failed' : 'processed',
            processedAt: new Date(),
            ...(error ? { error: String(error).slice(0, 500) } : {}),
        }
    ).catch(() => { /* bookkeeping must never fail the request */ });
};

module.exports = mongoose.model('WhatsAppWebhookEvent', whatsappWebhookEventSchema);
