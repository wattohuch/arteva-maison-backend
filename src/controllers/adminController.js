const { asyncHandler } = require('../middleware/error'); // Fix import destructuring
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } = require('../config/cloudinary');

// Helper function to parse boolean values consistently
// Handles: boolean, string ('true'/'false'), number (1/0), undefined
const parseBoolean = (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.toLowerCase();
        return lower === 'true' || lower === '1' || lower === 'yes';
    }
    if (typeof value === 'number') return value !== 0;
    return Boolean(value);
};

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
    const { name, nameAr, description, descriptionAr, price, category, additionalCategories, stock, sku, isFeatured, isNewArrival, isComingSoon } = req.body;

    // Parse boolean values consistently
    const isFeaturedValue = parseBoolean(isFeatured);
    const isNewArrivalValue = parseBoolean(isNewArrival);
    const isComingSoonValue = parseBoolean(isComingSoon);

    // Parse additionalCategories if sent as JSON string
    let parsedAdditionalCategories = [];
    if (additionalCategories) {
        try {
            parsedAdditionalCategories = typeof additionalCategories === 'string' 
                ? JSON.parse(additionalCategories) 
                : additionalCategories;
        } catch (e) {
            console.error('[ADMIN CREATE] Failed to parse additionalCategories:', e);
        }
    }

    console.log(`[ADMIN CREATE] New product "${name}" by ${req.user.email}`);
    console.log(`[ADMIN CREATE] Boolean flags:`, {
        isFeatured: isFeaturedValue,
        isNewArrival: isNewArrivalValue,
        isComingSoon: isComingSoonValue
    });
    console.log(`[ADMIN CREATE] Categories:`, { primary: category, additional: parsedAdditionalCategories });

    let images = [];
    if (req.files && req.files.length > 0) {
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            try {
                const result = await uploadToCloudinary(file.buffer, 'products');
                images.push({
                    url: result.url,
                    isPrimary: i === 0
                });
                console.log(`[ADMIN CREATE] ⬆️ Image uploaded to Cloudinary: ${result.url}`);
            } catch (err) {
                console.error(`[ADMIN CREATE] ❌ Failed to upload image:`, err.message);
            }
        }
    }

    const product = await Product.create({
        name,
        nameAr,
        description,
        descriptionAr,
        price,
        category,
        additionalCategories: parsedAdditionalCategories,
        stock,
        sku,
        isFeatured: isFeaturedValue || false,
        isNewArrival: isNewArrivalValue || false,
        isComingSoon: isComingSoonValue || false,
        images
    });

    console.log(`[ADMIN CREATE] ✅ Product created with ID: ${product._id}`);

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

    const { name, nameAr, description, descriptionAr, price, category, additionalCategories, stock, sku, isFeatured, isNewArrival, isComingSoon, isCollectionFeatured, imagesToDelete, primaryImageUrl } = req.body;

    // Parse boolean values consistently
    const isFeaturedValue = parseBoolean(isFeatured);
    const isNewArrivalValue = parseBoolean(isNewArrival);
    const isComingSoonValue = parseBoolean(isComingSoon);
    const isCollectionFeaturedValue = parseBoolean(isCollectionFeatured);

    // Parse additionalCategories if sent as JSON string
    let parsedAdditionalCategories;
    if (additionalCategories !== undefined) {
        try {
            parsedAdditionalCategories = typeof additionalCategories === 'string' 
                ? JSON.parse(additionalCategories) 
                : additionalCategories;
        } catch (e) {
            console.error('[ADMIN UPDATE] Failed to parse additionalCategories:', e);
            parsedAdditionalCategories = [];
        }
    }

    // Log admin action for debugging and audit trail
    console.log(`[ADMIN UPDATE] Product ${product._id} (${product.name}) updated by ${req.user.email}`);
    console.log(`[ADMIN UPDATE] Boolean flags:`, {
        isFeatured: isFeaturedValue,
        isNewArrival: isNewArrivalValue,
        isComingSoon: isComingSoonValue,
        isCollectionFeatured: isCollectionFeaturedValue
    });
    if (parsedAdditionalCategories !== undefined) {
        console.log(`[ADMIN UPDATE] Additional categories:`, parsedAdditionalCategories);
    }

    // Handle image deletion
    if (imagesToDelete) {
        try {
            const urlsToDelete = JSON.parse(imagesToDelete);
            const originalCount = product.images.length;
            // Delete from Cloudinary
            for (const url of urlsToDelete) {
                const publicId = getPublicIdFromUrl(url);
                if (publicId) {
                    await deleteFromCloudinary(publicId);
                    console.log(`[ADMIN UPDATE] 🗑️ Deleted from Cloudinary: ${publicId}`);
                }
            }
            product.images = product.images.filter(img => !urlsToDelete.includes(img.url));
            console.log(`[ADMIN UPDATE] Deleted ${originalCount - product.images.length} images`);
        } catch (err) {
            console.error('[ADMIN UPDATE] Error parsing imagesToDelete:', err);
        }
    }

    // Handle image updates if new files uploaded
    if (req.files && req.files.length > 0) {
        const newImages = [];
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            try {
                const result = await uploadToCloudinary(file.buffer, 'products');
                newImages.push({
                    url: result.url,
                    isPrimary: i === 0 && product.images.length === 0
                });
                console.log(`[ADMIN UPDATE] ⬆️ Image uploaded to Cloudinary: ${result.url}`);
            } catch (err) {
                console.error(`[ADMIN UPDATE] ❌ Failed to upload image:`, err.message);
            }
        }
        product.images = [...product.images, ...newImages];
        console.log(`[ADMIN UPDATE] Added ${newImages.length} new images`);
    }

    // Update primary image if specified
    if (primaryImageUrl) {
        product.images.forEach(img => {
            img.isPrimary = img.url === primaryImageUrl;
        });
        console.log(`[ADMIN UPDATE] Set primary image to: ${primaryImageUrl}`);
    }

    // Update fields - only update if value is provided
    if (name !== undefined) product.name = name;
    if (nameAr !== undefined) product.nameAr = nameAr;
    if (description !== undefined) product.description = description;
    if (descriptionAr !== undefined) product.descriptionAr = descriptionAr;
    if (price !== undefined) product.price = price;
    if (category !== undefined) product.category = category;
    if (parsedAdditionalCategories !== undefined) product.additionalCategories = parsedAdditionalCategories;
    if (stock !== undefined) product.stock = stock;
    if (sku !== undefined) product.sku = sku;

    // Update boolean flags - CRITICAL: Only update if explicitly provided
    if (isFeaturedValue !== undefined) {
        product.isFeatured = isFeaturedValue;
        console.log(`[ADMIN UPDATE] isFeatured set to: ${isFeaturedValue}`);
    }
    if (isNewArrivalValue !== undefined) {
        product.isNewArrival = isNewArrivalValue;
        console.log(`[ADMIN UPDATE] isNewArrival set to: ${isNewArrivalValue}`);
    }
    if (isComingSoonValue !== undefined) {
        product.isComingSoon = isComingSoonValue;
        console.log(`[ADMIN UPDATE] isComingSoon set to: ${isComingSoonValue}`);
    }
    if (isCollectionFeaturedValue !== undefined) {
        product.isCollectionFeatured = isCollectionFeaturedValue;
        console.log(`[ADMIN UPDATE] isCollectionFeatured set to: ${isCollectionFeaturedValue}`);
    }

    // Save to database - THIS IS THE PERMANENT SAVE
    const updatedProduct = await product.save();

    console.log(`[ADMIN UPDATE] ✅ Product saved to database successfully`);
    console.log(`[ADMIN UPDATE] Final values:`, {
        isFeatured: updatedProduct.isFeatured,
        isNewArrival: updatedProduct.isNewArrival,
        isComingSoon: updatedProduct.isComingSoon,
        isCollectionFeatured: updatedProduct.isCollectionFeatured
    });

    res.json({
        success: true,
        data: updatedProduct,
        message: 'Product updated successfully and saved to database',
        changes: {
            isFeatured: isFeaturedValue,
            isNewArrival: isNewArrivalValue,
            isComingSoon: isComingSoonValue,
            isCollectionFeatured: isCollectionFeaturedValue
        }
    });
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
    const order = await Order.findById(req.params.id).populate('user', 'name email phone');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    const oldStatus = order.orderStatus;
    order.updateStatus(status, 'Status updated by admin', req.user._id);

    if (status === 'paid' || status === 'delivered') {
        order.paymentStatus = 'paid';
    }

    await order.save();

    // Send WhatsApp notification to OWNER about status change
    try {
        const whatsapp = require('../services/whatsappService');
        await whatsapp.notifyOwnerOrderStatusChange(order, order.user, oldStatus, status);
    } catch (whatsappErr) {
        console.error('Failed to send WhatsApp notification:', whatsappErr);
    }

    // Emit real-time update (include orderId for admin dashboard)
    const { emitOrderStatusUpdate } = require('../socketHandler');
    emitOrderStatusUpdate(order.orderNumber, {
        status: order.orderStatus,
        statusHistory: order.statusHistory,
        orderId: order._id.toString(),
        userId: order.user ? order.user._id.toString() : null
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

    // Role change restrictions
    // Only owner/superuser can assign owner role
    if (role === 'owner' && req.user.role !== 'owner' && req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Only owners can assign owner role');
    }

    // Only superuser can assign superuser role
    if (role === 'superuser' && req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Only superuser can assign superuser role');
    }

    // Cannot change owner's role unless you are owner or superuser
    if (user.role === 'owner' && req.user.role !== 'owner' && req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Cannot change owner role');
    }

    // Cannot change superuser's role unless you are superuser
    if (user.role === 'superuser' && req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Cannot change superuser role');
    }

    // Admin can only assign admin, driver, or user roles
    if (req.user.role === 'admin' && !['admin', 'driver', 'user'].includes(role)) {
        res.status(403);
        throw new Error('Admins can only assign admin, driver, or user roles');
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
    const images = req.files || []; // Get uploaded images from multer

    try {
        let users;
        if (recipientType === 'all') {
            users = await User.find({});
        } else if (recipientType === 'subscribers') {
            users = await User.find({ isSubscribed: true });
        } else {
            return res.status(400).json({ success: false, message: 'Invalid recipient type' });
        }

        if (users.length === 0) {
            return res.status(400).json({ success: false, message: 'No users found to send emails to' });
        }

        // Limit to 50 users for safety
        const targetUsers = users.slice(0, 50);

        // Build image HTML if images are attached
        let imagesHtml = '';
        if (images && images.length > 0) {
            imagesHtml = '<div style="margin: 20px 0; text-align: center;">';
            images.forEach(image => {
                const imageUrl = `${process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com'}/uploads/${image.filename}`;
                imagesHtml += `<img src="${imageUrl}" alt="Campaign Image" style="max-width: 100%; height: auto; margin: 10px 0; border-radius: 8px;">`;
            });
            imagesHtml += '</div>';
        }

        // Respond immediately — emails will be sent in the background
        res.status(202).json({
            success: true,
            message: `Email campaign queued for ${targetUsers.length} recipients. Emails are being sent in the background.`,
            details: {
                total: targetUsers.length,
                status: 'processing'
            }
        });

        // Send emails in the background (after response is sent)
        const { sendEmail } = require('../services/emailService');
        let successCount = 0;
        let failCount = 0;

        for (const user of targetUsers) {
            const emailHtml = `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: #8b7355; padding: 20px; text-align: center;">
                        <h1 style="color: white; margin: 0;">ARTÉVA MAISON</h1>
                    </div>
                    <div style="padding: 30px; background-color: #f9f7f2;">
                        <h2 style="color: #2c241b;">Hello ${user.name},</h2>
                        <div style="color: #4a3b2a; line-height: 1.6;">
                            ${message}
                        </div>
                        ${imagesHtml}
                    </div>
                    <div style="padding: 20px; text-align: center; background-color: #ffffff; border-top: 1px solid #e6e1d6;">
                        <p style="color: #8b7355; margin: 0;">Best regards,<br>ARTÉVA Maison Team</p>
                    </div>
                </div>
            `;

            const result = await sendEmail({
                to: user.email,
                subject: subject,
                html: emailHtml
            });

            if (result.success) {
                successCount++;
            } else {
                failCount++;
                console.error(`Failed to send email to ${user.email}:`, result.error);
            }
        }

        console.log(`[EMAIL CAMPAIGN] Completed: ${successCount} sent, ${failCount} failed out of ${targetUsers.length}`);

        // Emit result via socket if available (for admin dashboard real-time feedback)
        try {
            const io = req.app.locals.io;
            if (io) {
                io.to('admin_room').emit('email_campaign_complete', {
                    total: targetUsers.length,
                    sent: successCount,
                    failed: failCount,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (socketErr) {
            // Socket notification is optional
        }

    } catch (error) {
        console.error('Email campaign error:', error);
        // Only send error if response hasn't been sent yet
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to start email campaign' });
        }
    }
};

// @desc    Get product view analytics
// @route   GET /api/admin/analytics/product-views
// @access  Private/Admin
const getProductViewAnalytics = asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;

    const products = await Product.find({ isActive: true })
        .select('name nameAr images category viewCount price')
        .populate('category', 'name')
        .sort({ viewCount: -1 })
        .limit(limit)
        .lean();

    // Calculate totals
    const totalViews = products.reduce((sum, p) => sum + (p.viewCount || 0), 0);
    const totalProducts = await Product.countDocuments({ isActive: true });

    res.json({
        success: true,
        data: {
            products,
            summary: {
                totalViews,
                totalProducts,
                topProduct: products.length > 0 ? products[0].name : 'N/A',
                averageViews: totalProducts > 0 ? Math.round(totalViews / totalProducts) : 0
            }
        }
    });
});

// @desc    Get revenue history with breakdowns and paid orders
// @route   GET /api/admin/revenue-history
// @access  Private/Superuser
const getRevenueHistory = asyncHandler(async (req, res) => {
    if (req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Access denied. Only superuser can access revenue data.');
    }

    const now = new Date();

    // Start of today (Kuwait time UTC+3)
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Start of this week (Sunday)
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    // Start of this month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 12 months ago
    const yearStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);

    // Today's revenue
    const todayOrders = await Order.find({
        paymentStatus: 'paid',
        createdAt: { $gte: todayStart }
    }).lean();
    const todayRevenue = todayOrders.reduce((sum, o) => sum + o.total, 0);
    const todayOrderCount = todayOrders.length;

    // This week's revenue
    const weekOrders = await Order.find({
        paymentStatus: 'paid',
        createdAt: { $gte: weekStart }
    }).lean();
    const weekRevenue = weekOrders.reduce((sum, o) => sum + o.total, 0);

    // This month's revenue
    const monthOrders = await Order.find({
        paymentStatus: 'paid',
        createdAt: { $gte: monthStart }
    }).lean();
    const monthRevenue = monthOrders.reduce((sum, o) => sum + o.total, 0);

    // All-time revenue
    const allOrders = await Order.find({ paymentStatus: 'paid' }).lean();
    const allTimeRevenue = allOrders.reduce((sum, o) => sum + o.total, 0);
    const totalOrderCount = allOrders.length;

    // Get detailed paid orders for receipts (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const paidOrders = await Order.find({
        paymentStatus: 'paid',
        createdAt: { $gte: sixMonthsAgo }
    })
    .populate('user', 'name email phone language')
    .sort({ createdAt: -1 })
    .lean();

    // Daily breakdown (last 30 days) using aggregation
    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyBreakdown = await Order.aggregate([
        {
            $match: {
                paymentStatus: 'paid',
                createdAt: { $gte: thirtyDaysAgo }
            }
        },
        {
            $group: {
                _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                },
                revenue: { $sum: '$total' },
                orders: { $sum: 1 }
            }
        },
        { $sort: { '_id.year': -1, '_id.month': -1, '_id.day': -1 } }
    ]);

    // Monthly breakdown (last 12 months) using aggregation
    const monthlyBreakdown = await Order.aggregate([
        {
            $match: {
                paymentStatus: 'paid',
                createdAt: { $gte: yearStart }
            }
        },
        {
            $group: {
                _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' }
                },
                revenue: { $sum: '$total' },
                orders: { $sum: 1 }
            }
        },
        { $sort: { '_id.year': -1, '_id.month': -1 } }
    ]);

    res.json({
        success: true,
        data: {
            summary: {
                today: { revenue: todayRevenue, orders: todayOrderCount },
                thisWeek: { revenue: weekRevenue, orders: weekOrders.length },
                thisMonth: { revenue: monthRevenue, orders: monthOrders.length },
                allTime: { revenue: allTimeRevenue, orders: totalOrderCount }
            },
            paidOrders: paidOrders.map(order => ({
                _id: order._id,
                orderNumber: order.orderNumber,
                customer: {
                    name: order.user.name,
                    email: order.user.email,
                    phone: order.user.phone,
                    language: order.user.language
                },
                total: order.total,
                currency: order.currency,
                paymentMethod: order.paymentMethod,
                createdAt: order.createdAt,
                paidAt: order.paidAt,
                items: order.items,
                shippingAddress: order.shippingAddress,
                // Calculate if order is within 14-day cancellation period
                canCancel: new Date() - new Date(order.createdAt) <= 14 * 24 * 60 * 60 * 1000,
                daysSinceOrder: Math.floor((new Date() - new Date(order.createdAt)) / (24 * 60 * 60 * 1000))
            })),
            dailyBreakdown: dailyBreakdown.map(d => ({
                date: `${d._id.year}-${String(d._id.month).padStart(2, '0')}-${String(d._id.day).padStart(2, '0')}`,
                revenue: d.revenue,
                orders: d.orders
            })),
            monthlyBreakdown: monthlyBreakdown.map(m => ({
                year: m._id.year,
                month: m._id.month,
                revenue: m.revenue,
                orders: m.orders
            }))
        }
    });
});

// @desc    Check if user is superuser
// @route   GET /api/admin/check-superuser
// @access  Private
const checkSuperuser = asyncHandler(async (req, res) => {
    res.json({
        success: true,
        isSuperuser: req.user.role === 'superuser'
    });
});

// @desc    Authenticate revenue access with password
// @route   POST /api/admin/revenue-auth
// @access  Private/Superuser
const authenticateRevenueAccess = asyncHandler(async (req, res) => {
    const { revenuePassword } = req.body;

    if (req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Access denied. Only superuser can access revenue data.');
    }

    const user = await User.findById(req.user._id).select('+revenuePassword');

    if (!user.revenuePassword) {
        res.status(400);
        throw new Error('Revenue password not set. Please contact administrator.');
    }

    // Compare directly against revenuePassword (not the login password)
    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(revenuePassword, user.revenuePassword);

    if (!isMatch) {
        res.status(401);
        throw new Error('Invalid revenue password');
    }

    res.json({
        success: true,
        message: 'Revenue access authenticated'
    });
});

// @desc    Request revenue OTP
// @route   POST /api/admin/revenue-otp/request
// @access  Private/Superuser
const requestRevenueOTP = asyncHandler(async (req, res) => {
    if (req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Access denied. Only superuser can request revenue OTP.');
    }

    const user = await User.findById(req.user._id);

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.revenueOTP = otp;
    user.revenueOTPExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    // Send OTP via email and SMS
    const { sendEmail } = require('../services/emailService');
    
    const emailHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #8b7355; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ARTÉVA MAISON</h1>
            </div>
            <div style="padding: 30px; background-color: #f9f7f2;">
                <h2 style="color: #2c241b;">Revenue Access OTP</h2>
                <p style="color: #4a3b2a;">Your OTP for revenue access is:</p>
                <div style="background-color: #8b7355; color: white; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; margin: 20px 0; border-radius: 8px;">
                    ${otp}
                </div>
                <p style="color: #4a3b2a;">This OTP will expire in 10 minutes.</p>
            </div>
        </div>
    `;

    await sendEmail({
        to: 'mohammadalawaji2@gmail.com',
        subject: 'Revenue Access OTP - ARTEVA Maison',
        html: emailHtml
    });

    // TODO: Integrate SMS service for +965656115663
    console.log(`[REVENUE OTP] Generated OTP ${otp} for user ${user.email}`);

    res.json({
        success: true,
        message: 'OTP sent to registered email and phone number'
    });
});

// @desc    Verify revenue OTP
// @route   POST /api/admin/revenue-otp/verify
// @access  Private/Superuser
const verifyRevenueOTP = asyncHandler(async (req, res) => {
    const { otp } = req.body;

    if (req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Access denied. Only superuser can verify revenue OTP.');
    }

    const user = await User.findById(req.user._id);

    if (!user.revenueOTP || !user.revenueOTPExpiry) {
        res.status(400);
        throw new Error('No OTP request found. Please request a new OTP.');
    }

    if (new Date() > user.revenueOTPExpiry) {
        res.status(400);
        throw new Error('OTP has expired. Please request a new OTP.');
    }

    if (user.revenueOTP !== otp) {
        res.status(401);
        throw new Error('Invalid OTP');
    }

    // Clear OTP after successful verification
    user.revenueOTP = null;
    user.revenueOTPExpiry = null;
    await user.save();

    res.json({
        success: true,
        message: 'OTP verified successfully'
    });
});

// @desc    Generate receipt for order
// @route   GET /api/admin/receipt/:orderId
// @access  Private/Superuser
const generateReceipt = asyncHandler(async (req, res) => {
    if (req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Access denied. Only superuser can generate receipts.');
    }

    const order = await Order.findById(req.params.orderId)
        .populate('user', 'name email phone language')
        .lean();

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    if (order.paymentStatus !== 'paid') {
        res.status(400);
        throw new Error('Receipt can only be generated for paid orders');
    }

    const isArabic = order.user.language === 'ar';
    const daysSinceOrder = Math.floor((new Date() - new Date(order.createdAt)) / (24 * 60 * 60 * 1000));
    const canCancel = daysSinceOrder <= 14;

    // Generate receipt HTML
    const receiptHtml = generateReceiptHTML(order, isArabic, canCancel, daysSinceOrder);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(receiptHtml);
});

// @desc    Set revenue password for superuser (first time)
// @route   POST /api/admin/set-revenue-password
// @access  Private/Superuser
const setRevenuePassword = asyncHandler(async (req, res) => {
    const { revenuePassword } = req.body;

    if (req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Access denied. Only superuser can set revenue password.');
    }

    if (!revenuePassword || revenuePassword.length < 6) {
        res.status(400);
        throw new Error('Revenue password must be at least 6 characters');
    }

    const user = await User.findById(req.user._id).select('+revenuePassword');

    // Only allow setting if not already set
    if (user.revenuePassword) {
        res.status(400);
        throw new Error('Revenue password already set. Use forgot password to reset.');
    }

    // Hash and save revenue password
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    user.revenuePassword = await bcrypt.hash(revenuePassword, salt);
    await user.save();

    console.log(`[REVENUE] Revenue password set for superuser: ${user.email}`);

    res.json({
        success: true,
        message: 'Revenue password set successfully'
    });
});

// Helper function to generate receipt HTML (compact, single-page print)
function generateReceiptHTML(order, isArabic, canCancel, daysSinceOrder) {
    const dir = isArabic ? 'rtl' : 'ltr';
    const align = isArabic ? 'right' : 'left';
    const oppositeAlign = isArabic ? 'left' : 'right';
    
    const texts = isArabic ? {
        title: 'إيصال الطلب',
        orderNumber: 'رقم الطلب',
        orderDate: 'تاريخ الطلب',
        customer: 'العميل',
        email: 'البريد الإلكتروني',
        phone: 'الهاتف',
        shippingAddress: 'عنوان الشحن',
        items: 'المنتجات',
        sku: 'رقم',
        product: 'المنتج',
        quantity: 'الكمية',
        price: 'السعر',
        total: 'المجموع',
        subtotal: 'المجموع الفرعي',
        shipping: 'التوصيل',
        grandTotal: 'المبلغ المدفوع',
        paymentMethod: 'طريقة الدفع',
        paymentStatus: 'حالة الدفع',
        paid: 'مدفوع',
        refundPolicy: 'سياسة الإرجاع',
        refundNotice: `إرجاع خلال ١٤ يومًا للمنتجات غير المفتوحة (${daysSinceOrder} يوم منذ الطلب)`,
        refundExpired: `انتهت فترة الإرجاع (${daysSinceOrder} يومًا)`,
        contactUs: 'واتساب: 965565611563+',
        thankYou: 'شكراً لتسوقكم!'
    } : {
        title: 'Order Receipt',
        orderNumber: 'Order Number',
        orderDate: 'Order Date',
        customer: 'Customer',
        email: 'Email',
        phone: 'Phone',
        shippingAddress: 'Shipping Address',
        items: 'Items',
        sku: 'SKU',
        product: 'Product',
        quantity: 'Qty',
        price: 'Price',
        total: 'Total',
        subtotal: 'Subtotal',
        shipping: 'Delivery',
        grandTotal: 'Total Paid',
        paymentMethod: 'Payment',
        paymentStatus: 'Status',
        paid: 'Paid',
        refundPolicy: 'Return Policy',
        refundNotice: `14-day return on unopened items (${daysSinceOrder} days since order)`,
        refundExpired: `Return period expired (${daysSinceOrder} days)`,
        contactUs: 'WhatsApp: +965656115663',
        thankYou: 'Thank you for shopping with us!'
    };

    const refundBgColor = canCancel ? '#d1fae5' : '#fef3c7';
    const refundTextColor = canCancel ? '#065f46' : '#92400e';
    const refundMessage = canCancel ? texts.refundNotice : texts.refundExpired;

    const itemsHtml = order.items.map(item => {
        const productName = isArabic && item.nameAr ? item.nameAr : item.name;
        const sku = item.sku || '—';
        return `
            <tr>
                <td style="padding: 5px 3px; border-bottom: 1px solid #e6e1d6; font-size: 10px; font-family: monospace; color: #888;">${sku}</td>
                <td style="padding: 5px 3px; border-bottom: 1px solid #e6e1d6; text-align: ${align}; font-size: 12px;">${productName}</td>
                <td style="padding: 5px 3px; border-bottom: 1px solid #e6e1d6; text-align: center; font-size: 12px;">${item.quantity}</td>
                <td style="padding: 5px 3px; border-bottom: 1px solid #e6e1d6; text-align: ${oppositeAlign}; font-size: 12px;">${item.price.toFixed(3)}</td>
                <td style="padding: 5px 3px; border-bottom: 1px solid #e6e1d6; text-align: ${oppositeAlign}; font-weight: 600; font-size: 12px;">${(item.price * item.quantity).toFixed(3)} ${order.currency}</td>
            </tr>
        `;
    }).join('');

    const shippingAddress = order.shippingAddress;
    const addressText = `${shippingAddress.street}, ${shippingAddress.city}${shippingAddress.state ? ', ' + shippingAddress.state : ''}, ${shippingAddress.country}`;

    return `
<!DOCTYPE html>
<html lang="${isArabic ? 'ar' : 'en'}" dir="${dir}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${texts.title} - ${order.orderNumber}</title>
    <style>
        @page { size: A4; margin: 8mm 10mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: ${isArabic ? "'Tajawal', 'Arial', sans-serif" : "'Arial', sans-serif"}; 
            background: #fff; 
            padding: 12px;
            direction: ${dir};
            font-size: 12px;
            color: #333;
        }
        .header { 
            text-align: center; 
            border-bottom: 2px solid #D4AF37;
            padding-bottom: 8px;
            margin-bottom: 10px;
        }
        .header h1 { font-size: 22px; letter-spacing: 2px; margin-bottom: 2px; }
        .header p { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        .meta-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; }
        .meta-item .label { font-size: 9px; color: #888; text-transform: uppercase; }
        .meta-item .value { font-weight: 600; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
        .info-box { background: #fafaf8; border: 1px solid #e6e1d6; border-radius: 4px; padding: 8px; }
        .info-box .label { font-size: 9px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
        .info-box p { font-size: 11px; line-height: 1.4; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        th { background: #f5f2ec; padding: 4px 3px; text-align: ${align}; font-size: 10px; text-transform: uppercase; color: #888; }
        .totals { width: 220px; margin-${isArabic ? 'right' : 'left'}: auto; }
        .total-row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
        .total-row.grand { border-top: 2px solid #D4AF37; margin-top: 4px; padding-top: 4px; font-size: 14px; font-weight: bold; }
        .refund { background: ${refundBgColor}; color: ${refundTextColor}; padding: 6px 8px; border-radius: 4px; margin: 8px 0; border-left: 3px solid ${refundTextColor}; font-size: 10px; text-align: ${align}; }
        .footer { text-align: center; font-size: 9px; color: #888; border-top: 1px solid #e6e1d6; padding-top: 6px; margin-top: 8px; }
        @media print {
            body { padding: 0; }
            .info-grid, .info-box, .refund { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>ARTÉVA MAISON</h1>
        <p>${texts.title}</p>
    </div>
    
    <div class="meta-row">
        <div class="meta-item"><div class="label">${texts.orderNumber}</div><div class="value">${order.orderNumber}</div></div>
        <div class="meta-item"><div class="label">${texts.orderDate}</div><div class="value">${new Date(order.createdAt).toLocaleDateString(isArabic ? 'ar-KW' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div></div>
        <div class="meta-item"><div class="label">${texts.paymentMethod}</div><div class="value">${order.paymentMethod}</div></div>
        <div class="meta-item"><div class="label">${texts.paymentStatus}</div><div class="value" style="color: #16a34a; font-weight: 700;">✓ ${texts.paid}</div></div>
    </div>

    <div class="info-grid">
        <div class="info-box">
            <div class="label">${texts.customer}</div>
            <p style="font-weight: 600;">${order.user.name}</p>
            <p>${order.user.email}</p>
            <p>${order.user.phone || ''}</p>
        </div>
        <div class="info-box">
            <div class="label">${texts.shippingAddress}</div>
            <p>${addressText}</p>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th style="width: 12%;">${texts.sku}</th>
                <th style="width: 38%;">${texts.product}</th>
                <th style="text-align: center; width: 10%;">${texts.quantity}</th>
                <th style="text-align: ${oppositeAlign}; width: 18%;">${texts.price}</th>
                <th style="text-align: ${oppositeAlign}; width: 22%;">${texts.total}</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHtml}
        </tbody>
    </table>

    <div class="totals">
        <div class="total-row"><span>${texts.subtotal}</span><span>${order.subtotal.toFixed(3)} ${order.currency}</span></div>
        <div class="total-row"><span>${texts.shipping}</span><span>${order.shippingCost.toFixed(3)} ${order.currency}</span></div>
        <div class="total-row grand"><span>${texts.grandTotal}</span><span>${order.total.toFixed(3)} ${order.currency}</span></div>
    </div>

    <div class="refund">
        <strong>${texts.refundPolicy}:</strong> ${refundMessage}
    </div>

    <div class="footer">
        <p style="font-weight: 600; color: #D4AF37;">${texts.thankYou}</p>
        <p>${texts.contactUs} • www.artevamaisonkw.com</p>
    </div>
</body>
</html>
    `.trim();
}


// @desc    Get detailed revenue analytics per product per price
// @route   GET /api/admin/revenue-analytics
// @access  Private (superuser only)
const getRevenueAnalytics = asyncHandler(async (req, res) => {
    if (req.user.role !== 'superuser') {
        res.status(403);
        throw new Error('Access denied. Only superuser can access revenue analytics.');
    }

    const Order = require('../models/Order');
    const Product = require('../models/Product');

    // Get all paid orders with customer info
    const paidOrders = await Order.find({ paymentStatus: 'paid' })
        .select('items total createdAt orderNumber orderStatus user shippingAddress')
        .populate('user', 'name email phone language')
        .sort({ createdAt: -1 })
        .lean();

    // Build per-product analytics
    const productMap = {};

    paidOrders.forEach(order => {
        order.items.forEach(item => {
            const productId = item.product ? item.product.toString() : item.name;
            
            if (!productMap[productId]) {
                productMap[productId] = {
                    productId,
                    name: item.name,
                    image: item.image || null,
                    totalRevenue: 0,
                    totalQuantitySold: 0,
                    orderCount: 0,
                    pricePoints: {},
                    orders: []
                };
            }

            const p = productMap[productId];
            const revenue = item.price * item.quantity;
            p.totalRevenue += revenue;
            p.totalQuantitySold += item.quantity;
            p.orderCount++;

            // Track per price point
            const priceKey = item.price.toFixed(3);
            if (!p.pricePoints[priceKey]) {
                p.pricePoints[priceKey] = {
                    price: item.price,
                    revenue: 0,
                    quantity: 0,
                    orderCount: 0,
                    orders: []
                };
            }
            p.pricePoints[priceKey].revenue += revenue;
            p.pricePoints[priceKey].quantity += item.quantity;
            p.pricePoints[priceKey].orderCount++;
            p.pricePoints[priceKey].orders.push({
                orderId: order._id,
                orderNumber: order.orderNumber,
                date: order.createdAt,
                quantity: item.quantity,
                revenue: revenue,
                status: order.orderStatus,
                customer: order.user ? {
                    name: order.user.name,
                    email: order.user.email,
                    phone: order.user.phone || 'N/A',
                    language: order.user.language
                } : { name: 'Guest', email: 'N/A', phone: 'N/A' },
                shippingAddress: order.shippingAddress ? {
                    city: order.shippingAddress.city,
                    country: order.shippingAddress.country
                } : null
            });

            // Track order references
            p.orders.push({
                orderId: order._id,
                orderNumber: order.orderNumber,
                date: order.createdAt,
                price: item.price,
                quantity: item.quantity,
                revenue: revenue,
                status: order.orderStatus,
                customer: order.user ? {
                    name: order.user.name,
                    email: order.user.email,
                    phone: order.user.phone || 'N/A'
                } : { name: 'Guest', email: 'N/A', phone: 'N/A' }
            });
        });
    });

    // Convert to sorted array
    const products = Object.values(productMap).map(p => ({
        ...p,
        pricePoints: Object.values(p.pricePoints).sort((a, b) => b.revenue - a.revenue),
        orders: p.orders.slice(0, 100) // Limit to last 100 orders per product
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Get current product prices and discount info
    const allProducts = await Product.find({})
        .select('name price compareAtPrice discountPercentage priceHistory')
        .lean();

    const productPriceMap = {};
    allProducts.forEach(p => {
        productPriceMap[p._id.toString()] = {
            currentPrice: p.price,
            compareAtPrice: p.compareAtPrice,
            discountPercentage: p.discountPercentage,
            priceHistory: p.priceHistory || []
        };
    });

    // Summary stats
    const totalRevenue = products.reduce((sum, p) => sum + p.totalRevenue, 0);
    const totalOrders = paidOrders.length;
    const bestProduct = products[0] || null;

    // Monthly revenue trend
    const monthlyMap = {};
    paidOrders.forEach(order => {
        const d = new Date(order.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMap[key]) monthlyMap[key] = { revenue: 0, orders: 0 };
        monthlyMap[key].revenue += order.total;
        monthlyMap[key].orders++;
    });

    const monthlyTrend = Object.entries(monthlyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({ month, ...data }));

    res.json({
        success: true,
        data: {
            summary: {
                totalRevenue,
                totalOrders,
                totalProducts: products.length,
                bestProduct: bestProduct ? { name: bestProduct.name, revenue: bestProduct.totalRevenue } : null,
                averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0
            },
            products,
            productPriceMap,
            monthlyTrend
        }
    });
});

// @desc    Update product discount (set compareAtPrice)
// @route   PUT /api/admin/products/:id/discount
// @access  Private (superuser/owner/admin)
const updateProductDiscount = asyncHandler(async (req, res) => {
    const Product = require('../models/Product');
    const { discountedPrice, compareAtPrice } = req.body;
    
    const product = await Product.findById(req.params.id);
    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    // Set the compare-at price (original/strikethrough price)
    if (compareAtPrice !== undefined) {
        product.compareAtPrice = compareAtPrice;
    }
    
    // Set the new discounted price
    if (discountedPrice !== undefined) {
        product.price = discountedPrice;
    }

    await product.save();

    res.json({
        success: true,
        data: product
    });
});

// @desc    Get all orders for a specific customer (by email)
// @route   GET /api/admin/customer-orders/:email
// @access  Private (admin/superuser)
const getCustomerOrderHistory = asyncHandler(async (req, res) => {
    const email = decodeURIComponent(req.params.email);

    // Find user by email
    const user = await User.findOne({ email }).select('name email phone createdAt');
    if (!user) {
        res.status(404);
        throw new Error('Customer not found');
    }

    // Get all orders for this user
    const orders = await Order.find({ user: user._id })
        .sort({ createdAt: -1 })
        .lean();

    // Calculate lifetime stats
    const paidOrders = orders.filter(o => o.paymentStatus === 'paid');
    const lifetimeValue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const totalOrders = orders.length;
    const paidOrderCount = paidOrders.length;

    res.json({
        success: true,
        data: {
            customer: {
                name: user.name,
                email: user.email,
                phone: user.phone,
                memberSince: user.createdAt
            },
            stats: {
                totalOrders,
                paidOrders: paidOrderCount,
                lifetimeValue,
                averageOrderValue: paidOrderCount > 0 ? lifetimeValue / paidOrderCount : 0
            },
            orders: orders.map(o => ({
                _id: o._id,
                orderNumber: o.orderNumber,
                createdAt: o.createdAt,
                orderStatus: o.orderStatus,
                paymentStatus: o.paymentStatus,
                paymentMethod: o.paymentMethod,
                total: o.total,
                currency: o.currency,
                itemCount: o.items ? o.items.length : 0,
                items: o.items ? o.items.map(i => ({
                    name: i.name,
                    sku: i.sku,
                    quantity: i.quantity,
                    price: i.price
                })) : []
            }))
        }
    });
});


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
    sendOfferEmail,
    getProductViewAnalytics,
    getRevenueHistory,
    checkSuperuser,
    authenticateRevenueAccess,
    requestRevenueOTP,
    verifyRevenueOTP,
    generateReceipt,
    setRevenuePassword,
    getRevenueAnalytics,
    updateProductDiscount,
    getCustomerOrderHistory
};
