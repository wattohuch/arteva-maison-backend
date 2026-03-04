const express = require('express');
const router = express.Router();
const PushSubscription = require('../models/PushSubscription');
const { getVapidPublicKey } = require('../services/pushService');
const { protect } = require('../middleware/authMiddleware');

/**
 * GET /api/push/vapid-key
 * Returns the VAPID public key for client-side subscription
 */
router.get('/vapid-key', (req, res) => {
    const key = getVapidPublicKey();
    if (!key) {
        return res.status(503).json({ success: false, message: 'Push notifications not configured' });
    }
    res.json({ success: true, key });
});

/**
 * POST /api/push/subscribe
 * Save a push subscription for the authenticated user
 */
router.post('/subscribe', protect, async (req, res) => {
    try {
        const { subscription } = req.body;

        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({ success: false, message: 'Invalid subscription data' });
        }

        // Upsert: update if endpoint exists, create if not
        await PushSubscription.findOneAndUpdate(
            { userId: req.user._id, 'subscription.endpoint': subscription.endpoint },
            {
                userId: req.user._id,
                subscription,
                userAgent: req.headers['user-agent'],
                createdAt: new Date()
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: 'Subscribed to push notifications' });
    } catch (err) {
        console.error('Push subscribe error:', err);
        res.status(500).json({ success: false, message: 'Failed to save subscription' });
    }
});

/**
 * POST /api/push/unsubscribe
 * Remove a push subscription
 */
router.post('/unsubscribe', protect, async (req, res) => {
    try {
        const { endpoint } = req.body;

        if (!endpoint) {
            return res.status(400).json({ success: false, message: 'Endpoint required' });
        }

        await PushSubscription.deleteOne({
            userId: req.user._id,
            'subscription.endpoint': endpoint
        });

        res.json({ success: true, message: 'Unsubscribed from push notifications' });
    } catch (err) {
        console.error('Push unsubscribe error:', err);
        res.status(500).json({ success: false, message: 'Failed to unsubscribe' });
    }
});

module.exports = router;
