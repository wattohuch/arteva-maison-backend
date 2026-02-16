const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/error');
const { paginate } = require('../utils/helpers');
const { emitNewOrder } = require('../socketHandler');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = asyncHandler(async (req, res) => {
    const { shippingAddress, paymentMethod, notes } = req.body;

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

    // Calculate shipping (free over 50 KWD)
    const shippingCost = subtotal >= 50 ? 0 : 2.5;
    const total = subtotal + shippingCost;

    const order = await Order.create({
        user: req.user._id,
        items: orderItems,
        shippingAddress,
        paymentMethod,
        subtotal,
        shippingCost,
        total,
        notes
    });

    // Clear cart after order
    cart.items = [];
    await cart.save();

    // Notify admin dashboard in real-time
    try {
        emitNewOrder(order);
    } catch (e) {
        console.error('Socket notification error:', e.message);
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

    const orders = await Order.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    const total = await Order.countDocuments({ user: req.user._id });

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

    // Check if user owns the order or is admin
    if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
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

    let filter = {};
    if (status) {
        filter.orderStatus = status;
    }

    const orders = await Order.find(filter)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

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

module.exports = {
    createOrder,
    getMyOrders,
    getOrder,
    getAllOrders,
    updateOrderStatus
};
