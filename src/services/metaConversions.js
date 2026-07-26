/**
 * ARTEVA Maison — Meta Conversions API
 *
 * The browser pixel is the unreliable half of Meta tracking: ad blockers,
 * Safari's ITP and iOS App Tracking Transparency all remove events, and a
 * customer who pays and then closes the tab before the success page renders
 * is never counted at all. This reports the same conversions from the server,
 * where none of that applies.
 *
 * Both halves are sent. `event_id` is what stops that being double counting —
 * Meta keeps whichever copy arrives first and discards the twin. The id is
 * derived from the order number so the browser and this file arrive at the
 * same value without having to pass one between them; the frontend computes
 * it identically in src/utils/metaPixel.js.
 *
 * Customer identifiers must be SHA-256 hashed before they leave here. That is
 * Meta's requirement and also simply correct: this sends an email address to a
 * third party, and it should never be readable in transit or at rest there.
 */

const crypto = require('crypto');
const axios = require('axios');

const PIXEL_ID = process.env.META_PIXEL_ID || '';
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || '';
const API_VERSION = process.env.META_API_VERSION || 'v21.0';
/** Set while testing so events land in Events Manager's Test Events tab. */
const TEST_CODE = process.env.META_TEST_EVENT_CODE || '';

const enabled = () => Boolean(PIXEL_ID && ACCESS_TOKEN);

/** Meta matches on normalised values: trimmed, lowercased, then hashed. */
function hash(value) {
    if (!value) return undefined;
    return crypto
        .createHash('sha256')
        .update(String(value).trim().toLowerCase())
        .digest('hex');
}

/** Phone numbers hash digits-only, without a leading + or any separators. */
function hashPhone(value) {
    if (!value) return undefined;
    const digits = String(value).replace(/[^0-9]/g, '');
    if (!digits) return undefined;
    return crypto.createHash('sha256').update(digits).digest('hex');
}

/** Must match purchaseEventId() in the frontend, character for character. */
function purchaseEventId(orderNumber) {
    return `purchase_${orderNumber}`;
}

/**
 * Send one event to Meta.
 * Never throws: conversion reporting must not be able to fail an order.
 */
async function sendEvent(payload) {
    if (!enabled()) return { success: false, skipped: true, reason: 'Meta CAPI not configured' };

    try {
        const body = { data: [payload] };
        if (TEST_CODE) body.test_event_code = TEST_CODE;

        const res = await axios.post(
            `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`,
            body,
            { params: { access_token: ACCESS_TOKEN }, timeout: 8000 }
        );

        console.log(`[META-CAPI] ${payload.event_name} accepted:`, res.data?.events_received ?? 'ok');
        return { success: true, received: res.data?.events_received };
    } catch (err) {
        // Meta puts the useful part in the response body, not the status text.
        const detail = err.response?.data?.error?.message || err.message;
        console.error(`[META-CAPI] ${payload.event_name} failed:`, detail);
        return { success: false, error: detail };
    }
}

/**
 * Report a completed purchase.
 *
 * @param {Object} order    the settled order
 * @param {Object} [user]   the buyer, for match quality
 * @param {Object} [ctx]    { ip, userAgent, fbp, fbc } from the original request
 */
async function trackPurchase(order, user, ctx = {}) {
    if (!enabled() || !order) return { success: false, skipped: true };

    const addr = order.shippingAddress || {};
    const items = order.items || [];

    /* Every identifier here is optional and every one improves attribution.
       fbp/fbc are the pixel's own browser cookies — when the checkout request
       carried them through, Meta can tie this server event to the ad click
       that started it. */
    const userData = {
        em: hash(user?.email),
        ph: hashPhone(user?.phone || addr.phone),
        fn: hash((user?.name || addr.fullName || '').split(' ')[0]),
        ct: hash(addr.city),
        country: hash(addr.country || 'KW'),
        client_ip_address: ctx.ip,
        client_user_agent: ctx.userAgent,
        fbp: ctx.fbp,
        fbc: ctx.fbc,
        external_id: hash(String(user?._id || order.user || '')),
    };

    // Meta rejects the payload if a key is present but undefined.
    Object.keys(userData).forEach(k => userData[k] === undefined && delete userData[k]);

    return sendEvent({
        event_name: 'Purchase',
        event_time: Math.floor(new Date(order.createdAt || Date.now()).getTime() / 1000),
        event_id: purchaseEventId(order.orderNumber),
        event_source_url: order.sourceUrl || process.env.FRONTEND_URL,
        action_source: 'website',
        user_data: userData,
        custom_data: {
            currency: order.currency || 'KWD',
            value: Number(order.total || 0),
            content_type: 'product',
            content_ids: items.map(i => String(i.product?._id || i.product || i._id)),
            contents: items.map(i => ({
                id: String(i.product?._id || i.product || i._id),
                quantity: Number(i.quantity) || 1,
                item_price: Number(i.price) || 0,
            })),
            num_items: items.reduce((n, i) => n + (Number(i.quantity) || 1), 0),
            order_id: order.orderNumber,
        },
    });
}

/** Config report for the admin diagnostics screen. */
function getStatus() {
    return {
        enabled: enabled(),
        pixelId: PIXEL_ID ? `${PIXEL_ID.slice(0, 6)}…` : 'not set',
        hasAccessToken: Boolean(ACCESS_TOKEN),
        apiVersion: API_VERSION,
        testMode: Boolean(TEST_CODE),
    };
}

module.exports = { trackPurchase, sendEvent, purchaseEventId, getStatus, enabled };
