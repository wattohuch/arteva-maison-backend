/**
 * Deema BNPL Payment Controller
 * Based on the OFFICIAL Deema WooCommerce Plugin flow:
 * 
 * 1. POST /api/merchant/v1/purchase → get redirect_link
 * 2. Customer approves on Deema page
 * 3. Deema redirects to success URL with ?reference=XXX
 * 4. We verify and confirm the order
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
        console.log(`[DEEMA][PROMO] ✅ Usage counted for promo "${order.promoCode.code}" (order ${order.orderNumber})`);
    } catch (err) {
        console.error(`[DEEMA][PROMO] ⚠️ Failed to increment usage:`, err.message);
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

    // Create Deema purchase
    try {
        const purchase = await deemaService.createPurchase({
            amount: total,
            orderNumber: order.orderNumber
        });

        // Store Deema reference on order
        order.deemaChargeId = purchase.orderReference; // Deema order reference
        order.notes = `Deema Purchase ID: ${purchase.purchaseId}`;
        await order.save();

        res.json({
            success: true,
            data: {
                paymentUrl: purchase.redirectLink,
                orderReference: purchase.orderReference,
                orderNumber: order.orderNumber,
                orderId: order._id
            }
        });

    } catch (payErr) {
        order.paymentStatus = 'failed';
        order.orderStatus = 'cancelled';
        order.notes = `Deema purchase failed: ${payErr.message}`;
        await order.save();

        res.status(502);
        throw new Error(`Deema payment failed: ${payErr.message}`);
    }
});

// ═══════════════════════════════════════════════════
// CALLBACK (Deema redirects here after approval)
// Query params: ?reference=XXX (success) or ?status=failed (failure)
// ═══════════════════════════════════════════════════
const handleDeemaCallback = asyncHandler(async (req, res) => {
    const { reference, status } = req.query;

    console.log('[DEEMA] Callback received:', req.query);

    const frontendUrl = process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com';

    // Handle failure
    if (status === 'failed' || !reference) {
        console.log('[DEEMA] Payment failed or cancelled');
        // Try to find and cancel the order
        if (reference) {
            const order = await Order.findOne({ deemaChargeId: reference });
            if (order && order.paymentStatus !== 'paid') {
                order.paymentStatus = 'failed';
                order.orderStatus = 'cancelled';
                order.notes = 'Deema payment failed/cancelled by customer';
                await order.save();
            }
        }
        return res.redirect(`${frontendUrl}/payment-error.html?error=payment_failed`);
    }

    // Success — find order by Deema reference
    try {
        const order = await Order.findOne({ deemaChargeId: reference }).populate('user', 'name email phone language');

        if (!order) {
            console.error('[DEEMA] Order not found for reference:', reference);
            return res.redirect(`${frontendUrl}/payment-error.html?error=order_not_found`);
        }

        // Idempotency: already paid
        if (order.paymentStatus === 'paid') {
            return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);
        }

        // ✅ Payment approved by Deema
        order.paymentStatus = 'paid';
        order.orderStatus = 'confirmed';
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

        // Send notifications (background, don't block redirect)
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
        return res.redirect(`${frontendUrl}/order-success.html?order=${order.orderNumber}`);

    } catch (err) {
        console.error('[DEEMA] Callback error:', err.message);
        return res.redirect(`${frontendUrl}/payment-error.html?error=verification_failed`);
    }
});

// ═══════════════════════════════════════════════════
// WEBHOOK (server-to-server from Deema)
// ═══════════════════════════════════════════════════
const handleDeemaWebhook = asyncHandler(async (req, res) => {
    const data = req.body;
    console.log('[DEEMA] Webhook received:', JSON.stringify(data, null, 2));

    // Deema sends webhook with order reference
    const reference = data.reference || data.order_reference || data.merchant_order_id;
    if (!reference) {
        return res.status(200).json({ received: true });
    }

    try {
        // Try to find by Deema reference or by order number
        let order = await Order.findOne({ deemaChargeId: reference }).populate('user', 'name email phone language');
        if (!order) {
            order = await Order.findOne({ orderNumber: reference }).populate('user', 'name email phone language');
        }

        if (!order) {
            console.warn('[DEEMA] Webhook: order not found for reference', reference);
            return res.status(200).json({ received: true });
        }

        // Only process if not already paid
        const webhookStatus = (data.status || '').toLowerCase();
        if ((webhookStatus === 'approved' || webhookStatus === 'captured' || webhookStatus === 'completed') && order.paymentStatus !== 'paid') {
            order.paymentStatus = 'paid';
            order.orderStatus = 'confirmed';
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
// VERIFY DEEMA PAYMENT (manual check)
// ═══════════════════════════════════════════════════
const verifyDeemaPayment = asyncHandler(async (req, res) => {
    const { chargeId } = req.params;

    // Find order by Deema reference
    const order = await Order.findOne({ deemaChargeId: chargeId });

    if (!order) {
        res.status(404);
        throw new Error('Order not found for this Deema reference');
    }

    res.json({
        success: true,
        data: {
            orderNumber: order.orderNumber,
            deemaReference: order.deemaChargeId,
            paymentStatus: order.paymentStatus,
            orderStatus: order.orderStatus,
            total: order.total
        }
    });
});

module.exports = {
    createDeemaCheckout,
    handleDeemaCallback,
    handleDeemaWebhook,
    verifyDeemaPayment
};
