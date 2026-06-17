const { asyncHandler } = require('../middleware/error');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const PromoCode = require('../models/PromoCode');
const myfatoorah = require('../services/myfatoorahService');
const { getServiceForMethod, deemaService } = require('../services/myfatoorahService');
const { sendOrderConfirmation } = require('../services/emailService');
const { WhatsAppService } = require('../services/whatsappService');

// Helper: Increment promo code usage AFTER payment is confirmed
// This ensures usage is only counted for orders that actually paid
async function incrementPromoUsage(order) {
    if (!order.promoCode || !order.promoCode.promoCodeId || !order.user) return;
    try {
        const userId = order.user._id || order.user;
        const promoId = order.promoCode.promoCodeId;

        // Check if user already has a usage entry
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
        console.log(`[PROMO] ✅ Usage counted for promo "${order.promoCode.code}" (order ${order.orderNumber})`);
    } catch (err) {
        // Promo usage tracking failure should never block order confirmation
        console.error(`[PROMO] ⚠️ Failed to increment usage for order ${order.orderNumber}:`, err.message);
    }
}

// @desc    Get available payment methods
// @route   GET /api/payments/methods
// @access  Public
const getPaymentMethods = asyncHandler(async (req, res) => {
    const amount = req.query.amount || 1;
    const methods = await myfatoorah.getPaymentMethods(amount);
    let allMethods = methods.methods || [];

    // Also fetch Deema methods (separate API key) and merge
    try {
        if (process.env.MYFATOORAH_DEEMA_API_KEY && process.env.MYFATOORAH_DEEMA_API_KEY !== 'your_deema_test_api_key_here') {
            const deemaMethods = await deemaService.getPaymentMethods(amount);
            if (deemaMethods.methods && deemaMethods.methods.length > 0) {
                // Tag Deema methods so frontend can identify them
                const taggedDeema = deemaMethods.methods.map(m => ({ ...m, isDeema: true }));
                // Avoid duplicates (compare by name, not ID since IDs differ between accounts)
                const existingNames = new Set(allMethods.map(m => (m.name || '').toLowerCase()));
                const newMethods = taggedDeema.filter(m => !existingNames.has((m.name || '').toLowerCase()));
                allMethods = [...allMethods, ...newMethods];
                console.log(`[PAYMENTS] Merged ${newMethods.length} Deema method(s) into payment options`);
            }
        }
    } catch (deemaErr) {
        console.warn('[PAYMENTS] Could not fetch Deema methods:', deemaErr.message);
    }

    res.json({
        success: true,
        data: allMethods
    });
});

// @desc    Create payment session
// @route   POST /api/payments/create-session
// @access  Private
const createPaymentSession = asyncHandler(async (req, res) => {
    const { paymentMethod, shippingAddress } = req.body;

    // Normalize phone before processing
    if (shippingAddress && shippingAddress.phone) {
        shippingAddress.phone = WhatsAppService.normalizePhoneInternational(shippingAddress.phone);
        console.log(`[PAYMENT-SESSION] Normalized phone: ${shippingAddress.phone}`);
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
        res.status(400);
        throw new Error('Cart is empty');
    }

    // Calculate totals
    const subtotal = cart.items.reduce((sum, item) => {
        return sum + (item.product.price * item.quantity);
    }, 0);

    const shippingCost = 2.0; // Fixed 2 KD shipping for all orders
    const total = subtotal + shippingCost;

    // Create order first
    const order = await Order.createWithRetry({
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
        paymentMethod: paymentMethod || 'myfatoorah',
        paymentStatus: 'awaiting_payment',
        orderStatus: 'pending',
        subtotal,
        shippingCost,
        total
    });

    // Prepare payment data
    const paymentData = {
        customerName: req.user.name,
        customerEmail: req.user.email,
        customerPhone: shippingAddress.phone,
        amount: total,
        currency: 'KWD',
        orderNumber: order.orderNumber,
        orderId: order._id.toString(),
        language: req.user.language || 'en',
        items: order.items.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price
        }))
    };

    // Initiate payment with MyFatoorah
    const payment = await myfatoorah.initiatePayment(paymentData);

    // Update order with payment info
    order.myfatoorahInvoiceId = payment.invoiceId;
    await order.save();

    // NOTE: Cart is NOT cleared here — only cleared after payment is confirmed

    res.json({
        success: true,
        data: {
            paymentUrl: payment.paymentUrl,
            invoiceId: payment.invoiceId,
            orderNumber: order.orderNumber,
            orderId: order._id
        }
    });
});

// @desc    Execute payment with specific method (KNET, Card, Apple Pay)
// @route   POST /api/payments/execute
// @access  Private
const executePayment = asyncHandler(async (req, res) => {
    const { paymentMethodId, shippingAddress, promoCode: promoCodeStr } = req.body;

    // Validate paymentMethodId — must be a positive integer
    // The frontend dynamically detects valid IDs from MyFatoorah's InitiatePayment API,
    // so we accept any positive integer here rather than hardcoding a whitelist
    const methodId = parseInt(paymentMethodId);
    if (!methodId || methodId < 1) {
        res.status(400);
        throw new Error(`Invalid payment method: ${paymentMethodId}`);
    }

    // Normalize phone before processing
    if (shippingAddress && shippingAddress.phone) {
        shippingAddress.phone = WhatsAppService.normalizePhoneInternational(shippingAddress.phone);
    }

    console.log('=== EXECUTE PAYMENT REQUEST ===');
    console.log('Payment Method ID:', paymentMethodId);
    console.log('Shipping Phone (normalized):', shippingAddress?.phone);
    console.log('User:', req.user.email);

    // paymentMethodId: 1=KNET, 2=VISA/Master, 20=Apple Pay

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
        console.error('Cart is empty for user:', req.user.email);
        res.status(400);
        throw new Error('Cart is empty');
    }

    console.log('Cart items:', cart.items.length);

    // Calculate totals
    const subtotal = cart.items.reduce((sum, item) => {
        return sum + (item.product.price * item.quantity);
    }, 0);

    const shippingCost = 2.0; // Fixed 2 KD shipping for all orders

    // ── Promo Code Validation & Discount ──
    let promoData = null;
    let totalDiscount = 0;

    const cartProductItems = cart.items.map(item => ({
        product: item.product._id,
        name: item.product.name,
        nameAr: item.product.nameAr,
        price: item.product.price,
        quantity: item.quantity,
        image: item.product.images[0]?.url
    }));

    if (promoCodeStr && promoCodeStr.trim()) {
        const promo = await PromoCode.findOne({ code: promoCodeStr.toUpperCase().trim() })
            .populate('products.product', 'name nameAr price');

        if (promo) {
            const validity = promo.canUserUse(req.user._id);
            if (validity.valid) {
                const discounts = [];
                let totalDiscountedItems = 0;
                for (const item of cartProductItems) {
                    const promoProduct = promo.products.find(
                        p => p.product._id.toString() === item.product.toString()
                    );
                    if (promoProduct) {
                        let allowedQuantity = item.quantity;

                        // Per-product quantity limit
                        if (promoProduct.maxDiscountedQuantity !== null && promoProduct.maxDiscountedQuantity !== undefined) {
                            allowedQuantity = Math.min(allowedQuantity, promoProduct.maxDiscountedQuantity);
                        }

                        // Global per-order quantity limit
                        if (promo.maxQuantityPerOrder !== null && promo.maxQuantityPerOrder !== undefined) {
                            const remainingGlobal = Math.max(0, promo.maxQuantityPerOrder - totalDiscountedItems);
                            allowedQuantity = Math.min(allowedQuantity, remainingGlobal);
                        }

                        if (allowedQuantity > 0) {
                            let discount = 0;
                            if (promoProduct.discountType === 'percentage') {
                                discount = (item.price * promoProduct.discountValue / 100) * allowedQuantity;
                            } else {
                                discount = promoProduct.discountValue * allowedQuantity;
                            }
                            const itemTotal = item.price * allowedQuantity;
                            discount = Math.min(discount, itemTotal);

                            discounts.push({
                                product: item.product,
                                productName: item.name,
                                discountType: promoProduct.discountType,
                                discountValue: promoProduct.discountValue,
                                discountedQuantity: allowedQuantity,
                                discountAmount: parseFloat(discount.toFixed(3))
                            });
                            totalDiscount += discount;
                            totalDiscountedItems += allowedQuantity;
                        }
                    }
                }

                totalDiscount = parseFloat(totalDiscount.toFixed(3));

                if (totalDiscount > 0) {
                    promoData = {
                        code: promo.code,
                        name: promo.name,
                        promoCodeId: promo._id,
                        totalDiscount,
                        discounts
                    };

                    // NOTE: Usage is NOT counted here — it is counted AFTER payment
                    // is confirmed in handlePaymentCallback / verifyPayment / webhook
                    console.log(`[PAYMENT] ✅ Promo "${promo.code}" applied — discount ${totalDiscount} KWD (usage counted after payment)`);
                }
            } else {
                console.log(`[PAYMENT] ⚠️ Promo "${promoCodeStr}" rejected: ${validity.reason}`);
            }
        }
    }

    const total = parseFloat((subtotal + shippingCost - totalDiscount).toFixed(3));

    console.log('Order totals - Subtotal:', subtotal, 'Shipping:', shippingCost, 'Discount:', totalDiscount, 'Total:', total);

    // Check for existing awaiting_payment order for this user to prevent duplicates
    let order = await Order.findOne({
        user: req.user._id,
        paymentStatus: 'awaiting_payment'
    });

    if (order) {
        // Reuse existing pending order — update it with current cart/shipping
        console.log(`[DEDUP] Reusing existing order ${order.orderNumber} instead of creating duplicate`);
        order.items = cartProductItems;
        order.shippingAddress = shippingAddress;
        order.paymentMethod = getPaymentMethodName(paymentMethodId);
        order.subtotal = subtotal;
        order.shippingCost = shippingCost;
        order.discount = totalDiscount;
        order.promoCode = promoData;
        order.total = total;
        await order.save();
    } else {
        // Create new order
        order = await Order.createWithRetry({
            user: req.user._id,
            items: cartProductItems,
            shippingAddress,
            paymentMethod: getPaymentMethodName(paymentMethodId),
            paymentStatus: 'awaiting_payment',
            orderStatus: 'pending',
            subtotal,
            shippingCost,
            discount: totalDiscount,
            promoCode: promoData,
            total
        });
    }

    console.log('Order created:', order.orderNumber);

    // Execute payment
    const paymentData = {
        paymentMethodId,
        customerName: req.user.name,
        customerEmail: req.user.email,
        customerPhone: shippingAddress.phone,
        amount: total,
        orderNumber: order.orderNumber,
        orderId: order._id.toString(),
        language: req.user.language || 'en',
        items: order.items.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price
        }))
    };

    // Use the correct MyFatoorah service (Deema has its own API key)
    const paymentService = getServiceForMethod(order.paymentMethod);
    console.log(`Calling MyFatoorah executePayment via ${paymentService.label} service...`);

    try {
        const payment = await paymentService.executePayment(paymentData, totalDiscount);

        console.log('MyFatoorah response:', JSON.stringify(payment, null, 2));

        // Update order
        order.myfatoorahInvoiceId = payment.invoiceId;
        await order.save();

        // NOTE: Cart is NOT cleared here — only cleared after payment is confirmed

        res.json({
            success: true,
            data: {
                paymentUrl: payment.paymentUrl,
                invoiceId: payment.invoiceId,
                orderNumber: order.orderNumber,
                orderId: order._id
            }
        });
    } catch (error) {
        console.error('=== PAYMENT EXECUTION FAILED ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);

        // Payment execution failed — mark the orphaned order
        order.paymentStatus = 'failed';
        order.orderStatus = 'cancelled';
        order.notes = `Payment execution failed: ${error.message}`;
        await order.save();
        console.log(`[PAYMENT] Order ${order.orderNumber} marked as failed`);

        // Return detailed error to frontend for debugging
        res.status(500).json({
            success: false,
            message: error.message || 'Payment execution failed',
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// @desc    Verify payment status (callback from MyFatoorah)
// @route   GET /api/payments/verify/:paymentId
// @access  Public
const verifyPayment = asyncHandler(async (req, res) => {
    const { paymentId } = req.params;

    // Get payment status from MyFatoorah
    // Try main service first, fall back to Deema service
    let paymentStatus;
    try {
        paymentStatus = await myfatoorah.getPaymentStatus(paymentId);
    } catch (mainErr) {
        console.log('[VERIFY] Main service failed, trying Deema service...');
        paymentStatus = await deemaService.getPaymentStatus(paymentId);
    }

    // Find order
    const order = await Order.findById(paymentStatus.orderId).populate('user', 'name email phone language');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Update order based on payment status
    if (paymentStatus.status === 'Paid') {
        // Idempotency check — skip if already processed
        if (order.paymentStatus === 'paid') {
            return res.json({
                success: true,
                message: 'Payment already processed',
                data: { orderNumber: order.orderNumber, status: 'paid' }
            });
        }

        // Verify payment amount matches order total
        if (paymentStatus.amount && Math.abs(paymentStatus.amount - order.total) > 0.01) {
            order.paymentStatus = 'failed';
            order.notes = 'Payment amount mismatch detected';
            await order.save();
            res.status(400);
            throw new Error('Payment amount mismatch');
        }

        order.paymentStatus = 'paid';
        order.orderStatus = 'confirmed';
        order.myfatoorahTransactionId = paymentStatus.transactionId;
        order.paidAt = new Date();

        // Update product stock
        for (const item of order.items) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { stock: -item.quantity }
            });
        }

        // Clear the user's cart now that payment is confirmed
        await Cart.findOneAndUpdate({ user: order.user._id || order.user }, { items: [] });

        // Count promo code usage now that payment is confirmed
        await incrementPromoUsage(order);

        // Send confirmation email
        try {
            await sendOrderConfirmation(order, order.user);
        } catch (emailErr) {
            // Don't fail the payment verification if email fails
        }

        // Send WhatsApp notifications to BOTH owners + customer (background — don't block response)
        try {
            const whatsapp = require('../services/whatsappService');
            whatsapp.sendAllOrderNotifications(order, order.user);
        } catch (whatsappErr) {
            console.error('WhatsApp notification error:', whatsappErr);
        }

        // Notify admin dashboard in real-time
        try {
            const { emitNewOrder } = require('../socketHandler');
            emitNewOrder(order);
        } catch (socketErr) {
            console.error('Socket notification error:', socketErr.message);
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
                    // Update existing address with latest data
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

        await order.save();

        res.json({
            success: true,
            message: 'Payment successful',
            data: {
                orderNumber: order.orderNumber,
                status: 'paid'
            }
        });
    } else if (paymentStatus.status === 'Failed') {
        order.paymentStatus = 'failed';
        await order.save();

        res.status(400).json({
            success: false,
            message: 'Payment failed'
        });
    } else {
        res.json({
            success: true,
            message: 'Payment pending',
            data: {
                status: paymentStatus.status
            }
        });
    }
});

// @desc    Handle MyFatoorah webhook
// @route   POST /api/payments/webhook
// @access  Public
const handleWebhook = asyncHandler(async (req, res) => {
    const { Event, Data } = req.body;

    if (Event === 'TransactionStatusChanged') {
        const paymentId = Data.PaymentId;
        // Try main service first, fall back to Deema service
        let paymentStatus;
        try {
            paymentStatus = await myfatoorah.getPaymentStatus(paymentId);
        } catch (mainErr) {
            console.log('[WEBHOOK] Main service failed, trying Deema service...');
            paymentStatus = await deemaService.getPaymentStatus(paymentId);
        }

        const order = await Order.findById(paymentStatus.orderId).populate('user', 'name email phone language');

        // Idempotency: only process if not already paid
        if (order && paymentStatus.status === 'Paid' && order.paymentStatus !== 'paid') {
            order.paymentStatus = 'paid';
            order.orderStatus = 'confirmed';
            order.myfatoorahTransactionId = paymentStatus.transactionId;
            order.paidAt = new Date();

            // Update stock
            for (const item of order.items) {
                await Product.findByIdAndUpdate(item.product, {
                    $inc: { stock: -item.quantity }
                });
            }

            // Clear cart after payment confirmed
            await Cart.findOneAndUpdate({ user: order.user._id || order.user }, { items: [] });

            // Count promo code usage now that payment is confirmed
            await incrementPromoUsage(order);

            // Send email (don't fail on error)
            try {
                await sendOrderConfirmation(order, order.user);
            } catch (emailErr) { /* silent */ }

            // Send WhatsApp notifications to BOTH owners + customer (background — don't block webhook)
            try {
                const whatsapp = require('../services/whatsappService');
                whatsapp.sendAllOrderNotifications(order, order.user);
            } catch (whatsappErr) {
                console.error('WhatsApp webhook notification error:', whatsappErr.message);
            }

            // Notify admin dashboard in real-time
            try {
                const { emitNewOrder } = require('../socketHandler');
                emitNewOrder(order);
            } catch (socketErr) { /* silent */ }

            await order.save();
        }
    }

    res.json({ success: true });
});

// @desc    Process COD order
// @route   POST /api/payments/cod
// @access  Private
const processCOD = asyncHandler(async (req, res) => {
    const { shippingAddress } = req.body;

    // Normalize phone before processing
    if (shippingAddress && shippingAddress.phone) {
        shippingAddress.phone = WhatsAppService.normalizePhoneInternational(shippingAddress.phone);
        console.log(`[COD] Normalized phone: ${shippingAddress.phone}`);
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
        res.status(400);
        throw new Error('Cart is empty');
    }

    // Calculate totals
    const subtotal = cart.items.reduce((sum, item) => {
        return sum + (item.product.price * item.quantity);
    }, 0);

    const shippingCost = 2.0; // Fixed 2 KD shipping for all orders
    const total = subtotal + shippingCost;

    // Create order
    const order = await Order.createWithRetry({
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
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        orderStatus: 'confirmed',
        subtotal,
        shippingCost,
        total
    });

    // Update stock
    for (const item of cart.items) {
        await Product.findByIdAndUpdate(item.product._id, {
            $inc: { stock: -item.quantity }
        });
    }

    // Send confirmation email (don't fail order if email fails)
    try {
        await sendOrderConfirmation(order, req.user);
    } catch (emailErr) {
        console.error('COD email send failed:', emailErr.message);
    }

    // Send WhatsApp notifications (owner + customer)
    try {
        const whatsapp = require('../services/whatsappService');
        await whatsapp.notifyOwnerNewOrder(order, req.user);
        await whatsapp.notifyCustomerNewOrder(order, req.user);
    } catch (whatsappErr) {
        console.error('WhatsApp notification error:', whatsappErr);
    }

    // Clear cart
    cart.items = [];
    await cart.save();

    res.json({
        success: true,
        data: {
            orderNumber: order.orderNumber,
            orderId: order._id
        }
    });
});

// Helper function
function getPaymentMethodName(methodId) {
    const methods = {
        1: 'knet',
        2: 'card',
        11: 'deema',
        20: 'applepay'
    };
    return methods[methodId] || 'myfatoorah';
}

// @desc    Handle payment callback from MyFatoorah (success/failure)
// @route   GET /api/payments/callback
// @access  Public
const handlePaymentCallback = asyncHandler(async (req, res) => {
    const { paymentId, Id } = req.query;
    const idToVerify = paymentId || Id;

    console.log('=== PAYMENT CALLBACK ===');
    console.log('Query params:', req.query);

    if (!idToVerify) {
        return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=missing_payment_id`);
    }

    try {
        // Get payment status from MyFatoorah
        // Try main service first, fall back to Deema service
        let paymentStatus;
        try {
            paymentStatus = await myfatoorah.getPaymentStatus(idToVerify);
        } catch (mainErr) {
            console.log('[CALLBACK] Main service failed, trying Deema service...');
            paymentStatus = await deemaService.getPaymentStatus(idToVerify);
        }
        console.log('Payment status from MyFatoorah:', paymentStatus);

        // Find order
        const order = await Order.findById(paymentStatus.orderId).populate('user', 'name email phone language');

        if (!order) {
            console.error('Order not found:', paymentStatus.orderId);
            return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=order_not_found`);
        }

        // Handle based on payment status
        if (paymentStatus.status === 'Paid') {
            // Idempotency check
            if (order.paymentStatus === 'paid') {
                console.log('Payment already processed for order:', order.orderNumber);
                return res.redirect(`${process.env.FRONTEND_URL}/order-success.html?order=${order.orderNumber}`);
            }

            // Verify amount
            if (paymentStatus.amount && Math.abs(paymentStatus.amount - order.total) > 0.01) {
                order.paymentStatus = 'failed';
                order.orderStatus = 'cancelled';
                order.notes = 'Payment amount mismatch detected';
                await order.save();
                console.error('Payment amount mismatch:', { expected: order.total, received: paymentStatus.amount });
                return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=amount_mismatch&order=${order.orderNumber}`);
            }

            // Payment successful
            order.paymentStatus = 'paid';
            order.orderStatus = 'confirmed';
            order.myfatoorahTransactionId = paymentStatus.transactionId;
            order.paidAt = new Date();

            // Update product stock
            for (const item of order.items) {
                await Product.findByIdAndUpdate(item.product, {
                    $inc: { stock: -item.quantity }
                });
            }

            // Clear cart
            await Cart.findOneAndUpdate({ user: order.user._id || order.user }, { items: [] });

            // Count promo code usage now that payment is confirmed
            await incrementPromoUsage(order);

            // Send confirmation email
            try {
                await sendOrderConfirmation(order, order.user);
            } catch (emailErr) {
                console.error('Email send failed:', emailErr);
            }

            // Send WhatsApp notifications to BOTH owners + customer (background — don't block redirect)
            try {
                const whatsapp = require('../services/whatsappService');
                whatsapp.sendAllOrderNotifications(order, order.user);
            } catch (whatsappErr) {
                console.error('WhatsApp callback notification error:', whatsappErr.message);
            }

            // Notify admin dashboard in real-time
            try {
                const { emitNewOrder } = require('../socketHandler');
                emitNewOrder(order);
            } catch (socketErr) {
                console.error('Socket notification error:', socketErr.message);
            }

            // Auto-print receipt (skip if already printed — prevents duplicate prints from callback/webhook race)
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
                        // Update existing address with latest data
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

            await order.save();
            console.log('Payment successful for order:', order.orderNumber);

            return res.redirect(`${process.env.FRONTEND_URL}/order-success.html?order=${order.orderNumber}`);

        } else if (paymentStatus.status === 'Failed' || paymentStatus.status === 'Expired') {
            // Payment failed or expired
            order.paymentStatus = 'failed';
            order.orderStatus = 'cancelled';
            order.notes = `Payment ${paymentStatus.status.toLowerCase()}: ${paymentStatus.status}`;
            await order.save();
            console.log(`Payment ${paymentStatus.status} for order:`, order.orderNumber);

            return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?status=${paymentStatus.status.toLowerCase()}&order=${order.orderNumber}`);

        } else {
            // Payment still pending or other status
            console.log('Payment status pending for order:', order.orderNumber, 'Status:', paymentStatus.status);
            return res.redirect(`${process.env.FRONTEND_URL}/payment-pending.html?order=${order.orderNumber}`);
        }

    } catch (error) {
        console.error('Payment callback error:', error);
        return res.redirect(`${process.env.FRONTEND_URL}/payment-error.html?error=verification_failed`);
    }
});

module.exports = {
    getPaymentMethods,
    createPaymentSession,
    executePayment,
    verifyPayment,
    handlePaymentCallback,
    handleWebhook,
    processCOD
};
