const Order = require('../models/Order');
const User = require('../models/User');
const { sendOrderStatusUpdate } = require('../services/emailService');
const { emitOrderStatusUpdate } = require('../socketHandler');

// @desc    Get orders assigned to logged in driver
// @route   GET /api/driver/orders
// @access  Private/Driver
exports.getAssignedOrders = async (req, res) => {
    try {
        // Admin sees all orders with a driver assigned; driver sees only their own
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

        // Allowed status transitions for drivers
        const allowedStatuses = ['out_for_delivery', 'delivered'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status update for driver'
            });
        }

        // Admin can update any order; driver can only update their assigned orders
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
        order.orderStatus = status;
        if (status === 'delivered') {
            order.isDelivered = true;
            order.deliveredAt = Date.now();
        }

        // Update status history
        order.updateStatus(status, `Status updated by driver`, req.user._id);

        await order.save();

        // Emit real-time update (include orderId for admin dashboard)
        emitOrderStatusUpdate(order.orderNumber, {
            status: order.orderStatus,
            statusHistory: order.statusHistory,
            orderId: order._id.toString()
        });

        // Send email notification when driver starts delivery
        if (status === 'out_for_delivery' && oldStatus !== 'out_for_delivery') {
            try {
                // Populate user to get email
                await order.populate('user', 'name email');
                if (order.user && order.user.email) {
                    await sendOrderStatusUpdate(order, order.user, 'out_for_delivery');
                    console.log(`📧 Email notification sent to customer for order ${order.orderNumber}`);
                }
            } catch (emailError) {
                console.error('Error sending email notification:', emailError);
                // Don't fail the request if email fails
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
