const mongoose = require('mongoose');

/**
 * The live WhatsApp access token.
 *
 * ── Why this is in the database and not just an env var ──
 *
 * Meta's long-lived tokens last 60 days. They CAN be extended — re-exchanging
 * one returns a fresh 60 days and a new token string — but the new string has
 * to be stored somewhere, and the process cannot write to Render's environment
 * panel. Left in env alone, the token would expire every 60 days and WhatsApp
 * would stop dead until someone noticed and pasted a new one in by hand.
 *
 * So the database holds the current token and the environment holds the seed.
 * On boot the stored token wins if there is one; the refresher writes back here
 * and every instance picks it up. Nobody has to remember a date.
 *
 * Deliberately a single document, keyed by `singleton`. There is one token, and
 * a unique index makes that structurally true rather than a convention two
 * concurrent writers could break.
 */
const whatsAppTokenSchema = new mongoose.Schema({
    singleton: {
        type: String,
        default: 'whatsapp',
        unique: true,
        immutable: true,
    },

    token: { type: String, required: true },

    /** When Meta says it dies. Null means a permanent (system user) token. */
    expiresAt: { type: Date, default: null },

    /** When this row was last written, successfully or not. */
    refreshedAt: { type: Date, default: Date.now },

    /**
     * How it got here — 'env' (seeded at boot), 'auto' (the refresher),
     * or 'manual' (someone ran the script). Useful when working out why a
     * token is older than expected.
     */
    source: {
        type: String,
        enum: ['env', 'auto', 'manual'],
        default: 'env',
    },

    /** Last failure, so a silently failing refresh is visible. */
    lastError: { type: String, default: null },

    /** Stops one alert email per check once the owner has been told. */
    lastAlertAt: { type: Date, default: null },
}, { timestamps: true });

/** Days until expiry, or null for a token that does not expire. */
whatsAppTokenSchema.methods.daysRemaining = function () {
    if (!this.expiresAt) return null;
    return Math.round((this.expiresAt.getTime() - Date.now()) / 86400000);
};

module.exports = mongoose.model('WhatsAppToken', whatsAppTokenSchema);
