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
    const { name, nameAr, description, descriptionAr, price, category, stock, sku, isFeatured, isNewArrival, isComingSoon } = req.body;

    // Parse boolean values consistently
    const isFeaturedValue = parseBoolean(isFeatured);
    const isNewArrivalValue = parseBoolean(isNewArrival);
    const isComingSoonValue = parseBoolean(isComingSoon);

    console.log(`[ADMIN CREATE] New product "${name}" by ${req.user.email}`);
    console.log(`[ADMIN CREATE] Boolean flags:`, {
        isFeatured: isFeaturedValue,
        isNewArrival: isNewArrivalValue,
        isComingSoon: isComingSoonValue
    });

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

    const { name, nameAr, description, descriptionAr, price, category, stock, sku, isFeatured, isNewArrival, isComingSoon, imagesToDelete, primaryImageUrl } = req.body;

    // Parse boolean values consistently
    const isFeaturedValue = parseBoolean(isFeatured);
    const isNewArrivalValue = parseBoolean(isNewArrival);
    const isComingSoonValue = parseBoolean(isComingSoon);

    // Log admin action for debugging and audit trail
    console.log(`[ADMIN UPDATE] Product ${product._id} (${product.name}) updated by ${req.user.email}`);
    console.log(`[ADMIN UPDATE] Boolean flags:`, {
        isFeatured: isFeaturedValue,
        isNewArrival: isNewArrivalValue,
        isComingSoon: isComingSoonValue
    });

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

    // Save to database - THIS IS THE PERMANENT SAVE
    const updatedProduct = await product.save();

    console.log(`[ADMIN UPDATE] ✅ Product saved to database successfully`);
    console.log(`[ADMIN UPDATE] Final values:`, {
        isFeatured: updatedProduct.isFeatured,
        isNewArrival: updatedProduct.isNewArrival,
        isComingSoon: updatedProduct.isComingSoon
    });

    res.json({
        success: true,
        data: updatedProduct,
        message: 'Product updated successfully and saved to database',
        changes: {
            isFeatured: isFeaturedValue,
            isNewArrival: isNewArrivalValue,
            isComingSoon: isComingSoonValue
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
        orderId: order._id.toString(),
        userId: order.user ? order.user.toString() : null
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
    // Only owner can assign owner role
    if (role === 'owner' && req.user.role !== 'owner') {
        res.status(403);
        throw new Error('Only owners can assign owner role');
    }

    // Admin cannot change owner's role
    if (user.role === 'owner' && req.user.role !== 'owner') {
        res.status(403);
        throw new Error('Cannot change owner role');
    }

    // Admin can only assign admin or driver roles
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
