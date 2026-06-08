const Order = require('../models/Order');
const User = require('../models/User');
const { sendOrderStatusUpdate, sendEmail } = require('../services/emailService');
const { emitOrderStatusUpdate, getIO } = require('../socketHandler');
const whatsappService = require('../services/whatsappService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for delivery proof photos
const proofStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '../../assets/images/delivery-proofs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const orderId = req.params.id || 'unknown';
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `proof_${orderId}_${Date.now()}${ext}`);
    }
});
const uploadProof = multer({ storage: proofStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// @desc    Get orders assigned to logged in driver
// @route   GET /api/driver/orders
// @access  Private/Driver
exports.getAssignedOrders = async (req, res) => {
    try {
        const filter = req.user.role === 'admin'
            ? { deliveryPilot: { $ne: null } }
            : { deliveryPilot: req.user._id };

        const orders = await Order.find(filter)
            .populate('user', 'name email phone')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: orders.length,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
};

// @desc    Update order status (by driver)
// @route   PUT /api/driver/orders/:id/status
// @access  Private/Driver
exports.updateDeliveryStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const allowedStatuses = ['out_for_delivery', 'delivered'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status update for driver'
            });
        }

        let order;
        if (req.user.role === 'admin') {
            order = await Order.findById(req.params.id);
        } else {
            order = await Order.findOne({
                _id: req.params.id,
                deliveryPilot: req.user._id
            });
        }

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or not assigned to you'
            });
        }

        const oldStatus = order.orderStatus;
        order.updateStatus(status, `Status updated by driver`, req.user._id);

        if (status === 'delivered') {
            order.deliveredAt = Date.now();
        }

        await order.save();

        // Emit real-time update to customer tracking + admin dashboard
        emitOrderStatusUpdate(order.orderNumber, {
            status: order.orderStatus,
            statusHistory: order.statusHistory,
            orderId: order._id.toString(),
            userId: order.user ? order.user.toString() : null
        });

        // Emit to the driver's own room for instant UI refresh
        try {
            const io = getIO();
            const pilotId = order.deliveryPilot ? order.deliveryPilot.toString() : null;
            if (pilotId) {
                io.to(`pilot_${pilotId}`).emit('driver_order_update', {
                    orderId: order._id.toString(),
                    orderNumber: order.orderNumber,
                    status: order.orderStatus
                });
            }
        } catch (e) { /* socket not critical */ }

        // Send email notification when driver starts delivery
        if (status === 'out_for_delivery' && oldStatus !== 'out_for_delivery') {
            try {
                await order.populate('user', 'name email');
                if (order.user && order.user.email) {
                    await sendOrderStatusUpdate(order, order.user, 'out_for_delivery');
                    console.log(`📧 Email notification sent to customer for order ${order.orderNumber}`);
                }
            } catch (emailError) {
                console.error('Error sending email notification:', emailError);
            }
        }

        res.status(200).json({
            success: true,
            data: order
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
};

// @desc    Upload delivery proof photo + mark delivered + email to customer
// @route   POST /api/driver/orders/:id/proof
// @access  Private/Driver
exports.uploadDeliveryProof = [
    uploadProof.single('photo'),
    async (req, res) => {
        try {
            let order;
            if (req.user.role === 'admin') {
                order = await Order.findById(req.params.id).populate('user', 'name email');
            } else {
                order = await Order.findOne({
                    _id: req.params.id,
                    deliveryPilot: req.user._id
                }).populate('user', 'name email');
            }

            if (!order) {
                return res.status(404).json({ success: false, message: 'Order not found' });
            }

            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No photo uploaded' });
            }

            const proofUrl = `/assets/images/delivery-proofs/${req.file.filename}`;

            // Save proof URL to order and mark delivered
            order.deliveryProof = proofUrl;
            order.deliveredAt = Date.now();
            order.updateStatus('delivered', `Delivered with photo proof by driver`, req.user._id);
            await order.save();

            // Emit real-time update to customer + admin
            emitOrderStatusUpdate(order.orderNumber, {
                status: 'delivered',
                statusHistory: order.statusHistory,
                orderId: order._id.toString(),
                userId: order.user ? order.user._id.toString() : null
            });

            // Emit to driver's own room
            try {
                const io = getIO();
                const pilotId = order.deliveryPilot ? order.deliveryPilot.toString() : null;
                if (pilotId) {
                    io.to(`pilot_${pilotId}`).emit('driver_order_update', {
                        orderId: order._id.toString(),
                        orderNumber: order.orderNumber,
                        status: 'delivered'
                    });
                }
            } catch (e) { /* socket not critical */ }

            // Email delivery proof photo to BOTH customer and driver
            // Read file from disk and embed as base64 to avoid:
            //  1. Render ephemeral filesystem (files lost on redeploy → 404)
            //  2. Email clients blocking external images
            let proofBase64DataUri = '';
            try {
                const proofFilePath = path.join(__dirname, '../../assets/images/delivery-proofs', req.file.filename);
                const proofBuffer = fs.readFileSync(proofFilePath);
                const mimeType = req.file.mimetype || 'image/jpeg';
                proofBase64DataUri = `data:${mimeType};base64,${proofBuffer.toString('base64')}`;
                console.log(`📸 Proof photo converted to base64 (${Math.round(proofBuffer.length / 1024)}KB)`);
            } catch (readErr) {
                console.error('Failed to read proof file for email embedding:', readErr.message);
                // Fallback to external URL if file read fails
                const backendUrl = process.env.RENDER_EXTERNAL_URL || 'https://arteva-maison-backend-gy1x.onrender.com';
                proofBase64DataUri = `${backendUrl}${proofUrl}`;
            }

            const proofEmailHtml = (recipientName, isDriver) => `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #faf8f5;">
                    <div style="background: linear-gradient(135deg, #1a1a1a, #2a2a2a); padding: 30px; text-align: center;">
                        <h1 style="color: #c9a962; font-family: Georgia, serif; margin: 0; font-size: 24px; letter-spacing: 2px;">ARTÉVA</h1>
                        <p style="color: #999; font-size: 11px; letter-spacing: 3px; margin: 4px 0 0;">MAISON</p>
                    </div>
                    <div style="padding: 30px; background: #fff;">
                        <h2 style="color: #1a1a1a; margin: 0 0 10px;">${isDriver ? 'Delivery Completed! 🎉' : 'Your Order Has Been Delivered! ✅'}</h2>
                        <p style="color: #666; font-size: 15px; line-height: 1.6;">
                            Dear ${recipientName},<br><br>
                            ${isDriver 
                                ? `You have successfully delivered order <strong style="color: #c9a962;">${order.orderNumber}</strong>. Here is your proof photo for reference:`
                                : `Your order <strong style="color: #c9a962;">${order.orderNumber}</strong> has been successfully delivered. Below is a photo confirmation from our delivery team:`
                            }
                        </p>
                        <div style="text-align: center; margin: 24px 0;">
                            <img src="${proofBase64DataUri}" alt="Delivery proof" style="max-width: 100%; border-radius: 12px; border: 1px solid #eee; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
                        </div>
                        <p style="color: #999; font-size: 13px; text-align: center;">
                            ${isDriver ? 'This photo has also been sent to the customer.' : 'Thank you for shopping with ARTÉVA Maison!'}
                        </p>
                    </div>
                    <div style="background: #1a1a1a; padding: 20px; text-align: center;">
                        <p style="color: #666; font-size: 11px; margin: 0;">© 2026 ARTÉVA Maison. All rights reserved.</p>
                    </div>
                </div>
            `;

            // Send to customer
            if (order.user && order.user.email) {
                try {
                    await sendEmail({
                        to: order.user.email,
                        subject: `Your Order ${order.orderNumber} Has Been Delivered! 📦 | ARTÉVA Maison`,
                        html: proofEmailHtml(order.user.name || 'Valued Customer', false)
                    });
                    console.log(`📧 Delivery proof emailed to customer: ${order.user.email}`);
                } catch (emailErr) {
                    console.error('Failed to email customer:', emailErr.message);
                }
            }

            // Send to driver
            if (req.user && req.user.email) {
                try {
                    await sendEmail({
                        to: req.user.email,
                        subject: `Delivery Proof - ${order.orderNumber} | ARTÉVA Maison`,
                        html: proofEmailHtml(req.user.name || 'Driver', true)
                    });
                    console.log(`📧 Delivery proof emailed to driver: ${req.user.email}`);
                } catch (emailErr) {
                    console.error('Failed to email driver:', emailErr.message);
                }
            }

            // WhatsApp Notification to Customer
            if (order.user || order.shippingAddress) {
                try {
                    await whatsappService.notifyCustomerDelivery(order, order.user || {}, proofUrl);
                } catch (waErr) {
                    console.error('Failed to send WhatsApp to customer:', waErr.message);
                }
            }

            res.status(200).json({
                success: true,
                message: 'Delivery proof uploaded and customer notified',
                proofUrl: proofUrl
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Server Error',
                error: error.message
            });
        }
    }
];
