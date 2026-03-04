/**
 * Push Notification Service
 * Sends Web Push notifications using the web-push library
 */
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// Configure VAPID keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@arteva.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('✅ Web Push configured with VAPID keys');
} else {
    console.warn('⚠️ VAPID keys not set - push notifications disabled');
}

/**
 * Send push notification to a specific user
 * @param {string} userId - User ID
 * @param {Object} payload - Notification payload { title, body, url, orderNumber }
 */
async function sendPushToUser(userId, payload) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        console.log('Push skipped - VAPID keys not configured');
        return;
    }

    try {
        const subscriptions = await PushSubscription.find({ userId });
        if (!subscriptions.length) return;

        const payloadStr = JSON.stringify(payload);
        const results = [];

        for (const sub of subscriptions) {
            try {
                await webpush.sendNotification(sub.subscription, payloadStr);
                results.push({ success: true });
            } catch (err) {
                if (err.statusCode === 404 || err.statusCode === 410) {
                    // Subscription expired or invalid - remove it
                    await PushSubscription.findByIdAndDelete(sub._id);
                    console.log(`🗑️ Removed expired push subscription for user ${userId}`);
                } else {
                    console.error(`Push error for user ${userId}:`, err.message);
                }
                results.push({ success: false, error: err.message });
            }
        }

        return results;
    } catch (err) {
        console.error('sendPushToUser error:', err);
    }
}

/**
 * Send order status notification
 */
async function sendOrderStatusPush(userId, orderNumber, status) {
    const statusMessages = {
        'confirmed': 'Your order has been confirmed! 🎉',
        'processing': 'Your order is being prepared 📦',
        'packed': 'Your order has been packed and is ready for shipping 📦',
        'handed_over': 'Your order has been handed to the delivery driver 🚗',
        'out_for_delivery': 'Your order is on its way! 🚀',
        'delivered': 'Your order has been delivered! Enjoy ✨',
        'cancelled': 'Your order has been cancelled'
    };

    const body = statusMessages[status] || `Order #${orderNumber} status updated to: ${status}`;

    return sendPushToUser(userId, {
        title: `Order #${orderNumber}`,
        body,
        url: `/orders.html`,
        orderNumber,
        tag: `order-${orderNumber}`,
        actions: [{ action: 'view', title: 'Track Order' }]
    });
}

/**
 * Get VAPID public key for client subscription
 */
function getVapidPublicKey() {
    return VAPID_PUBLIC_KEY || null;
}

module.exports = {
    sendPushToUser,
    sendOrderStatusPush,
    getVapidPublicKey
};
