/**
 * Deema BNPL Payment Controller
 * Handles checkout, callback, and webhook for Deema payments
 */

const { asyncHandler } = require('../middleware/error');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const PromoCode = require('../models/PromoCode');
const deemaService = require('../services/deemaService');
const { sendOrderConfirmation } = require('../services/emailService');

// Helper: Increment promo code usage AFTER payment is confirmed
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
        console.log(`[DEEMA][PROMO] ✅ Usage counted for promo "${order.promoCode.code}" (order ${order.orderNumber})`);
    } catch (err) {
        console.error(`[DEEMA][PROMO] ⚠️ Failed to increment usage for order ${order.orderNumber}:`, err.message);
    }
}

// ═══════════════════════════════════════════════════
// CREATE DEEMA CHECKOUT
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
            throw new Error(`Product not found in cart`);
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

    // Create Deema charge
    try {
        const charge = await deemaService.createCharge({
            amount: total,
            orderNumber: order.orderNumber,
            orderId: order._id.toString(),
            customerName: req.user.name,
            customerEmail: req.user.email,
            customerPhone: shippingAddress.phone
        });

        // Store Deema charge ID on order
        order.deemaChargeId = charge.chargeId;
        await order.save();

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
        // Payment failed — mark order as failed
        order.paymentStatus = 'failed';
        order.orderStatus = 'cancelled';
        order.notes = `Deema charge creation failed: ${payErr.message}`;
        await order.save();

        res.status(502);
        throw new Error(`Deema payment failed: ${payErr.message}`);
    }
});

// ═══════════════════════════════════════════════════
// CALLBACK (redirect after payment)
// ═══════════════════════════════════════════════════
const handleDeemaCallback = asyncHandler(async (req, res) => {
    const { tap_id } = req.query;

    console.log('[DEEMA] Callback received:', req.query);

    if (!tap_id) {
        return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=missing_charge_id`);
    }

    try {
        const chargeStatus = await deemaService.getChargeStatus(tap_id);
        console.log('[DEEMA] Charge status:', chargeStatus);

        // Find order by charge ID or metadata
        let order = await Order.findById(chargeStatus.orderId).populate('user', 'name email phone language');
        if (!order) {
            order = await Order.findOne({ deemaChargeId: tap_id }).populate('user', 'name email phone language');
        }
        if (!order) {
            order = await Order.findOne({ orderNumber: chargeStatus.orderNumber }).populate('user', 'name email phone language');
        }

        if (!order) {
            console.error('[DEEMA] Order not found for charge:', tap_id);
            return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=order_not_found`);
        }

        if (chargeStatus.status === 'CAPTURED') {
            // Idempotency check
            if (order.paymentStatus === 'paid') {
                return res.redirect(`${process.env.FRONTEND_URL}/order-success.html?order=${order.orderNumber}`);
            }

            // Amount verification
            if (chargeStatus.amount && Math.abs(chargeStatus.amount - order.total) > 0.01) {
                order.paymentStatus = 'failed';
                order.orderStatus = 'cancelled';
                order.notes = 'Deema amount mismatch';
                await order.save();
                return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=amount_mismatch`);
            }

            // ✅ Payment successful
            order.paymentStatus = 'paid';
            order.orderStatus = 'confirmed';
            order.deemaChargeId = tap_id;
            order.paidAt = new Date();

            // Update stock
            for (const item of order.items) {
                await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
            }

            // Clear cart
            await Cart.findOneAndUpdate({ user: order.user._id || order.user }, { items: [] });

            // Promo usage
            await incrementPromoUsage(order);

            await order.save();

            // Send notifications (background, don't block)
            try { await sendOrderConfirmation(order, order.user); } catch (e) { /* silent */ }
            try {
                const whatsapp = require('../services/whatsappService');
                whatsapp.sendAllOrderNotifications(order, order.user);
            } catch (e) { /* silent */ }
            try {
                const { emitNewOrder } = require('../socketHandler');
                emitNewOrder(order);
            } catch (e) { /* silent */ }

            console.log(`[DEEMA] ✅ Payment confirmed for order ${order.orderNumber}`);
            return res.redirect(`${process.env.FRONTEND_URL}/order-success.html?order=${order.orderNumber}`);

        } else {
            // Payment failed or cancelled
            if (order.paymentStatus !== 'paid') {
                order.paymentStatus = 'failed';
                order.orderStatus = 'cancelled';
                order.notes = `Deema payment ${chargeStatus.status}`;
                await order.save();
            }
            return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=payment_${chargeStatus.status.toLowerCase()}&order=${order.orderNumber}`);
        }
    } catch (err) {
        console.error('[DEEMA] Callback error:', err.message);
        return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=verification_failed`);
    }
});

// ═══════════════════════════════════════════════════
// WEBHOOK (server-to-server notification)
// ═══════════════════════════════════════════════════
const handleDeemaWebhook = asyncHandler(async (req, res) => {
    const data = req.body;
    console.log('[DEEMA] Webhook received:', JSON.stringify(data, null, 2));

    const chargeId = data.id;
    if (!chargeId) {
        return res.status(200).json({ received: true }); // Ack even if missing
    }

    try {
        const chargeStatus = await deemaService.getChargeStatus(chargeId);

        let order = await Order.findById(chargeStatus.orderId).populate('user', 'name email phone language');
        if (!order) {
            order = await Order.findOne({ deemaChargeId: chargeId }).populate('user', 'name email phone language');
        }

        if (!order) {
            console.warn('[DEEMA] Webhook: order not found for charge', chargeId);
            return res.status(200).json({ received: true });
        }

        // Only process if payment is CAPTURED and not already processed
        if (chargeStatus.status === 'CAPTURED' && order.paymentStatus !== 'paid') {
            order.paymentStatus = 'paid';
            order.orderStatus = 'confirmed';
            order.deemaChargeId = chargeId;
            order.paidAt = new Date();

            for (const item of order.items) {
                await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
            }

            await Cart.findOneAndUpdate({ user: order.user._id || order.user }, { items: [] });
            await incrementPromoUsage(order);
            await order.save();

            try { await sendOrderConfirmation(order, order.user); } catch (e) { /* silent */ }
            try {
                const whatsapp = require('../services/whatsappService');
                whatsapp.sendAllOrderNotifications(order, order.user);
            } catch (e) { /* silent */ }
            try {
                const { emitNewOrder } = require('../socketHandler');
                emitNewOrder(order);
            } catch (e) { /* silent */ }

            console.log(`[DEEMA] ✅ Webhook: Payment confirmed for order ${order.orderNumber}`);
        }
    } catch (err) {
        console.error('[DEEMA] Webhook error:', err.message);
    }

    res.status(200).json({ received: true });
});

// ═══════════════════════════════════════════════════
// VERIFY DEEMA PAYMENT
// ═══════════════════════════════════════════════════
const verifyDeemaPayment = asyncHandler(async (req, res) => {
    const { chargeId } = req.params;

    const chargeStatus = await deemaService.getChargeStatus(chargeId);

    res.json({
        success: true,
        data: {
            chargeId: chargeStatus.chargeId,
            status: chargeStatus.status,
            amount: chargeStatus.amount,
            orderNumber: chargeStatus.orderNumber
        }
    });
});

module.exports = {
    createDeemaCheckout,
    handleDeemaCallback,
    handleDeemaWebhook,
    verifyDeemaPayment
};
