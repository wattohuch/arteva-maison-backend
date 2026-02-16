const { asyncHandler } = require('../middleware/error'); // Fix import destructuring
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const nodemailer = require('nodemailer');

// @desc    Get dashboard statistics
// @route   GET /api/admin/stats
// @access  Private/Admin
const getDashboardStats = asyncHandler(async (req, res) => {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalProducts = await Product.countDocuments();
    const totalOrders = await Order.countDocuments();

    // Calculate total revenue
    const orders = await Order.find({ paymentStatus: 'paid' });
    const totalRevenue = orders.reduce((acc, order) => acc + order.total, 0);

    // Recent orders
    const recentOrders = await Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name email')
        .populate('deliveryPilot', 'name phone');

    res.json({
        success: true,
        data: {
            totalUsers,
            totalProducts,
            totalOrders,
            totalRevenue,
            recentOrders
        }
    });
});

// @desc    Get all products (admin view)
// @route   GET /api/admin/products
// @access  Private/Admin
const getAdminProducts = asyncHandler(async (req, res) => {
    const products = await Product.find({})
        .sort({ createdAt: -1 })
        .populate('category', 'name');
    res.json({ success: true, data: products });
});

// @desc    Create a product
// @route   POST /api/admin/products
// @access  Private/Admin
const createProduct = asyncHandler(async (req, res) => {
    const { name, nameAr, description, descriptionAr, price, category, stock, sku, isFeatured, isNewArrival, isComingSoon } = req.body;

    let images = [];
    if (req.files && req.files.length > 0) {
        images = req.files.map((file, index) => ({
            url: `/assets/images/products/${file.filename}`,
            isPrimary: index === 0
        }));
    }

    const product = await Product.create({
        name,
        nameAr,
        description,
        descriptionAr,
        price,
        category,
        stock,
        sku,
        isFeatured: isFeatured === 'true',
        isNewArrival: isNewArrival === 'true',
        isComingSoon: isComingSoon === 'true',
        images
    });

    res.status(201).json({ success: true, data: product });
});

// @desc    Update a product
// @route   PUT /api/admin/products/:id
// @access  Private/Admin
const updateProduct = asyncHandler(async (req, res) => {
    let product = await Product.findById(req.params.id);

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    const { name, nameAr, description, descriptionAr, price, category, stock, sku, isFeatured, isNewArrival, isComingSoon } = req.body;

    // Handle image updates if new files uploaded
    if (req.files && req.files.length > 0) {
        const newImages = req.files.map((file, index) => ({
            url: `/assets/images/products/${file.filename}`,
            isPrimary: index === 0 && product.images.length === 0
        }));
        product.images = [...product.images, ...newImages];
    }

    product.name = name || product.name;
    product.nameAr = nameAr || product.nameAr;
    product.description = description || product.description;
    product.descriptionAr = descriptionAr || product.descriptionAr;
    product.price = price || product.price;
    product.category = category || product.category;
    product.stock = stock || product.stock;
    product.sku = sku || product.sku;
    product.isFeatured = isFeatured !== undefined ? isFeatured === 'true' : product.isFeatured;
    product.isNewArrival = isNewArrival !== undefined ? isNewArrival === 'true' : product.isNewArrival;
    product.isComingSoon = isComingSoon !== undefined ? isComingSoon === 'true' : product.isComingSoon;

    const updatedProduct = await product.save();
    res.json({ success: true, data: updatedProduct });
});

// @desc    Delete a product
// @route   DELETE /api/admin/products/:id
// @access  Private/Admin
const deleteProduct = asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    await product.deleteOne();
    res.json({ success: true, message: 'Product removed' });
});

// @desc    Get all orders
// @route   GET /api/admin/orders
// @access  Private/Admin
const getAdminOrders = asyncHandler(async (req, res) => {
    const orders = await Order.find({})
        .populate('user', 'name email phone')
        .populate('deliveryPilot', 'name phone')
        .sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
});

// @desc    Update order status
// @route   PUT /api/admin/orders/:id/status
// @access  Private/Admin
const updateOrderStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    order.updateStatus(status, 'Status updated by admin', req.user._id);

    if (status === 'paid' || status === 'delivered') {
        order.paymentStatus = 'paid';
    }

    await order.save();

    // Emit real-time update (include orderId for admin dashboard)
    const { emitOrderStatusUpdate } = require('../socketHandler');
    emitOrderStatusUpdate(order.orderNumber, {
        status: order.orderStatus,
        statusHistory: order.statusHistory,
        orderId: order._id.toString()
    });

    res.json({ success: true, data: order });
});

// @desc    Assign driver to order
// @route   PUT /api/admin/orders/:id/assign
// @access  Private/Admin
const assignDriver = asyncHandler(async (req, res) => {
    const { driverId } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') {
        res.status(400);
        throw new Error('Invalid driver');
    }

    order.deliveryPilot = driverId;
    order.updateStatus('handed_over', `Assigned to driver: ${driver.name}`, req.user._id);
    await order.save();

    res.json({ success: true, data: order });
});

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
const getAdminUsers = asyncHandler(async (req, res) => {
    const users = await User.find({}).select('-password');
    res.json({ success: true, data: users });
});

// @desc    Update user role
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
const updateUserRole = asyncHandler(async (req, res) => {
    const { role } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
        res.status(404);
        throw new Error('User not found');
    }

    user.role = role;
    await user.save();
    res.json({ success: true, data: user });
});

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);

    if (!user) {
        res.status(404);
        throw new Error('User not found');
    }

    await user.deleteOne();
    res.json({ success: true, message: 'User removed' });
});

// @desc    Send offer email
// @route   POST /api/admin/send-email
// @access  Private/Admin
const sendOfferEmail = async (req, res) => {
    const { subject, message, recipientType } = req.body;

    try {
        let users;
        if (recipientType === 'all') {
            users = await User.find({});
        } else if (recipientType === 'subscribers') {
            users = await User.find({ isSubscribed: true }); // Assuming isSubscribed field exists
        } else {
            return res.status(400).json({ success: false, message: 'Invalid recipient type' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // Send email to each user (limit for demo)
        const targetUsers = users.slice(0, 5);

        for (const user of targetUsers) {
            await transporter.sendMail({
                from: `"Arteva Maison Team" <${process.env.EMAIL_USER}>`,
                to: user.email,
                subject: subject,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Hello ${user.name},</h2>
                        <p>${message}</p>
                        <hr>
                        <p>Best regards,<br>ARTEVA Maison Team</p>
                    </div>
                `
            });
        }

        res.json({ success: true, message: `Email sent to ${targetUsers.length} users` });
    } catch (error) {
        console.error('Email send error:', error);
        res.status(500).json({ success: false, message: 'Failed to send emails' });
    }
};

module.exports = {
    getDashboardStats,
    getAdminProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    getAdminOrders,
    updateOrderStatus,
    assignDriver,
    getAdminUsers,
    updateUserRole,
    deleteUser,
    sendOfferEmail
};
