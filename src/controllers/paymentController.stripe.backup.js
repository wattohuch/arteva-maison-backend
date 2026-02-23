// Initialize Stripe only if API key is provided and not disabled
const stripe = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'disabled'
    ? require('stripe')(process.env.STRIPE_SECRET_KEY)
    : null;

const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/error');
const { sendOrderConfirmation } = require('../services/emailService');

// @desc    Create Stripe checkout session
// @route   POST /api/payments/create-checkout-session
// @access  Private
const createCheckoutSession = asyncHandler(async (req, res) => {
    // Check if Stripe is configured
    if (!stripe) {
        res.status(503);
        throw new Error('Payment processing is currently unavailable. Stripe is not configured.');
    }

    const { shippingAddress, paymentMethod } = req.body;

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
        res.status(400);
        throw new Error('Cart is empty');
    }

    // Calculate totals
    let subtotal = 0;
    const lineItems = cart.items.map(item => {
        const product = item.product;
        subtotal += product.price * item.quantity;

        return {
            price_data: {
                currency: 'kwd',
                product_data: {
                    name: product.name,
                    description: product.description || '',
                    images: product.images.length > 0 ? [product.images[0].url] : []
                },
                unit_amount: Math.round(product.price * 1000) // Convert to fils (1 KWD = 1000 fils)
            },
            quantity: item.quantity
        };
    });

    // Add shipping if applicable
    const shippingCost = subtotal >= 50 ? 0 : 2.5;
    if (shippingCost > 0) {
        lineItems.push({
            price_data: {
                currency: 'kwd',
                product_data: {
                    name: 'Shipping',
                    description: 'Standard shipping'
                },
                unit_amount: Math.round(shippingCost * 1000)
            },
            quantity: 1
        });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: lineItems,
        customer_email: req.user.email,
        metadata: {
            userId: req.user._id.toString(),
            shippingAddress: JSON.stringify(shippingAddress)
        },
        success_url: `${process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com'}/order-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com'}/cart.html`
    });

    res.json({
        success: true,
        sessionId: session.id,
        url: session.url
    });
});

// @desc    Handle Stripe webhook
// @route   POST /api/payments/webhook
// @access  Public (verified by Stripe signature)
const handleWebhook = asyncHandler(async (req, res) => {
    // Check if Stripe is configured
    if (!stripe) {
        return res.status(503).json({ 
            success: false, 
            message: 'Payment processing is currently unavailable. Stripe is not configured.' 
        });
    }

    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            await handleSuccessfulPayment(session);
            break;
        case 'payment_intent.payment_failed':
            const paymentIntent = event.data.object;
            console.log('Payment failed:', paymentIntent.id);
            break;
        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
});

// Helper function to process successful payment
async function handleSuccessfulPayment(session) {
    const userId = session.metadata.userId;
    const shippingAddress = JSON.parse(session.metadata.shippingAddress || '{}');

    // Get user's cart and user info
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    const user = await User.findById(userId);

    if (!cart || cart.items.length === 0) {
        console.error('Cart not found for payment session:', session.id);
        return;
    }

    // Build order items
    const orderItems = cart.items.map(item => ({
        product: item.product._id,
        name: item.product.name,
        image: item.product.images[0]?.url || '',
        price: item.product.price,
        quantity: item.quantity
    }));

    const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shippingCost = subtotal >= 50 ? 0 : 2.5;
    const total = subtotal + shippingCost;

    // Create order
    const order = await Order.create({
        user: userId,
        items: orderItems,
        shippingAddress,
        paymentMethod: 'card',
        paymentStatus: 'paid',
        orderStatus: 'confirmed',
        subtotal,
        shippingCost,
        total,
        stripeSessionId: session.id
    });

    // Clear cart
    cart.items = [];
    await cart.save();

    // Send order confirmation email
    if (user) {
        sendOrderConfirmation(order, user).catch(err => console.error('Order email error:', err));
    }

    console.log('Order created from Stripe payment:', order.orderNumber);
}

// @desc    Get payment session status
// @route   GET /api/payments/session/:sessionId
// @access  Private
const getSessionStatus = asyncHandler(async (req, res) => {
    // Check if Stripe is configured
    if (!stripe) {
        res.status(503);
        throw new Error('Payment processing is currently unavailable. Stripe is not configured.');
    }

    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);

    // Find order by stripe session ID
    const order = await Order.findOne({ stripeSessionId: session.id });

    res.json({
        success: true,
        data: {
            status: session.payment_status,
            orderId: order?._id,
            orderNumber: order?.orderNumber
        }
    });
});

// @desc    Process Cash on Delivery order
// @route   POST /api/payments/cod
// @access  Private
const processCOD = asyncHandler(async (req, res) => {
    const { shippingAddress, notes } = req.body;

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
            image: product.images[0]?.url || '',
            price: product.price,
            quantity: item.quantity
        });

        subtotal += product.price * item.quantity;

        // Reduce stock
        product.stock -= item.quantity;
        await product.save();
    }

    const shippingCost = subtotal >= 50 ? 0 : 2.5;
    const total = subtotal + shippingCost;

    // Create order
    const order = await Order.create({
        user: req.user._id,
        items: orderItems,
        shippingAddress,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        orderStatus: 'pending',
        subtotal,
        shippingCost,
        total,
        notes
    });

    // Clear cart
    cart.items = [];
    await cart.save();

    // Send order confirmation email
    const user = await User.findById(req.user._id);
    if (user) {
        sendOrderConfirmation(order, user).catch(err => console.error('Order email error:', err));
    }

    res.status(201).json({
        success: true,
        data: order
    });
});

// @desc    Process KNET payment (redirect flow)
// @route   POST /api/payments/knet
// @access  Private
const processKNET = asyncHandler(async (req, res) => {
    // KNET integration requires specific setup with a Kuwaiti bank
    // This is a placeholder that would need to be implemented with actual KNET gateway

    res.json({
        success: false,
        message: 'KNET integration requires merchant account setup with a Kuwaiti bank. Please contact support for setup instructions.',
        info: {
            provider: 'KNET',
            description: 'Kuwait National Electronic Payment System',
            setup_required: true
        }
    });
});

module.exports = {
    createCheckoutSession,
    handleWebhook,
    getSessionStatus,
    processCOD,
    processKNET
};
