const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const PromoCode = require('../models/PromoCode');
const { asyncHandler } = require('../middleware/error');
const { paginate } = require('../utils/helpers');
const { emitNewOrder } = require('../socketHandler');
const { WhatsAppService } = require('../services/whatsappService');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = asyncHandler(async (req, res) => {
    const { shippingAddress, paymentMethod, notes, promoCode: promoCodeStr } = req.body;

    // Normalize phone number to international format before saving
    if (shippingAddress && shippingAddress.phone) {
        shippingAddress.phone = WhatsAppService.normalizePhoneInternational(shippingAddress.phone);
        console.log(`[ORDER] Normalized shipping phone: ${shippingAddress.phone}`);
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
        res.status(400);
        throw new Error('Cart is empty');
    }

    // Build order items and calculate totals
    const orderItems = [];
    let subtotal = 0;

    for (const item of cart.items) {
        const product = item.product;

        // Check stock
        if (product.stock < item.quantity) {
            res.status(400);
            throw new Error(`Insufficient stock for ${product.name}`);
        }

        orderItems.push({
            product: product._id,
            name: product.name,
            nameAr: product.nameAr, // Include Arabic name
            sku: product.sku || '', // Include product SKU / number
            image: product.images[0]?.url || '',
            price: product.price,
            quantity: item.quantity
        });

        subtotal += product.price * item.quantity;

        // Reduce stock
        product.stock -= item.quantity;
        await product.save();
    }

    // Calculate shipping - Fixed 2 KD for all orders
    const shippingCost = 2.0;

    // ── Promo Code Validation & Discount Calculation ──
    let promoData = null;
    let totalDiscount = 0;

    if (promoCodeStr && promoCodeStr.trim()) {
        const promo = await PromoCode.findOne({ code: promoCodeStr.toUpperCase().trim() })
            .populate('products.product', 'name nameAr price');

        if (promo) {
            const validity = promo.canUserUse(req.user._id);
            if (validity.valid) {
                // Calculate per-product discounts
                const discounts = [];
                let totalDiscountedItems = 0;
                for (const orderItem of orderItems) {
                    const promoProduct = promo.products.find(
                        p => p.product._id.toString() === orderItem.product.toString()
                    );
                    if (promoProduct) {
                        let allowedQuantity = orderItem.quantity;

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
                                discount = (orderItem.price * promoProduct.discountValue / 100) * allowedQuantity;
                            } else {
                                discount = promoProduct.discountValue * allowedQuantity;
                            }
                            const itemTotal = orderItem.price * allowedQuantity;
                            discount = Math.min(discount, itemTotal);

                            discounts.push({
                                product: orderItem.product,
                                productName: orderItem.name,
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

                    // Atomic usage increment to prevent race conditions
                    const userUsageEntry = promo.usedBy.find(u => u.user.toString() === req.user._id.toString());
                    if (userUsageEntry) {
                        await PromoCode.updateOne(
                            { _id: promo._id, 'usedBy.user': req.user._id },
                            { $inc: { usageCount: 1, 'usedBy.$.count': 1 } }
                        );
                    } else {
                        await PromoCode.updateOne(
                            { _id: promo._id },
                            { $inc: { usageCount: 1 }, $push: { usedBy: { user: req.user._id, count: 1 } } }
                        );
                    }
                    console.log(`[ORDER] ✅ Promo "${promo.code}" applied — discount ${totalDiscount} KWD`);
                }
            } else {
                console.log(`[ORDER] ⚠️ Promo "${promoCodeStr}" rejected: ${validity.reason}`);
            }
        } else {
            console.log(`[ORDER] ⚠️ Promo code "${promoCodeStr}" not found — ignoring`);
        }
    }

    const total = parseFloat((subtotal + shippingCost - totalDiscount).toFixed(3));

    const order = await Order.create({
        user: req.user._id,
        items: orderItems,
        shippingAddress,
        paymentMethod,
        subtotal,
        shippingCost,
        discount: totalDiscount,
        promoCode: promoData,
        total,
        notes
    });

    // Clear cart after order
    cart.items = [];
    await cart.save();

    // Auto-save shipping address if user is logged in
    try {
        if (req.user && shippingAddress) {
            // Re-fetch user to modify
            const User = require('../models/User');
            const userDoc = await User.findById(req.user._id);
            if (userDoc) {
                const existingAddress = userDoc.addresses.find(a =>
                    a.street.toLowerCase() === shippingAddress.street.toLowerCase() &&
                    a.city.toLowerCase() === shippingAddress.city.toLowerCase()
                );
                if (!existingAddress) {
                    userDoc.addresses.push({
                        street: shippingAddress.street,
                        city: shippingAddress.city,
                        state: shippingAddress.state || '',
                        country: shippingAddress.country || 'Kuwait',
                        zipCode: shippingAddress.zipCode || '',
                        phone: shippingAddress.phone || userDoc.phone || '',
                        label: userDoc.addresses.length === 0 ? 'Home' : `Address ${userDoc.addresses.length + 1}`
                    });
                    await userDoc.save();
                }
            }
        }
    } catch (e) {
        console.error('Error saving user address:', e.message);
    }

    // Notify admin dashboard in real-time
    try {
        emitNewOrder(order);
    } catch (e) {
        console.error('Socket notification error:', e.message);
    }

    // Send WhatsApp notification to OWNER and CUSTOMER
    try {
        const whatsapp = require('../services/whatsappService');
        await whatsapp.notifyOwnerNewOrder(order, req.user);
        await whatsapp.notifyCustomerNewOrder(order, req.user);
    } catch (e) {
        console.error('WhatsApp notification error:', e.message);
    }

    // Send email notification to admin
    try {
        const { sendAdminNewOrderNotification } = require('../services/emailService');
        sendAdminNewOrderNotification(order, req.user).catch(e => {
            console.error('Admin email notification error:', e.message);
        });
    } catch (e) {
        console.error('Email notification error:', e.message);
    }

    // Auto-print receipt via HP ePrint (background, non-blocking)
    try {
        const { autoPrintReceipt } = require('../services/printService');
        autoPrintReceipt(order, req.user).then(async (result) => {
            if (result && result.success) {
                try {
                    await Order.findByIdAndUpdate(order._id, { printedAt: new Date() });
                    console.log(`[PRINT] ✅ printedAt set for ${order.orderNumber}`);
                } catch (dbErr) {
                    console.error(`[PRINT] Failed to set printedAt for ${order.orderNumber}:`, dbErr.message);
                }
            } else {
                console.log(`[PRINT] ⚠️ Auto-print did not succeed for ${order.orderNumber}, leaving for local agent`);
            }
        }).catch(e => {
            console.error('Auto-print error:', e.message);
        });
    } catch (e) {
        console.error('Print service error:', e.message);
    }

    res.status(201).json({
        success: true,
        data: order
    });
});

// @desc    Get user's orders
// @route   GET /api/orders
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
    const { skip, limit, page } = paginate(req.query.page, req.query.limit);

    const filter = { user: req.user._id, paymentStatus: { $ne: 'awaiting_payment' } };

    const orders = await Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    const total = await Order.countDocuments(filter);

    res.json({
        success: true,
        data: orders,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
const getOrder = asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id)
        .populate('user', 'name email')
        .populate('deliveryPilot', 'name phone');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Check if user owns the order or is admin/owner/superuser
    if (order.user._id.toString() !== req.user._id.toString() && !['admin', 'owner', 'superuser'].includes(req.user.role)) {
        res.status(403);
        throw new Error('Not authorized');
    }

    res.json({
        success: true,
        data: order
    });
});

// @desc    Get all orders (Admin)
// @route   GET /api/orders/admin
// @access  Private/Admin
const getAllOrders = asyncHandler(async (req, res) => {
    const { status } = req.query;
    const { skip, limit, page } = paginate(req.query.page, req.query.limit);

    let filter = { paymentStatus: { $ne: 'awaiting_payment' } };
    if (status) {
        filter.orderStatus = status;
    }

    const orders = await Order.find(filter)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    const total = await Order.countDocuments(filter);

    res.json({
        success: true,
        data: orders,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// @desc    Update order status (Admin)
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
const updateOrderStatus = asyncHandler(async (req, res) => {
    const { orderStatus, paymentStatus } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    if (orderStatus) {
        order.orderStatus = orderStatus;
        if (orderStatus === 'delivered') {
            order.deliveredAt = Date.now();
        }
        if (orderStatus === 'cancelled') {
            order.cancelledAt = Date.now();

            // Restore stock
            for (const item of order.items) {
                const product = await Product.findById(item.product);
                if (product) {
                    product.stock += item.quantity;
                    await product.save();
                }
            }
        }
    }

    if (paymentStatus) {
        order.paymentStatus = paymentStatus;
    }

    await order.save();

    res.json({
        success: true,
        data: order
    });
});

// @desc    Get order by order number (e.g. ART-000001)
// @route   GET /api/orders/by-number/:orderNumber
// @access  Private
const getOrderByNumber = asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber })
        .populate('user', 'name email phone');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Check if user owns the order or is admin/owner/superuser
    if (order.user._id.toString() !== req.user._id.toString() && !['admin', 'owner', 'superuser'].includes(req.user.role)) {
        res.status(403);
        throw new Error('Not authorized');
    }

    res.json({
        success: true,
        data: order
    });
});

// @desc    Cancel order and initiate refund
// @route   POST /api/orders/:id/cancel
// @access  Private
const cancelOrder = asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const order = await Order.findById(req.params.id).populate('user', 'name email phone language');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Check if user owns the order
    if (order.user._id.toString() !== req.user._id.toString() && !['admin', 'owner', 'superuser'].includes(req.user.role)) {
        res.status(403);
        throw new Error('Not authorized to cancel this order');
    }

    // Check if order can be cancelled
    if (order.orderStatus === 'delivered') {
        res.status(400);
        throw new Error('Cannot cancel delivered orders');
    }

    if (order.orderStatus === 'cancelled') {
        res.status(400);
        throw new Error('Order is already cancelled');
    }

    // Check 14-day cancellation period
    const daysSinceOrder = Math.floor((new Date() - new Date(order.createdAt)) / (24 * 60 * 60 * 1000));
    if (daysSinceOrder > 14) {
        res.status(400);
        throw new Error('Cancellation period expired. Orders can only be cancelled within 14 days.');
    }

    // Update order status
    order.updateStatus('cancelled', reason || 'Cancelled by customer', req.user._id);
    order.cancelledAt = new Date();

    // Restore stock
    for (const item of order.items) {
        const product = await Product.findById(item.product);
        if (product) {
            product.stock += item.quantity;
            await product.save();
        }
    }

    // Update payment status - no automatic refund
    if (order.paymentStatus === 'paid') {
        // Mark as cancelled but keep payment status as paid
        // Customer must contact via WhatsApp for refund
        order.notes = (order.notes || '') + `\n[REFUND REQUIRED] Customer cancelled order within ${daysSinceOrder} days. Contact customer for refund: ${order.user.phone || order.user.email}`;
        console.log(`[CANCELLATION] Order ${order.orderNumber} cancelled within 14-day period. Manual refund required.`);
    }

    await order.save();

    // Send notification email
    try {
        const { sendOrderStatusUpdate } = require('../services/emailService');
        await sendOrderStatusUpdate(order, order.user, 'cancelled');
    } catch (emailErr) {
        console.error('Failed to send cancellation email:', emailErr);
    }

    // Send WhatsApp notification to CUSTOMER (owner only gets new orders)
    try {
        const whatsapp = require('../services/whatsappService');
        // await whatsapp.notifyOwnerOrderCancellation(order, order.user, reason); // DISABLED: Owner only gets new order notifications
        await whatsapp.notifyCustomerOrderStatusChange(order, order.user, 'cancelled');

        // Send refund/return notification if order was paid
        if (order.paymentStatus === 'paid') {
            await whatsapp.sendRefundReturnNotification(order, order.user);
        }
    } catch (whatsappErr) {
        console.error('Failed to send WhatsApp notification:', whatsappErr);
    }

    // Emit real-time update
    const { emitOrderStatusUpdate } = require('../socketHandler');
    emitOrderStatusUpdate(order.orderNumber, {
        status: order.orderStatus,
        paymentStatus: order.paymentStatus,
        statusHistory: order.statusHistory,
        orderId: order._id.toString(),
        userId: order.user._id.toString()
    });

    res.json({
        success: true,
        message: 'Order cancelled successfully',
        data: order
    });
});

// @desc    Check if order can be cancelled
// @route   GET /api/orders/:id/can-cancel
// @access  Private
const checkCanCancel = asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Check if user owns the order
    if (order.user.toString() !== req.user._id.toString() && !['admin', 'owner', 'superuser'].includes(req.user.role)) {
        res.status(403);
        throw new Error('Not authorized');
    }

    const daysSinceOrder = Math.floor((new Date() - new Date(order.createdAt)) / (24 * 60 * 60 * 1000));
    const canCancel = daysSinceOrder <= 14 &&
        order.orderStatus !== 'delivered' &&
        order.orderStatus !== 'cancelled';

    res.json({
        success: true,
        canCancel,
        daysSinceOrder,
        daysRemaining: canCancel ? 14 - daysSinceOrder : 0,
        reason: !canCancel ? (
            daysSinceOrder > 14 ? 'Cancellation period expired (14 days)' :
                order.orderStatus === 'delivered' ? 'Order already delivered' :
                    order.orderStatus === 'cancelled' ? 'Order already cancelled' :
                        'Unknown'
        ) : null
    });
});

// @desc    Public order tracking (via shareable link with token)
// @route   GET /api/orders/track/:orderNumber/:token
// @access  Public (no auth required — validated by tracking token)
const trackOrderPublic = asyncHandler(async (req, res) => {
    const { orderNumber, token } = req.params;

    const order = await Order.findOne({ orderNumber })
        .populate('deliveryPilot', 'name');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Validate tracking token
    if (!order.trackingToken || order.trackingToken !== token) {
        res.status(403);
        throw new Error('Invalid tracking link');
    }

    // Return LIMITED tracking data only — no personal info
    res.json({
        success: true,
        data: {
            orderNumber: order.orderNumber,
            orderStatus: order.orderStatus,
            statusHistory: order.statusHistory,
            createdAt: order.createdAt,
            deliveredAt: order.deliveredAt,
            deliveryLocation: order.deliveryLocation,
            deliveryPilot: order.deliveryPilot ? { name: order.deliveryPilot.name } : null,
            // Only include city-level address for map centering — no street/phone
            deliveryArea: order.shippingAddress ? {
                city: order.shippingAddress.city,
                coordinates: order.shippingAddress.coordinates
            } : null
        }
    });
});

// @desc    Get order for receipt rendering (PUBLIC — no auth required)
// @route   GET /api/orders/receipt/:orderNumber
// @access  Public
// WHY PUBLIC: Receipt links are shared via WhatsApp and printed on paper.
// They must work when opened on any device (e.g., iPhone from WhatsApp)
// without requiring the user to be logged in.
const getOrderForReceipt = asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber })
        .populate('user', 'name email phone');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Only show receipt for paid orders or COD orders
    const isPaid = order.paymentStatus === 'paid';
    const isCOD = order.paymentMethod === 'cod' && (order.paymentStatus === 'pending' || order.paymentStatus === 'paid');

    if (!isPaid && !isCOD) {
        res.status(403);
        throw new Error('Receipt not available — payment not confirmed');
    }

    res.json({
        success: true,
        data: order
    });
});

// @desc    Get fully rendered receipt HTML (PUBLIC — no auth required)
// @route   GET /api/orders/receipt/:orderNumber/html
// @access  Public
// Returns the SAME receipt HTML as the Raspberry Pi print agent
const getReceiptHTML = asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber })
        .populate('user', 'name email phone');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Only show receipt for paid orders or COD orders
    const isPaid = order.paymentStatus === 'paid';
    const isCOD = order.paymentMethod === 'cod' && (order.paymentStatus === 'pending' || order.paymentStatus === 'paid');

    if (!isPaid && !isCOD) {
        res.status(403);
        throw new Error('Receipt not available — payment not confirmed');
    }

    const { generateReceiptHTML } = require('../utils/receiptTemplate');
    const html = await generateReceiptHTML(order);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

module.exports = {
    createOrder,
    getMyOrders,
    getOrder,
    getOrderByNumber,
    getAllOrders,
    updateOrderStatus,
    cancelOrder,
    checkCanCancel,
    trackOrderPublic,
    getOrderForReceipt,
    getReceiptHTML
};
