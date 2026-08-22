const mongoose = require('mongoose');

/**
 * Every WhatsApp message this system sends or receives.
 *
 * WhatsAppQueue already existed and stays as it is: it is the Pi agent's work
 * queue and a send log. This is the different thing the queue could never be —
 * a conversation record with a lifecycle. A queue row is written once when a
 * send is attempted; a message here is created on send and then *updated* as
 * Meta reports sent → delivered → read, or failed with a reason.
 *
 * Statuses only ever move forward. Meta does not guarantee webhook ordering,
 * so a `sent` receipt arriving after a `read` receipt must not undo it — see
 * `applyStatus`.
 */

/** Rank of each status, so a late-arriving earlier status cannot regress one. */
const STATUS_RANK = {
    queued: 0,
    sent: 1,
    delivered: 2,
    read: 3,
    // Terminal, and deliberately ranked above everything: once Meta says a
    // message failed, a stale in-flight receipt must not paint it as fine.
    failed: 4,
};

const whatsappMessageSchema = new mongoose.Schema({
    /** Meta's wamid. Absent only while an outbound send is still in flight. */
    messageId: {
        type: String,
        index: true,
        sparse: true,
    },
    direction: {
        type: String,
        enum: ['inbound', 'outbound'],
        required: true,
        index: true,
    },
    type: {
        type: String,
        enum: [
            'text', 'template', 'image', 'document', 'audio', 'video',
            'sticker', 'location', 'contacts', 'interactive', 'button',
            'reaction', 'order', 'system', 'unsupported', 'unknown',
        ],
        default: 'text',
    },
    /** E.164 without the plus, as Meta uses (`96550683207`). */
    from: { type: String, index: true },
    to: { type: String, index: true },
    /** Text body, caption, or a short description of a non-text payload. */
    body: { type: String },
    /** Template name for template sends, so a failure can be traced to it. */
    templateName: { type: String },
    /** Where the media ended up in our own storage, if this carried any. */
    media: {
        whatsappMediaId: String,
        mimeType: String,
        sha256: String,
        fileSize: Number,
        url: String,          // our copy (Cloudinary), never Meta's signed URL
        publicId: String,
        filename: String,
    },
    status: {
        type: String,
        enum: Object.keys(STATUS_RANK),
        default: 'queued',
        index: true,
    },
    /** Meta's numeric error code, e.g. 131047 (re-engagement window closed). */
    errorCode: { type: Number },
    errorMessage: { type: String },
    /** Why we sent it — order confirmation, status update, AI reply, etc. */
    context: { type: String },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppConversation' },
    /** wamid this is a reply to, when the customer replied to a specific message. */
    replyTo: { type: String },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    failedAt: { type: Date },
}, { timestamps: true });

/* Conversation view: newest first for one counterparty. */
whatsappMessageSchema.index({ from: 1, createdAt: -1 });
whatsappMessageSchema.index({ to: 1, createdAt: -1 });

/*
 * Six months, matching the visit log. Long enough to answer "what did we tell
 * that customer in March", short enough that a shop's WhatsApp history is not
 * an ever-growing store of personal data nobody chose to keep.
 */
whatsappMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

/**
 * Apply a status transition, ignoring one that would move backwards.
 *
 * @returns {Promise<boolean>} whether the status actually changed.
 */
whatsappMessageSchema.statics.applyStatus = async function (messageId, status, extra = {}) {
    if (!messageId || !(status in STATUS_RANK)) return false;

    const doc = await this.findOne({ messageId });
    if (!doc) return false;

    // Out-of-order receipt for a stage we have already passed. Meta makes no
    // ordering guarantee, so this is expected traffic rather than a fault.
    if (STATUS_RANK[status] <= STATUS_RANK[doc.status] && doc.status !== 'queued') {
        return false;
    }

    doc.status = status;
    const stamp = { sent: 'sentAt', delivered: 'deliveredAt', read: 'readAt', failed: 'failedAt' }[status];
    if (stamp) doc[stamp] = extra.timestamp || new Date();
    if (extra.errorCode !== undefined) doc.errorCode = extra.errorCode;
    if (extra.errorMessage) doc.errorMessage = String(extra.errorMessage).slice(0, 500);

    await doc.save();
    return true;
};

module.exports = mongoose.model('WhatsAppMessage', whatsappMessageSchema);
module.exports.STATUS_RANK = STATUS_RANK;
