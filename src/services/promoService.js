/**
 * ARTÉVA Maison — Promo Code Service
 *
 * Single source of truth for what a promo code is worth on a given basket.
 *
 * This used to exist twice: `validatePromoCode` (shown to the shopper at
 * checkout) ignored `maxDiscountedQuantity` and `maxQuantityPerOrder`, while
 * `executePayment` (what actually charged the card) enforced both. A shopper
 * with 10 discounted units in the basket was quoted the full discount and then
 * charged more. Both paths now call `calculateDiscount` so the quote and the
 * charge cannot drift.
 */

const PromoCode = require('../models/PromoCode');
const PromoVisit = require('../models/PromoVisit');

/** Money in this app is KWD with 3 decimals. */
const round3 = (n) => parseFloat((Number(n) || 0).toFixed(3));

/**
 * Work out the discount a promo code grants over a basket.
 *
 * @param {Object} promo  a PromoCode document with `products.product` populated
 * @param {Array}  items  [{ product, name, price, quantity }]
 * @returns {{ discounts: Array, totalDiscount: number, matchedProducts: number, discountedUnits: number }}
 */
function calculateDiscount(promo, items) {
    const discounts = [];
    let totalDiscount = 0;
    let discountedUnits = 0;

    for (const item of items || []) {
        const itemProductId = String(item.product?._id || item.product || '');
        if (!itemProductId) continue;

        const rule = (promo.products || []).find(
            p => String(p.product?._id || p.product) === itemProductId
        );
        if (!rule) continue;

        const price = Number(item.price) || 0;
        const quantity = Math.max(0, Number(item.quantity) || 0);
        let allowedQuantity = quantity;

        // Per-product cap: "20% off, but only on the first 2 units".
        if (rule.maxDiscountedQuantity !== null && rule.maxDiscountedQuantity !== undefined) {
            allowedQuantity = Math.min(allowedQuantity, rule.maxDiscountedQuantity);
        }

        // Basket-wide cap, consumed in item order.
        if (promo.maxQuantityPerOrder !== null && promo.maxQuantityPerOrder !== undefined) {
            allowedQuantity = Math.min(
                allowedQuantity,
                Math.max(0, promo.maxQuantityPerOrder - discountedUnits)
            );
        }

        if (allowedQuantity <= 0) continue;

        let discount = rule.discountType === 'percentage'
            ? (price * rule.discountValue / 100) * allowedQuantity
            : rule.discountValue * allowedQuantity;

        // A discount can zero a line out but never make it negative.
        discount = Math.min(discount, price * allowedQuantity);

        discounts.push({
            product: itemProductId,
            productName: item.name || rule.product?.name || 'Product',
            originalPrice: price,
            discountType: rule.discountType,
            discountValue: rule.discountValue,
            quantity,
            discountedQuantity: allowedQuantity,
            discountAmount: round3(discount),
        });

        totalDiscount += discount;
        discountedUnits += allowedQuantity;
    }

    return {
        discounts,
        totalDiscount: round3(totalDiscount),
        matchedProducts: discounts.length,
        discountedUnits,
    };
}

/**
 * Resolve a code string to a usable promo, or explain why it is not.
 * @returns {Promise<{ ok: boolean, promo?, reason?: string }>}
 */
async function resolveForUser(code, userId) {
    if (!code || !String(code).trim()) {
        return { ok: false, reason: 'Promo code is required' };
    }

    const promo = await PromoCode.findOne({ code: String(code).toUpperCase().trim() })
        .populate('products.product', 'name nameAr price');

    if (!promo) return { ok: false, reason: 'Invalid promo code' };

    const validity = promo.canUserUse(userId);
    if (!validity.valid) return { ok: false, reason: validity.reason };

    return { ok: true, promo };
}

/**
 * Build the `order.promoCode` subdocument for a basket, or null when the code
 * does not apply. Used by both online checkout and admin receipts.
 *
 * @param {string} code
 * @param {Array}  items
 * @param {Object} opts  { userId, source, visitId }
 */
async function buildOrderPromo(code, items, { userId, source = 'manual_entry', visitId } = {}) {
    const resolved = await resolveForUser(code, userId);
    if (!resolved.ok) return { promoData: null, reason: resolved.reason };

    const { promo } = resolved;
    const { discounts, totalDiscount } = calculateDiscount(promo, items);

    if (totalDiscount <= 0) {
        return { promoData: null, reason: 'This promo code does not apply to these items' };
    }

    return {
        promoData: {
            code: promo.code,
            name: promo.name,
            promoCodeId: promo._id,
            totalDiscount,
            source,
            visitId: visitId || undefined,
            usageCounted: false,
            discounts: discounts.map(d => ({
                product: d.product,
                productName: d.productName,
                discountType: d.discountType,
                discountValue: d.discountValue,
                discountedQuantity: d.discountedQuantity,
                discountAmount: d.discountAmount,
            })),
        },
        promo,
        reason: null,
    };
}

/**
 * Count a promo use exactly once for an order.
 *
 * Guarded by `order.promoCode.usageCounted`, because this is called from three
 * places that can all fire for the same order (payment callback, verify
 * endpoint, gateway webhook). The guard is applied with a conditional update on
 * the order itself, so two concurrent callbacks cannot both pass it.
 *
 * @returns {Promise<boolean>} true when this call is the one that counted it.
 */
async function countUsageOnce(order) {
    const promoRef = order.promoCode;
    if (!promoRef || !promoRef.promoCodeId || promoRef.usageCounted) return false;

    const Order = require('../models/Order');

    // Claim the right to count, atomically. Only one caller wins.
    const claimed = await Order.updateOne(
        { _id: order._id, 'promoCode.usageCounted': { $ne: true } },
        { $set: { 'promoCode.usageCounted': true } }
    );
    if (claimed.modifiedCount === 0) return false;

    const userId = order.user?._id || order.user;

    // Increment the global counter and the per-user tally in one round trip.
    // The positional filter updates an existing usedBy row; if the user has
    // never used the code, the $push branch below adds one.
    const bumped = await PromoCode.updateOne(
        { _id: promoRef.promoCodeId, 'usedBy.user': userId },
        { $inc: { usageCount: 1, 'usedBy.$.count': 1 } }
    );

    if (bumped.matchedCount === 0) {
        await PromoCode.updateOne(
            { _id: promoRef.promoCodeId },
            {
                $inc: { usageCount: 1 },
                $push: { usedBy: { user: userId, count: 1 } },
            }
        );
    }

    // Close the loop on attribution: mark the originating visit as converted.
    await markVisitConverted(order).catch(err => {
        console.error('[PROMO] Visit conversion update failed:', err.message);
    });

    console.log(`[PROMO] ✅ Usage counted for "${promoRef.code}" (order ${order.orderNumber})`);
    return true;
}

/**
 * Reverse a counted usage — used when an owner deletes an order outright, so a
 * cancelled sale does not permanently consume a limited-use code.
 */
async function releaseUsage(order) {
    const promoRef = order.promoCode;
    if (!promoRef || !promoRef.promoCodeId || !promoRef.usageCounted) return;

    const userId = order.user?._id || order.user;

    await PromoCode.updateOne(
        { _id: promoRef.promoCodeId, usageCount: { $gt: 0 } },
        { $inc: { usageCount: -1 } }
    );
    // $elemMatch, not a dotted `usedBy.$.count` filter: the positional `$`
    // operator is only meaningful in the update document, so using it in the
    // query silently matches nothing and the per-user tally never decrements.
    await PromoCode.updateOne(
        {
            _id: promoRef.promoCodeId,
            usedBy: { $elemMatch: { user: userId, count: { $gt: 0 } } },
        },
        { $inc: { 'usedBy.$.count': -1 } }
    );

    if (promoRef.visitId) {
        await PromoVisit.updateOne(
            { _id: promoRef.visitId },
            { $set: { converted: false, orderTotal: 0, discountGiven: 0 }, $unset: { order: 1, convertedAt: 1 } }
        ).catch(() => {});
    }
}

/**
 * Attach a conversion to the visit that brought this order in.
 *
 * Prefers the explicit `visitId` captured at checkout. Falls back to the most
 * recent unconverted visit by the same user for the same code, which covers a
 * shopper who landed on the link, made an account and ordered later.
 */
async function markVisitConverted(order) {
    const promoRef = order.promoCode;
    if (!promoRef?.promoCodeId) return;

    const patch = {
        converted: true,
        convertedAt: new Date(),
        order: order._id,
        orderTotal: order.total || 0,
        discountGiven: promoRef.totalDiscount || 0,
    };

    if (promoRef.visitId) {
        const res = await PromoVisit.updateOne({ _id: promoRef.visitId }, { $set: patch });
        if (res.matchedCount > 0) return;
    }

    const userId = order.user?._id || order.user;
    if (!userId) return;

    await PromoVisit.findOneAndUpdate(
        { promoCodeId: promoRef.promoCodeId, user: userId, converted: false },
        { $set: patch },
        { sort: { createdAt: -1 } }
    );
}

/**
 * Record a visit carrying a promo code. Idempotent per visitor per day.
 * @returns {Promise<Object|null>} the visit document, or null if the code is unknown.
 */
async function recordVisit({ code, visitorId, ip, userAgent, referrer, landingPage, source, userId }) {
    if (!code || !visitorId) return null;

    const promo = await PromoCode.findOne({ code: String(code).toUpperCase().trim() })
        .select('_id code isActive expiresAt');

    // Unknown codes are not tracked — otherwise anyone could fill the
    // collection by hitting the endpoint with random strings.
    if (!promo) return null;

    const date = new Date().toISOString().split('T')[0];

    const visit = await PromoVisit.findOneAndUpdate(
        { promoCodeId: promo._id, visitorId, date },
        {
            $setOnInsert: {
                promoCodeId: promo._id,
                code: promo.code,
                visitorId,
                date,
                source: source === 'manual_entry' ? 'manual_entry' : 'link',
                createdAt: new Date(),
            },
            $set: {
                ip: ip || '',
                userAgent: (userAgent || '').slice(0, 300),
                referrer: (referrer || '').slice(0, 300),
                landingPage: (landingPage || '/').slice(0, 200),
                ...(userId ? { user: userId } : {}),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return visit;
}

module.exports = {
    round3,
    calculateDiscount,
    resolveForUser,
    buildOrderPromo,
    countUsageOnce,
    releaseUsage,
    markVisitConverted,
    recordVisit,
};
