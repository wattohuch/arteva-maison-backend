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

    // Create order
    const order = await Order.create({
        user: req.user._id,
        items: cart.items.map(item => ({
            product: item.product._id,
            name: item.product.name,
            nameAr: item.product.nameAr,
            price: item.product.price,
            quantity: item.quantity,
            image: item.product.images[0]?.url
        })),
        shippingAddress,
        paymentMethod: 'deema',
        paymentStatus: 'awaiting_payment',
        orderStatus: 'pending',
        subtotal,
        shippingCost,
        total,
        promoCode: promoCodeData
    });

    console.log(`[DEEMA] Order created: ${order.orderNumber} (${total} KWD)`);

    // Create Tap charge with src_deema
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

        console.log(`[DEEMA] Tap charge created: ${charge.chargeId}`);

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
        order.paymentStatus = 'failed';
        order.orderStatus = 'cancelled';
        order.notes = `Deema charge failed: ${payErr.message}`;
        await order.save();

        res.status(502);
        throw new Error(`Deema payment failed: ${payErr.message}`);
    }
});

// ═══════════════════════════════════════════════════
// CALLBACK (Deema/Tap redirects here after payment)
// Possible query params:
//   Tap:   ?tap_id=chg_XXXXX
//   Deema: ?reference=XXX&merchant_order_id=ORD-XXXX
// GET /api/payments/deema/callback
// ═══════════════════════════════════════════════════
const handleDeemaCallback = asyncHandler(async (req, res) => {
    const { tap_id, reference, merchant_order_id, status } = req.query;

    console.log('[DEEMA] Callback received:', req.query);

    const frontendUrl = process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com';

    // Handle explicit failure
    if (status === 'failed') {
        // Try to find and cancel the order
        if (merchant_order_id) {
            const order = await Order.findOne({ orderNumber: merchant_order_id });
            if (order && order.paymentStatus !== 'paid') {
                order.paymentStatus = 'failed';
                order.orderStatus = 'cancelled';
                await order.save();
            }
        }
        return res.redirect(`${frontendUrl}/payment-error.html?error=payment_failed`);
    }

    // Determine what ID we have
    const chargeId = tap_id || reference || null;

    // CASE 1: Tap redirect with tap_id
    if (tap_id) {
        try {
            const chargeStatus = await deemaService.getChargeStatus(tap_id);
            let order = await Order.findOne({ deemaChargeId: tap_id }).populate('user', 'name email phone language');
            if (!order && chargeStatus.orderId) {
                order = await Order.findById(chargeStatus.orderId).populate('user', 'name email phone language');
            }
            if (!order) {
                return res.redirect(`${frontendUrl}/payment-error.html?error=order_not_found`);
            }

            const tapStatus = (chargeStatus.status || '').toUpperCase();
            if (tapStatus === 'CAPTURED') {
                await confirmPaidOrder(order);
                return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);
            } else if (['FAILED', 'DECLINED', 'CANCELLED', 'ABANDONED'].includes(tapStatus)) {
                if (order.paymentStatus !== 'paid') {
                    order.paymentStatus = 'failed';
                    order.orderStatus = 'cancelled';
                    order.notes = `Tap status: ${tapStatus}`;
                    await order.save();
                }
                return res.redirect(`${frontendUrl}/payment-error.html?error=payment_failed`);
            } else {
                return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);
            }
        } catch (err) {
            console.error('[DEEMA] Tap callback error:', err.message);
            return res.redirect(`${frontendUrl}/payment-error.html?error=verification_failed`);
        }
    }

    // CASE 2: Deema merchant API redirect with ?reference=XXX
    if (reference || merchant_order_id) {
        try {
            let order = null;

            // Find by Deema reference (stored in deemaChargeId)
            if (reference) {
                order = await Order.findOne({ deemaChargeId: reference }).populate('user', 'name email phone language');
            }

            // Fallback: find by order number
            if (!order && merchant_order_id) {
                order = await Order.findOne({ orderNumber: merchant_order_id }).populate('user', 'name email phone language');
            }

            if (!order) {
                return res.redirect(`${frontendUrl}/payment-error.html?error=order_not_found`);
            }

            // Deema success callback means payment approved
            if (order.paymentStatus !== 'paid') {
                await confirmPaidOrder(order);
            }
            return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);

        } catch (err) {
            console.error('[DEEMA] Merchant callback error:', err.message);
            return res.redirect(`${frontendUrl}/payment-error.html?error=verification_failed`);
        }
    }

    // No recognizable ID
    return res.redirect(`${frontendUrl}/payment-error.html?error=missing_charge_id`);
});

// ═══════════════════════════════════════════════════
// WEBHOOK (Tap server-to-server notification)
// POST /api/payments/deema/webhook
// ═══════════════════════════════════════════════════
const handleDeemaWebhook = asyncHandler(async (req, res) => {
    const data = req.body;
    console.log('[DEEMA] Webhook received:', JSON.stringify(data, null, 2));

    const chargeId = data.id;
    if (!chargeId) {
        return res.status(200).json({ received: true });
    }

    try {
        // Get full charge details from Tap
        const chargeStatus = await deemaService.getChargeStatus(chargeId);

        let order = await Order.findOne({ deemaChargeId: chargeId }).populate('user', 'name email phone language');
        if (!order && chargeStatus.orderId) {
            order = await Order.findById(chargeStatus.orderId).populate('user', 'name email phone language');
        }

        if (!order) {
            console.warn('[DEEMA] Webhook: order not found for charge', chargeId);
            return res.status(200).json({ received: true });
        }

        const tapStatus = (chargeStatus.status || '').toUpperCase();

        if (tapStatus === 'CAPTURED' && order.paymentStatus !== 'paid') {
            await confirmPaidOrder(order);
        } else if ((tapStatus === 'FAILED' || tapStatus === 'DECLINED' || tapStatus === 'CANCELLED') && order.paymentStatus !== 'paid') {
            order.paymentStatus = 'failed';
            order.orderStatus = 'cancelled';
            order.notes = `Deema/Tap webhook: ${tapStatus}`;
            await order.save();
        }

    } catch (err) {
        console.error('[DEEMA] Webhook error:', err.message);
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

module.exports = {
    createDeemaCheckout,
    handleDeemaCallback,
    handleDeemaWebhook,
    verifyDeemaPayment
};
