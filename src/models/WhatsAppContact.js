const mongoose = require('mongoose');

/**
 * A person we have exchanged WhatsApp messages with.
 *
 * Kept separate from User because the two are not the same population: most
 * people who message the shop have never made an account, and the ones who
 * have may message from a different number than the one on their profile.
 * `user` links the two when we can establish it, and stays null when we cannot
 * rather than guessing.
 *
 * Only what is needed to hold a conversation is stored. Meta supplies a WhatsApp
 * profile name and nothing else useful; there is no reason to keep more.
 */
const whatsappContactSchema = new mongoose.Schema({
    /** Meta's wa_id — E.164 digits, no plus. The stable identity. */
    waId: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true,
    },
    /** Same digits with a leading +, for display and tel: links. */
    phone: { type: String, trim: true },
    /** The name on their WhatsApp profile. They control it; treat as a hint. */
    profileName: { type: String, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastInboundAt: { type: Date },
    lastOutboundAt: { type: Date },
    messageCount: { type: Number, default: 0 },
    /**
     * Set when someone asks not to be messaged again. Checked before every
     * non-transactional send: a shop that keeps messaging after being told to
     * stop gets its number reported, and Meta acts on that quickly.
     */
    optedOut: { type: Boolean, default: false },
}, { timestamps: true });

/**
 * Meta's 24-hour customer service window.
 *
 * Free-form text may only be sent within 24 hours of the customer's own last
 * message. Outside it, only an approved template will be delivered. This is
 * the check that decides which of the two a send should use.
 */
whatsappContactSchema.methods.isWithinServiceWindow = function () {
    if (!this.lastInboundAt) return false;
    return (Date.now() - this.lastInboundAt.getTime()) < 24 * 60 * 60 * 1000;
};

/** Find or create by wa_id, refreshing the profile name when Meta sends one. */
whatsappContactSchema.statics.upsertFromWebhook = async function (waId, profileName) {
    if (!waId) return null;
    const update = { $setOnInsert: { waId, phone: `+${waId}` } };
    if (profileName) update.$set = { profileName };

    return this.findOneAndUpdate({ waId }, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
    });
};

module.exports = mongoose.model('WhatsAppContact', whatsappContactSchema);
