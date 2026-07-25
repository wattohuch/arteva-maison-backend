const { asyncHandler } = require('../middleware/error');
const ApiError = require('../utils/ApiError');
const frontendUrls = require('../utils/frontendUrls');
const { getMyFatoorahStatus, getDeemaStatus } = require('../config/paymentConfig');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const PromoCode = require('../models/PromoCode');
const myfatoorah = require('../services/myfatoorahService');
const { sendOrderConfirmation } = require('../services/emailService');
const { WhatsAppService } = require('../services/whatsappService');

/**
 * Validates a shipping address coming off the wire.
 * Returns an array of `{field, message}`; empty means valid.
 */
function validateShippingAddress(address) {
    const errors = [];
    if (!address || typeof address !== 'object') {
        return [{ field: 'shippingAddress', message: 'Shipping address is required' }];
    }

    const str = (v) => (typeof v === 'string' ? v.trim() : '');

    if (!str(address.street)) errors.push({ field: 'street', message: 'Street address is required' });
    if (!str(address.city)) errors.push({ field: 'city', message: 'City is required' });

    const phone = str(address.phone).replace(/[^\d+]/g, '');
    if (!phone) {
        errors.push({ field: 'phone', message: 'Phone number is required' });
    } else if (phone.replace(/\D/g, '').length < 8) {
        errors.push({ field: 'phone', message: 'Phone number is too short' });
    }

    if (address.coordinates != null) {
        const { lat, lng } = address.coordinates;
        const validLat = typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
        const validLng = typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
        if (!validLat || !validLng) {
            // Bad coordinates should never block an order — drop them and continue.
            delete address.coordinates;
        }
    }

    return errors;
}

/** Throws a 400 VALIDATION_ERROR when the address is unusable. */
function assertValidAddress(address) {
    const errors = validateShippingAddress(address);
    if (errors.length) {
        throw ApiError.badRequest(
            'VALIDATION_ERROR',
            errors.map(e => e.message).join(', '),
            errors
        );
    }
}

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
//
// This endpoint used to 500 whenever MyFatoorah was unreachable or the API key
// was invalid, which took the whole checkout page down with it. Availability of
// an optional gateway is not a server fault, so it now always answers 200 with
// an explicit `gateways` block describing what the shopper can actually use.
// Cash on delivery is not offered by ARTÉVA and is never advertised here.
const getPaymentMethods = asyncHandler(async (req, res) => {
    const parsed = Number(req.query.amount);
    const amount = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

    const mfStatus = getMyFatoorahStatus();
    const deemaStatus = getDeemaStatus();

    // `reason` is a stable client-facing code, never the raw config message —
    // that names environment variables and stays in the server log.
    const gateways = {
        myfatoorah: { available: false, reason: 'PAYMENT_GATEWAY_UNAVAILABLE' },
        deema: {
            available: deemaStatus.configured,
            reason: deemaStatus.configured ? null : 'PAYMENT_GATEWAY_UNAVAILABLE',
        },
    };

    let methods = [];

    if (mfStatus.configured) {
        try {
            const result = await myfatoorah.getPaymentMethods(amount);
            methods = result.methods || [];
            gateways.myfatoorah = { available: true, reason: null };
        } catch (err) {
            // Degrade instead of failing: log for the operator and tell the
            // client the gateway is down so checkout can say so plainly.
            console.error(
                `[PAYMENTS] [${req.id || '-'}] Payment methods unavailable ` +
                `(${err.code || 'UNKNOWN'}): ${err.message}`
            );
            gateways.myfatoorah = {
                available: false,
                reason: err.code || 'PAYMENT_GATEWAY_ERROR',
            };
        }
    } else {
        console.error(
            `[PAYMENTS] [${req.id || '-'}] MyFatoorah not configured — ${mfStatus.reason}`
        );
        gateways.myfatoorah = { available: false, reason: 'PAYMENT_GATEWAY_UNAVAILABLE' };
    }

    res.json({
        success: true,
        data: methods,
        gateways,
    });
});

// @desc    Create payment session
// @route   POST /api/payments/create-session
// @access  Private
const createPaymentSession = asyncHandler(async (req, res) => {
    const { paymentMethod, shippingAddress } = req.body;

    const mfStatus = getMyFatoorahStatus();
    if (!mfStatus.configured) {
        // The reason names an env var, so it stays server-side only.
        console.error(`[PAYMENTS] [${req.id || '-'}] Gateway unusable — ${mfStatus.reason}`);
        throw ApiError.unavailable(
            'PAYMENT_GATEWAY_UNAVAILABLE',
            'Online payments are temporarily unavailable. Please try again shortly.'
        );
    }

    assertValidAddress(shippingAddress);
    shippingAddress.phone = WhatsAppService.normalizePhoneInternational(shippingAddress.phone);

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
        throw ApiError.badRequest('CART_EMPTY', 'Your cart is empty.');
    }

    cart.items = cart.items.filter(i => i.product);
    if (cart.items.length === 0) {
        throw ApiError.badRequest(
            'CART_ITEMS_UNAVAILABLE',
            'The items in your cart are no longer available.'
        );
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

    // ── Fail fast when the gateway cannot be used at all ──
    // Previously this reached MyFatoorah with a placeholder key, got a 401, and
    // surfaced as an opaque 500 after burning the full request timeout.
    const mfStatus = getMyFatoorahStatus();
    if (!mfStatus.configured) {
        // The reason names an env var, so it stays server-side only.
        console.error(`[PAYMENTS] [${req.id || '-'}] Gateway unusable — ${mfStatus.reason}`);
        throw ApiError.unavailable(
            'PAYMENT_GATEWAY_UNAVAILABLE',
            'Online payments are temporarily unavailable. Please try again shortly.'
        );
    }

    // ── Validate input ──
    // The frontend resolves real IDs from MyFatoorah's InitiatePayment response,
    // so any positive integer is accepted rather than a hardcoded whitelist.
    const methodId = Number.parseInt(paymentMethodId, 10);
    if (!Number.isInteger(methodId) || methodId < 1) {
        throw ApiError.badRequest(
            'INVALID_PAYMENT_METHOD',
            'A valid payment method must be selected.',
            [{ field: 'paymentMethodId', message: `Received: ${JSON.stringify(paymentMethodId)}` }]
        );
    }

    assertValidAddress(shippingAddress);

    if (promoCodeStr != null && typeof promoCodeStr !== 'string') {
        throw ApiError.badRequest('INVALID_PROMO_CODE', 'Promo code must be text.');
    }

    // Normalize phone before processing
    shippingAddress.phone = WhatsAppService.normalizePhoneInternational(shippingAddress.phone);

    console.log(
        `[PAYMENTS] [${req.id || '-'}] execute method=${methodId} user=${req.user.email}`
    );

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
        throw ApiError.badRequest('CART_EMPTY', 'Your cart is empty.');
    }

    // A product deleted between add-to-cart and checkout leaves a null populate,
    // which used to throw a TypeError deep inside the subtotal reduce → 500.
    const invalidItems = cart.items.filter(i => !i.product);
    if (invalidItems.length) {
        cart.items = cart.items.filter(i => i.product);
        await cart.save();
        if (cart.items.length === 0) {
            throw ApiError.badRequest(
                'CART_ITEMS_UNAVAILABLE',
                'The items in your cart are no longer available.'
            );
        }
        console.warn(
            `[PAYMENTS] [${req.id || '-'}] Dropped ${invalidItems.length} unavailable cart item(s)`
        );
    }

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

    try {
        const payment = await myfatoorah.executePayment(paymentData, totalDiscount);

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
        // Mark the orphaned order, then re-throw so the central handler emits the
        // typed status the service already classified (503/502/504) instead of the
        // blanket 500 this used to return for every failure mode.
        try {
            order.paymentStatus = 'failed';
            order.orderStatus = 'cancelled';
            order.notes = `Payment execution failed: ${error.message}`;
            await order.save();
            console.error(
                `[PAYMENTS] [${req.id || '-'}] Order ${order.orderNumber} marked failed — ` +
                `${error.code || 'UNKNOWN'}: ${error.message}`
            );
        } catch (saveErr) {
            console.error(
                `[PAYMENTS] [${req.id || '-'}] Could not mark order ${order.orderNumber} failed:`,
                saveErr.message
            );
        }

        throw error;
    }
});

// @desc    Verify payment status (callback from MyFatoorah)
// @route   GET /api/payments/verify/:paymentId
// @access  Public
const verifyPayment = asyncHandler(async (req, res) => {
    const { paymentId } = req.params;

    // Get payment status from MyFatoorah
    const paymentStatus = await myfatoorah.getPaymentStatus(paymentId);

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
        const paymentStatus = await myfatoorah.getPaymentStatus(paymentId);

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
        }
    }

    res.json({ success: true });
});

// @desc    Process COD order
// @route   POST /api/payments/cod
// @access  Private
const processCOD = asyncHandler(async (req, res) => {
    // Cash on delivery was retired as a payment option. The route stays mounted
    // so older clients get a clear, typed refusal instead of a 404, but no new
    // COD order is ever created.
    throw ApiError.badRequest(
        'PAYMENT_METHOD_NOT_OFFERED',
        'Cash on delivery is no longer available. Please pay by card, KNET or Deema.'
    );

    /* eslint-disable no-unreachable */
    const { shippingAddress, notes } = req.body;

    assertValidAddress(shippingAddress);
    shippingAddress.phone = WhatsAppService.normalizePhoneInternational(shippingAddress.phone);

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
        throw ApiError.badRequest('CART_EMPTY', 'Your cart is empty.');
    }

    // Drop items whose product no longer exists (deleted mid-session)
    const before = cart.items.length;
    cart.items = cart.items.filter(i => i.product);
    if (cart.items.length !== before) {
        await cart.save();
        console.warn(`[COD] [${req.id || '-'}] Dropped ${before - cart.items.length} unavailable item(s)`);
    }
    if (cart.items.length === 0) {
        throw ApiError.badRequest(
            'CART_ITEMS_UNAVAILABLE',
            'The items in your cart are no longer available.'
        );
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
        total,
        notes: typeof notes === 'string' ? notes.slice(0, 1000) : undefined
    });

    // Update stock
    for (const item of cart.items) {
        await Product.findByIdAndUpdate(item.product._id, {
            $inc: { stock: -item.quantity }
        });
    }

    // Send confirmation email (never fail the order because email failed)
    try {
        await sendOrderConfirmation(order, req.user);
    } catch (emailErr) {
        console.error(`[COD] [${req.id || '-'}] Email send failed:`, emailErr.message);
    }

    // WhatsApp notifications — fire and forget so a slow provider cannot stall
    // the response or, worse, reject an order that is already committed.
    try {
        const whatsapp = require('../services/whatsappService');
        Promise.allSettled([
            whatsapp.notifyOwnerNewOrder(order, req.user),
            whatsapp.notifyCustomerNewOrder(order, req.user),
        ]).then(results => {
            results.filter(r => r.status === 'rejected').forEach(r =>
                console.error(`[COD] WhatsApp notification failed:`, r.reason?.message || r.reason)
            );
        });
    } catch (whatsappErr) {
        console.error(`[COD] [${req.id || '-'}] WhatsApp dispatch error:`, whatsappErr.message);
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
    /* eslint-enable no-unreachable */
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
        return res.redirect(frontendUrls.paymentError({ error: 'missing_payment_id' }));
    }

    try {
        // Get payment status from MyFatoorah
        const paymentStatus = await myfatoorah.getPaymentStatus(idToVerify);
        console.log('Payment status from MyFatoorah:', paymentStatus);

        // Find order
        const order = await Order.findById(paymentStatus.orderId).populate('user', 'name email phone language');

        if (!order) {
            console.error('Order not found:', paymentStatus.orderId);
            return res.redirect(frontendUrls.paymentError({ error: 'order_not_found' }));
        }

        // Handle based on payment status
        if (paymentStatus.status === 'Paid') {
            // Idempotency check
            if (order.paymentStatus === 'paid') {
                console.log('Payment already processed for order:', order.orderNumber);
                return res.redirect(frontendUrls.orderSuccess(order.orderNumber));
            }

            // Verify amount
            if (paymentStatus.amount && Math.abs(paymentStatus.amount - order.total) > 0.01) {
                order.paymentStatus = 'failed';
                order.orderStatus = 'cancelled';
                order.notes = 'Payment amount mismatch detected';
                await order.save();
                console.error('Payment amount mismatch:', { expected: order.total, received: paymentStatus.amount });
                return res.redirect(frontendUrls.paymentError({ error: 'amount_mismatch', order: order.orderNumber }));
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

            return res.redirect(frontendUrls.orderSuccess(order.orderNumber));

        } else if (paymentStatus.status === 'Failed' || paymentStatus.status === 'Expired') {
            // Payment failed or expired
            order.paymentStatus = 'failed';
            order.orderStatus = 'cancelled';
            order.notes = `Payment ${paymentStatus.status.toLowerCase()}: ${paymentStatus.status}`;
            await order.save();
            console.log(`Payment ${paymentStatus.status} for order:`, order.orderNumber);

            return res.redirect(frontendUrls.paymentError({ status: paymentStatus.status.toLowerCase(), order: order.orderNumber }));

        } else {
            // Payment still pending or other status
            console.log('Payment status pending for order:', order.orderNumber, 'Status:', paymentStatus.status);
            return res.redirect(frontendUrls.paymentPending(order.orderNumber));
        }

    } catch (error) {
        console.error('Payment callback error:', error);
        return res.redirect(frontendUrls.paymentError({ error: 'verification_failed' }));
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
