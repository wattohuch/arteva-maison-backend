const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    subscription: {
        endpoint: { type: String, required: true },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true }
        }
    },
    userAgent: String,
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 60 * 60 * 24 * 90 // Auto-delete after 90 days
    }
});

// Compound index: one subscription per endpoint per user
pushSubscriptionSchema.index({ userId: 1, 'subscription.endpoint': 1 }, { unique: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
