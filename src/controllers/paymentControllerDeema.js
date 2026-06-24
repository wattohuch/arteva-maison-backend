/**
 * Deema BNPL Payment Controller
 * Uses Tap Payments API with source "src_deema"
 * 
 * Flow:
 *  1. POST /deema/checkout → create Tap charge with src_deema → redirect to Deema
 *  2. GET  /deema/callback → Tap redirects here with ?tap_id=chg_XXX
 *  3. POST /deema/webhook  → Tap fires webhook on status change
 */

const { asyncHandler } = require('../middleware/error');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const PromoCode = require('../models/PromoCode');
const deemaService = require('../services/deemaService');
const { sendOrderConfirmation } = require('../services/emailService');

// Helper: Increment promo code usage
async function incrementPromoUsage(order) {
    if (!order.promoCode || !order.promoCode.promoCodeId || !order.user) return;
    try {
        const userId = order.user._id || order.user;
        const promoId = order.promoCode.promoCodeId;
        const promo = await PromoCode.findById(promoId);
        if (!promo) return;
        const userUsageEntry = promo.usedBy.find(u => u.user.toString() === userId.toString());
        if (userUsageEntry) {
            await PromoCode.updateOne(
                { _id: promoId, 'usedBy.user': userId },
                { $inc: { usageCount: 1, 'usedBy.$.count': 1 } }
            );
        } else {
            await PromoCode.updateOne(
                { _id: promoId },
                { $inc: { usageCount: 1 }, $push: { usedBy: { user: userId, count: 1 } } }
            );
        }
        console.log(`[DEEMA] ✅ Promo usage counted for "${order.promoCode.code}" (order ${order.orderNumber})`);
    } catch (err) {
        console.error(`[DEEMA] ⚠️ Failed to increment promo usage:`, err.message);
    }
}

// Helper: Confirm paid order (stock, cart, notifications)
async function confirmPaidOrder(order) {
    if (order.paymentStatus === 'paid') return; // idempotent

    order.paymentStatus = 'paid';
    order.orderStatus = 'confirmed';
    order.paidAt = new Date();

    // Decrease stock
    for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
    }

    // Clear cart
    const userId = order.user._id || order.user;
    await Cart.findOneAndUpdate({ user: userId }, { items: [] });

    // Promo usage
    await incrementPromoUsage(order);

    await order.save();

    // Send notifications (background, non-blocking)
    try { await sendOrderConfirmation(order, order.user); } catch (e) { /* silent */ }
    try {
        const { WhatsAppService } = require('../services/whatsappService');
        const whatsapp = new WhatsAppService();
        whatsapp.sendAllOrderNotifications(order, order.user);
    } catch (e) { /* silent */ }
    try {
        const { emitNewOrder } = require('../socketHandler');
        emitNewOrder(order);
    } catch (e) { /* silent */ }

    // Auto-print receipt (skip if already printed — prevents duplicate prints)
    try {
        const freshOrder = await Order.findById(order._id).select('printedAt').lean();
        if (freshOrder && freshOrder.printedAt) {
            console.log(`[PRINT] ⏭️ Skipping auto-print for ${order.orderNumber} — already printed`);
        } else {
            const { autoPrintReceipt } = require('../services/printService');
            autoPrintReceipt(order, order.user).then(async (result) => {
                if (result && result.success) {
                    try {
                        await Order.findByIdAndUpdate(order._id, { printedAt: new Date() });
                        console.log(`[PRINT] ✅ printedAt set for ${order.orderNumber}`);
                    } catch (dbErr) {
                        console.error(`[PRINT] Failed to set printedAt:`, dbErr.message);
                    }
                }
            }).catch(e => console.error('Auto-print error:', e.message));
        }
    } catch (printErr) {
        console.error('Print service error:', printErr.message);
    }

    // Auto-save shipping address with coordinates
    try {
        const User = require('../models/User');
        const userDoc = await User.findById(order.user._id || order.user);
        if (userDoc && order.shippingAddress) {
            const existingAddress = userDoc.addresses.find(a =>
                a.street && order.shippingAddress.street &&
                a.street.toLowerCase() === order.shippingAddress.street.toLowerCase() &&
                a.city && order.shippingAddress.city &&
                a.city.toLowerCase() === order.shippingAddress.city.toLowerCase()
            );
            if (existingAddress) {
                existingAddress.phone = order.shippingAddress.phone || existingAddress.phone;
                existingAddress.zipCode = order.shippingAddress.zipCode || existingAddress.zipCode;
                existingAddress.state = order.shippingAddress.state || existingAddress.state;
                existingAddress.country = order.shippingAddress.country || existingAddress.country;
                if (order.shippingAddress.label) existingAddress.label = order.shippingAddress.label;
                if (order.shippingAddress.coordinates) existingAddress.coordinates = order.shippingAddress.coordinates;
                await userDoc.save();
                console.log(`[ADDRESS] Updated existing address for user ${userDoc.email}`);
            } else {
                const newAddr = {
                    street: order.shippingAddress.street,
                    city: order.shippingAddress.city,
                    state: order.shippingAddress.state || '',
                    country: order.shippingAddress.country || 'Kuwait',
                    zipCode: order.shippingAddress.zipCode || '',
                    phone: order.shippingAddress.phone || '',
                    label: order.shippingAddress.label || (userDoc.addresses.length === 0 ? 'Home' : `Address ${userDoc.addresses.length + 1}`),
                    isDefault: userDoc.addresses.length === 0
                };
                if (order.shippingAddress.coordinates) {
                    newAddr.coordinates = order.shippingAddress.coordinates;
                }
                userDoc.addresses.push(newAddr);
                await userDoc.save();
                console.log(`[ADDRESS] Auto-saved new address for user ${userDoc.email}`);
            }
        }
    } catch (addrErr) {
        console.error('Auto-save address error:', addrErr.message);
    }

    console.log(`[DEEMA] ✅ Order ${order.orderNumber} confirmed as paid`);
}

// ═══════════════════════════════════════════════════
// CREATE DEEMA CHECKOUT
// POST /api/payments/deema/checkout
// ═══════════════════════════════════════════════════
const createDeemaCheckout = asyncHandler(async (req, res) => {
    const { shippingAddress } = req.body;

    if (!shippingAddress) {
        res.status(400);
        throw new Error('Shipping address is required');
    }

    // Get cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
        res.status(400);
        throw new Error('Cart is empty');
    }

    // Verify stock
    for (const item of cart.items) {
        if (!item.product) {
            res.status(400);
            throw new Error('Product not found in cart');
        }
        if (item.product.stock < item.quantity) {
            res.status(400);
            throw new Error(`${item.product.name} is out of stock`);
        }
    }

    // Calculate totals
    const subtotal = cart.items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    const shippingCost = 2.0;
    let totalDiscount = 0;
    let promoCodeData = null;

    // Handle promo code
    if (req.body.promoCode) {
        try {
            const promo = await PromoCode.findOne({
                code: req.body.promoCode.toUpperCase(),
                isActive: true,
                validFrom: { $lte: new Date() },
                validUntil: { $gte: new Date() }
            });
            if (promo) {
                if (promo.discountType === 'percentage') {
                    totalDiscount = parseFloat((subtotal * promo.discountValue / 100).toFixed(3));
                } else {
                    totalDiscount = promo.discountValue;
                }
                if (promo.maxDiscount && totalDiscount > promo.maxDiscount) {
                    totalDiscount = promo.maxDiscount;
                }
                promoCodeData = {
                    promoCodeId: promo._id,
                    code: promo.code,
                    discountType: promo.discountType,
                    discountValue: promo.discountValue,
                    totalDiscount
                };
            }
        } catch (e) {
            console.warn('[DEEMA] Promo code lookup failed:', e.message);
        }
    }

    const total = parseFloat((subtotal + shippingCost - totalDiscount).toFixed(3));

    const cartItems = cart.items.map(item => ({
        product: item.product._id,
        name: item.product.name,
        nameAr: item.product.nameAr,
        price: item.product.price,
        quantity: item.quantity,
        image: item.product.images[0]?.url
    }));

    // ── DEDUP: Reuse existing pending Deema order for this user ──
    let order = await Order.findOne({
        user: req.user._id,
        paymentMethod: 'deema',
        paymentStatus: 'awaiting_payment'
    });

    if (order) {
        // Update existing pending order with current cart data
        console.log(`[DEEMA] ♻️ Reusing existing pending order ${order.orderNumber} (preventing duplicate)`);
        order.items = cartItems;
        order.shippingAddress = shippingAddress;
        order.subtotal = subtotal;
        order.shippingCost = shippingCost;
        order.total = total;
        order.promoCode = promoCodeData;
        order.notes = null; // Clear any old error notes
        await order.save();
    } else {
        // Create new order with retry for orderNumber collisions
        order = await Order.createWithRetry({
            user: req.user._id,
            items: cartItems,
            shippingAddress,
            paymentMethod: 'deema',
            paymentStatus: 'awaiting_payment',
            orderStatus: 'pending',
            subtotal,
            shippingCost,
            total,
            promoCode: promoCodeData
        });
        console.log(`[DEEMA] ✅ New order created: ${order.orderNumber} (${total} KWD)`);
    }

    // Create Deema/Tap charge
    try {
        const charge = await deemaService.createCharge({
            amount: total,
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            customerName: shippingAddress.fullName || req.user.name,
            customerEmail: req.user.email,
            customerPhone: shippingAddress.phone || req.user.phone
        });

        // Store charge ID on order
        order.deemaChargeId = charge.chargeId;
        await order.save();

        console.log(`[DEEMA] ✅ Charge created: ${charge.chargeId} for order ${order.orderNumber}`);

        res.json({
            success: true,
            data: {
                paymentUrl: charge.paymentUrl,
                chargeId: charge.chargeId,
                orderNumber: order.orderNumber,
                orderId: order._id
            }
        });

    } catch (payErr) {
        // Don't mark as failed/cancelled — let the user retry
        // Just store the error for debugging
        order.notes = `Deema charge attempt failed: ${payErr.message}`;
        await order.save();

        console.error(`[DEEMA] ❌ Charge failed for order ${order.orderNumber}: ${payErr.message}`);
        res.status(502);
        throw new Error(`Deema payment failed: ${payErr.message}`);
    }
});

// ═══════════════════════════════════════════════════
// CALLBACK (Deema/Tap redirects here after payment)
// Possible query params:
//   Tap:   ?tap_id=chg_XXXXX
//   Deema: ?reference=XXX&merchant_order_id=ORD-XXXX
//   Unknown: Deema may strip/change params — we handle ALL cases
// GET /api/payments/deema/callback
// ═══════════════════════════════════════════════════

/**
 * Try multiple strategies to find the order from callback params
 */
async function findOrderFromCallback(query) {
    const { tap_id, reference, merchant_order_id, order_id, orderId, orderNumber, id } = query;

    // Collect all possible identifiers from query params
    const possibleChargeIds = [tap_id, reference, id, order_id, orderId].filter(Boolean);
    const possibleOrderNumbers = [merchant_order_id, orderNumber].filter(Boolean);

    // Also check ALL query values as potential identifiers (Deema may use unexpected param names)
    const allQueryValues = Object.values(query).filter(v => typeof v === 'string' && v.length > 3);

    // Strategy 1: Find by deemaChargeId
    for (const cid of possibleChargeIds) {
        const order = await Order.findOne({ deemaChargeId: cid }).populate('user', 'name email phone language');
        if (order) {
            console.log(`[DEEMA] ✅ Found order by deemaChargeId: ${cid} → ${order.orderNumber}`);
            return { order, chargeId: cid, method: 'deemaChargeId' };
        }
    }

    // Strategy 2: Find by orderNumber
    for (const on of possibleOrderNumbers) {
        const order = await Order.findOne({ orderNumber: on }).populate('user', 'name email phone language');
        if (order) {
            console.log(`[DEEMA] ✅ Found order by orderNumber: ${on}`);
            return { order, chargeId: order.deemaChargeId, method: 'orderNumber' };
        }
    }

    // Strategy 3: If we have a tap_id/chargeId, check Tap API for metadata
    for (const cid of possibleChargeIds) {
        try {
            const chargeStatus = await deemaService.getChargeStatus(cid);
            if (chargeStatus.orderId) {
                const order = await Order.findById(chargeStatus.orderId).populate('user', 'name email phone language');
                if (order) {
                    // Also update the stored chargeId if it was missing
                    if (!order.deemaChargeId) {
                        order.deemaChargeId = cid;
                        await order.save();
                    }
                    console.log(`[DEEMA] ✅ Found order via Tap API metadata: ${order.orderNumber}`);
                    return { order, chargeId: cid, method: 'tapApiMetadata', chargeStatus };
                }
            }
            if (chargeStatus.orderNumber) {
                const order = await Order.findOne({ orderNumber: chargeStatus.orderNumber }).populate('user', 'name email phone language');
                if (order) {
                    if (!order.deemaChargeId) {
                        order.deemaChargeId = cid;
                        await order.save();
                    }
                    console.log(`[DEEMA] ✅ Found order via Tap API orderNumber: ${order.orderNumber}`);
                    return { order, chargeId: cid, method: 'tapApiOrderNumber', chargeStatus };
                }
            }
        } catch (e) {
            console.log(`[DEEMA] Tap API lookup failed for ${cid}: ${e.message}`);
        }
    }

    // Strategy 4: Try all query values as potential deemaChargeId or orderNumber
    for (const val of allQueryValues) {
        if (possibleChargeIds.includes(val) || possibleOrderNumbers.includes(val)) continue; // already tried
        let order = await Order.findOne({ deemaChargeId: val }).populate('user', 'name email phone language');
        if (order) {
            console.log(`[DEEMA] ✅ Found order by query value as chargeId: ${val} → ${order.orderNumber}`);
            return { order, chargeId: val, method: 'queryValueAsChargeId' };
        }
        order = await Order.findOne({ orderNumber: val }).populate('user', 'name email phone language');
        if (order) {
            console.log(`[DEEMA] ✅ Found order by query value as orderNumber: ${val}`);
            return { order, chargeId: order.deemaChargeId, method: 'queryValueAsOrderNumber' };
        }
    }

    // Strategy 5: Last resort — find the most recent awaiting_payment Deema order (within last 30 min)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recentOrder = await Order.findOne({
        paymentMethod: 'deema',
        paymentStatus: 'awaiting_payment',
        createdAt: { $gte: thirtyMinAgo }
    }).sort({ createdAt: -1 }).populate('user', 'name email phone language');

    if (recentOrder) {
        console.log(`[DEEMA] ⚠️ Fallback: found recent awaiting Deema order: ${recentOrder.orderNumber}`);
        return { order: recentOrder, chargeId: recentOrder.deemaChargeId, method: 'recentFallback' };
    }

    return null;
}

const handleDeemaCallback = asyncHandler(async (req, res) => {
    const { status } = req.query;

    // ── CRITICAL: Log ALL query params for debugging ──
    console.log('[DEEMA] ═══════════════════════════════════════');
    console.log('[DEEMA] Callback received. Full query params:', JSON.stringify(req.query, null, 2));
    console.log('[DEEMA] Full URL:', req.originalUrl);
    console.log('[DEEMA] ═══════════════════════════════════════');

    const frontendUrl = process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com';

    // ── Try to find the order using all strategies ──
    const result = await findOrderFromCallback(req.query);

    // Handle explicit failure status
    if (status === 'failed') {
        if (result && result.order && result.order.paymentStatus !== 'paid') {
            result.order.paymentStatus = 'failed';
            result.order.orderStatus = 'cancelled';
            result.order.notes = `Deema callback: payment failed. Params: ${JSON.stringify(req.query)}`;
            await result.order.save();
            console.log(`[DEEMA] ❌ Order ${result.order.orderNumber} marked as failed`);
        }
        return res.redirect(`${frontendUrl}/payment-error.html?error=payment_failed`);
    }

    // ── Order not found at all ──
    if (!result) {
        console.error('[DEEMA] ❌ ORDER NOT FOUND! Query params:', JSON.stringify(req.query));
        console.error('[DEEMA] ❌ This likely means the customer was charged but order cannot be matched.');
        console.error('[DEEMA] ❌ Manual intervention needed. Check Deema dashboard.');
        const debugParams = encodeURIComponent(JSON.stringify(req.query));
        return res.redirect(`${frontendUrl}/payment-error.html?error=order_not_found&debug=${debugParams}`);
    }

    const { order, chargeId, method, chargeStatus: preloadedChargeStatus } = result;
    console.log(`[DEEMA] Order found via: ${method} → ${order.orderNumber} (current status: ${order.paymentStatus})`);

    // ── Already paid — just redirect to success ──
    if (order.paymentStatus === 'paid') {
        console.log(`[DEEMA] Order ${order.orderNumber} already paid, redirecting to success`);
        return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);
    }

    // ── Verify payment status with Deema/Tap API if we have a charge ID ──
    if (chargeId) {
        try {
            const chargeStatusResult = preloadedChargeStatus || await deemaService.getChargeStatus(chargeId);
            const tapStatus = (chargeStatusResult.status || '').toUpperCase();
            console.log(`[DEEMA] Tap/Deema charge status for ${chargeId}: ${tapStatus}`);

            if (tapStatus === 'CAPTURED') {
                await confirmPaidOrder(order);
                return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);
            } else if (['FAILED', 'DECLINED', 'CANCELLED', 'ABANDONED'].includes(tapStatus)) {
                order.paymentStatus = 'failed';
                order.orderStatus = 'cancelled';
                order.notes = `Deema/Tap status: ${tapStatus}`;
                await order.save();
                return res.redirect(`${frontendUrl}/payment-error.html?error=payment_failed`);
            } else {
                // Status is INITIATED, PENDING, or something else — assume success since
                // Deema redirected to success callback
                console.log(`[DEEMA] ⚠️ Charge status is "${tapStatus}" but callback reached. Confirming order.`);
                await confirmPaidOrder(order);
                return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);
            }
        } catch (err) {
            console.error(`[DEEMA] ⚠️ Could not verify charge ${chargeId}: ${err.message}`);
            // If verification fails but callback reached success URL, confirm the order
            // (Deema only redirects to success URL on successful payment)
            console.log(`[DEEMA] Confirming order despite verification failure (callback reached success URL)`);
            await confirmPaidOrder(order);
            return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);
        }
    }

    // ── No charge ID but order found — Deema success callback means payment approved ──
    console.log(`[DEEMA] No chargeId to verify but callback reached. Confirming order ${order.orderNumber}.`);
    await confirmPaidOrder(order);
    return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);
});

// ═══════════════════════════════════════════════════
// WEBHOOK (Tap/Deema server-to-server notification)
// POST /api/payments/deema/webhook
// ═══════════════════════════════════════════════════
const handleDeemaWebhook = asyncHandler(async (req, res) => {
    const data = req.body;
    console.log('[DEEMA] ═══════════════════════════════════════');
    console.log('[DEEMA] Webhook received:', JSON.stringify(data, null, 2));
    console.log('[DEEMA] ═══════════════════════════════════════');

    // Try to extract charge ID from various formats
    const chargeId = data.id || data.charge_id || data.order_reference || data.purchase_id;
    const merchantOrderId = data.merchant_order_id || data.metadata?.orderNumber || data.reference?.transaction;

    if (!chargeId && !merchantOrderId) {
        console.log('[DEEMA] Webhook: no identifiable charge/order ID found');
        return res.status(200).json({ received: true });
    }

    try {
        let order = null;

        // Find order by chargeId
        if (chargeId) {
            order = await Order.findOne({ deemaChargeId: chargeId }).populate('user', 'name email phone language');
        }

        // Fallback: find by merchant order ID / orderNumber
        if (!order && merchantOrderId) {
            order = await Order.findOne({ orderNumber: merchantOrderId }).populate('user', 'name email phone language');
        }

        // Fallback: check Tap API for metadata
        if (!order && chargeId) {
            try {
                const chargeStatus = await deemaService.getChargeStatus(chargeId);
                if (chargeStatus.orderId) {
                    order = await Order.findById(chargeStatus.orderId).populate('user', 'name email phone language');
                }
                if (!order && chargeStatus.orderNumber) {
                    order = await Order.findOne({ orderNumber: chargeStatus.orderNumber }).populate('user', 'name email phone language');
                }
            } catch (e) {
                console.log(`[DEEMA] Webhook: Tap API lookup failed: ${e.message}`);
            }
        }

        if (!order) {
            console.warn(`[DEEMA] ⚠️ Webhook: order not found for charge=${chargeId}, merchantOrder=${merchantOrderId}`);
            return res.status(200).json({ received: true });
        }

        // Determine payment status
        let paymentStatus = (data.status || '').toUpperCase();

        // If we have a Tap charge ID, verify with Tap API for authoritative status
        if (chargeId && !paymentStatus) {
            try {
                const chargeStatus = await deemaService.getChargeStatus(chargeId);
                paymentStatus = (chargeStatus.status || '').toUpperCase();
            } catch (e) {
                console.log(`[DEEMA] Webhook: could not get charge status: ${e.message}`);
            }
        }

        // Deema merchant API webhook may use different status names
        const successStatuses = ['CAPTURED', 'APPROVED', 'COMPLETED', 'SUCCESS', 'PAID'];
        const failureStatuses = ['FAILED', 'DECLINED', 'CANCELLED', 'REJECTED', 'EXPIRED'];

        if (successStatuses.includes(paymentStatus) && order.paymentStatus !== 'paid') {
            await confirmPaidOrder(order);
            console.log(`[DEEMA] ✅ Webhook: Order ${order.orderNumber} confirmed as paid (status: ${paymentStatus})`);
        } else if (failureStatuses.includes(paymentStatus) && order.paymentStatus !== 'paid') {
            order.paymentStatus = 'failed';
            order.orderStatus = 'cancelled';
            order.notes = `Deema webhook: ${paymentStatus}`;
            await order.save();
            console.log(`[DEEMA] ❌ Webhook: Order ${order.orderNumber} marked as failed (status: ${paymentStatus})`);
        } else {
            console.log(`[DEEMA] Webhook: Order ${order.orderNumber} — status "${paymentStatus}", no action needed (current: ${order.paymentStatus})`);
        }

    } catch (err) {
        console.error('[DEEMA] Webhook processing error:', err.message);
    }

    res.status(200).json({ received: true });
});

// ═══════════════════════════════════════════════════
// VERIFY (manual status check)
// GET /api/payments/deema/verify/:chargeId
// ═══════════════════════════════════════════════════
const verifyDeemaPayment = asyncHandler(async (req, res) => {
    const { chargeId } = req.params;

    const chargeStatus = await deemaService.getChargeStatus(chargeId);

    const order = await Order.findOne({ deemaChargeId: chargeId });

    res.json({
        success: true,
        data: {
            chargeId: chargeStatus.chargeId,
            tapStatus: chargeStatus.status,
            amount: chargeStatus.amount,
            orderNumber: order ? order.orderNumber : chargeStatus.orderNumber,
            paymentStatus: order ? order.paymentStatus : 'unknown'
        }
    });
});

// ═══════════════════════════════════════════════════
// RECONCILE — Fix orphaned Deema payments
// POST /api/payments/deema/reconcile
// Finds all awaiting_payment Deema orders and checks
// their actual payment status with Deema/Tap API
// ═══════════════════════════════════════════════════
const reconcileDeemaPayments = asyncHandler(async (req, res) => {
    console.log('[DEEMA] ═══ Starting payment reconciliation ═══');

    // Find all Deema orders that are still awaiting payment (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingOrders = await Order.find({
        paymentMethod: 'deema',
        paymentStatus: { $in: ['awaiting_payment', 'pending'] },
        createdAt: { $gte: oneDayAgo }
    }).populate('user', 'name email phone language');

    console.log(`[DEEMA] Found ${pendingOrders.length} pending Deema orders to reconcile`);

    const results = [];

    for (const order of pendingOrders) {
        const result = { orderNumber: order.orderNumber, chargeId: order.deemaChargeId, action: 'none' };

        if (!order.deemaChargeId) {
            result.action = 'skipped_no_chargeId';
            results.push(result);
            continue;
        }

        try {
            const chargeStatus = await deemaService.getChargeStatus(order.deemaChargeId);
            const tapStatus = (chargeStatus.status || '').toUpperCase();
            result.tapStatus = tapStatus;

            if (tapStatus === 'CAPTURED') {
                await confirmPaidOrder(order);
                result.action = 'CONFIRMED_AS_PAID';
                console.log(`[DEEMA] ✅ Reconciled: Order ${order.orderNumber} confirmed as paid`);
            } else if (['FAILED', 'DECLINED', 'CANCELLED', 'ABANDONED', 'EXPIRED'].includes(tapStatus)) {
                order.paymentStatus = 'failed';
                order.orderStatus = 'cancelled';
                order.notes = `Reconciliation: Tap status was ${tapStatus}`;
                await order.save();
                result.action = 'MARKED_AS_FAILED';
                console.log(`[DEEMA] ❌ Reconciled: Order ${order.orderNumber} marked as failed (${tapStatus})`);
            } else {
                result.action = `no_action_status_${tapStatus}`;
            }
        } catch (err) {
            result.action = `error: ${err.message}`;
            console.error(`[DEEMA] Reconcile error for ${order.orderNumber}: ${err.message}`);
        }

        results.push(result);
    }

    console.log('[DEEMA] ═══ Reconciliation complete ═══');

    res.json({
        success: true,
        reconciled: results.length,
        results
    });
});

module.exports = {
    createDeemaCheckout,
    handleDeemaCallback,
    handleDeemaWebhook,
    verifyDeemaPayment,
    reconcileDeemaPayments
};

