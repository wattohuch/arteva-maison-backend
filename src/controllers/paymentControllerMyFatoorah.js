const { asyncHandler } = require('../middleware/error');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const myfatoorah = require('../services/myfatoorahService');
const { sendOrderConfirmation } = require('../services/emailService');

// @desc    Get available payment methods
// @route   GET /api/payments/methods
// @access  Public
const getPaymentMethods = asyncHandler(async (req, res) => {
    const amount = req.query.amount || 1;
    const methods = await myfatoorah.getPaymentMethods(amount);

    res.json({
        success: true,
        data: methods.methods
    });
});

// @desc    Create payment session
// @route   POST /api/payments/create-session
// @access  Private
const createPaymentSession = asyncHandler(async (req, res) => {
    const { paymentMethod, shippingAddress } = req.body;

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
    const order = await Order.create({
        user: req.user._id,
        items: cart.items.map(item => ({
            product: item.product._id,
            name: item.product.name,
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
    const { paymentMethodId, shippingAddress } = req.body;

    console.log('=== EXECUTE PAYMENT REQUEST ===');
    console.log('Payment Method ID:', paymentMethodId);
    console.log('Shipping Address:', JSON.stringify(shippingAddress, null, 2));
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
    const total = subtotal + shippingCost;

    console.log('Order totals - Subtotal:', subtotal, 'Shipping:', shippingCost, 'Total:', total);

    // Create order
    const order = await Order.create({
        user: req.user._id,
        items: cart.items.map(item => ({
            product: item.product._id,
            name: item.product.name,
            price: item.product.price,
            quantity: item.quantity,
            image: item.product.images[0]?.url
        })),
        shippingAddress,
        paymentMethod: getPaymentMethodName(paymentMethodId),
        paymentStatus: 'awaiting_payment',
        orderStatus: 'pending',
        subtotal,
        shippingCost,
        total
    });

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

    console.log('Calling MyFatoorah executePayment...');

    try {
        const payment = await myfatoorah.executePayment(paymentData);

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
        order.paymentStatus = 'payment_failed';
        order.orderStatus = 'cancelled';
        order.notes = `Payment execution failed: ${error.message}`;
        await order.save();
        console.log(`[PAYMENT] Order ${order.orderNumber} marked as payment_failed`);

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
    const paymentStatus = await myfatoorah.getPaymentStatus(paymentId);

    // Find order
    const order = await Order.findById(paymentStatus.orderId).populate('user', 'name email');

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

        // Send confirmation email
        try {
            await sendOrderConfirmation(order, order.user);
        } catch (emailErr) {
            // Don't fail the payment verification if email fails
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

        const order = await Order.findById(paymentStatus.orderId).populate('user', 'name email');

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

            // Send email (don't fail on error)
            try {
                await sendOrderConfirmation(order, order.user);
            } catch (emailErr) { /* silent */ }

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
    const order = await Order.create({
        user: req.user._id,
        items: cart.items.map(item => ({
            product: item.product._id,
            name: item.product.name,
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

    // Send confirmation email
    await sendOrderConfirmation(order, req.user);

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
        20: 'applepay'
    };
    return methods[methodId] || 'myfatoorah';
}

module.exports = {
    getPaymentMethods,
    createPaymentSession,
    executePayment,
    verifyPayment,
    handleWebhook,
    processCOD
};
