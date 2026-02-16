const Order = require('../models/Order');
const DeliveryPilot = require('../models/DeliveryPilot');
const { asyncHandler } = require('../middleware/error');
const { emitOrderStatusUpdate, emitDeliveryLocationUpdate, emitPilotAssigned } = require('../socketHandler');

// @desc    Get all delivery pilots
// @route   GET /api/delivery/pilots
// @access  Private/Admin
const getAllPilots = asyncHandler(async (req, res) => {
    const { active } = req.query;

    let filter = {};
    if (active !== undefined) {
        filter.isActive = active === 'true';
    }

    const pilots = await DeliveryPilot.find(filter)
        .populate('currentOrder', 'orderNumber orderStatus')
        .sort({ createdAt: -1 });

    res.json({
        success: true,
        count: pilots.length,
        data: pilots
    });
});

// @desc    Get single delivery pilot
// @route   GET /api/delivery/pilots/:id
// @access  Private/Admin
const getPilot = asyncHandler(async (req, res) => {
    const pilot = await DeliveryPilot.findById(req.params.id)
        .populate('currentOrder');

    if (!pilot) {
        res.status(404);
        throw new Error('Delivery pilot not found');
    }

    res.json({
        success: true,
        data: pilot
    });
});

// @desc    Create delivery pilot
// @route   POST /api/delivery/pilots
// @access  Private/Admin
const createPilot = asyncHandler(async (req, res) => {
    const { name, phone, email } = req.body;

    const pilot = await DeliveryPilot.create({
        name,
        phone,
        email
    });

    res.status(201).json({
        success: true,
        data: pilot
    });
});

// @desc    Update delivery pilot
// @route   PUT /api/delivery/pilots/:id
// @access  Private/Admin
const updatePilot = asyncHandler(async (req, res) => {
    const { name, phone, email, isActive } = req.body;

    const pilot = await DeliveryPilot.findById(req.params.id);

    if (!pilot) {
        res.status(404);
        throw new Error('Delivery pilot not found');
    }

    if (name) pilot.name = name;
    if (phone) pilot.phone = phone;
    if (email) pilot.email = email;
    if (isActive !== undefined) pilot.isActive = isActive;

    await pilot.save();

    res.json({
        success: true,
        data: pilot
    });
});

// @desc    Assign delivery pilot to order
// @route   POST /api/delivery/assign/:orderId
// @access  Private/Admin
const assignPilotToOrder = asyncHandler(async (req, res) => {
    const { pilotId } = req.body;
    const { orderId } = req.params;

    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Find the pilot
    const pilot = await DeliveryPilot.findById(pilotId);
    if (!pilot) {
        res.status(404);
        throw new Error('Delivery pilot not found');
    }

    // Check if pilot is available
    if (!pilot.isActive) {
        res.status(400);
        throw new Error('Delivery pilot is not active');
    }

    if (pilot.isOnDelivery) {
        res.status(400);
        throw new Error('Delivery pilot is already on another delivery');
    }

    // Assign pilot to order
    order.deliveryPilot = pilot._id;
    order.updateStatus('handed_over', `Assigned to delivery pilot: ${pilot.name}`, req.user?._id);
    await order.save();

    // Update pilot status
    await pilot.startDelivery(order._id);

    // Emit real-time updates
    emitOrderStatusUpdate(order.orderNumber, {
        status: order.orderStatus,
        statusHistory: order.statusHistory
    });

    emitPilotAssigned(order.orderNumber, {
        name: pilot.name,
        phone: pilot.phone
    });

    res.json({
        success: true,
        message: 'Delivery pilot assigned successfully',
        data: {
            order: {
                _id: order._id,
                orderNumber: order.orderNumber,
                status: order.orderStatus
            },
            pilot: {
                _id: pilot._id,
                name: pilot.name,
                phone: pilot.phone
            }
        }
    });
});

// @desc    Update delivery pilot location
// @route   PUT /api/delivery/location/:orderId
// @access  Private (Delivery Pilot)
const updateDeliveryLocation = asyncHandler(async (req, res) => {
    const { lat, lng, pilotId } = req.body;
    const { orderId } = req.params;

    if (!lat || !lng) {
        res.status(400);
        throw new Error('Latitude and longitude are required');
    }

    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Update order's delivery location
    order.deliveryLocation = {
        lat,
        lng,
        updatedAt: new Date()
    };
    await order.save();

    // Update pilot's current location if pilotId provided
    if (pilotId) {
        const pilot = await DeliveryPilot.findById(pilotId);
        if (pilot) {
            await pilot.updateLocation(lat, lng);
        }
    }

    // Emit real-time location update
    emitDeliveryLocationUpdate(order.orderNumber, { lat, lng });

    res.json({
        success: true,
        message: 'Location updated',
        data: {
            lat,
            lng,
            timestamp: new Date().toISOString()
        }
    });
});

// @desc    Get order tracking info (public with order number)
// @route   GET /api/delivery/track/:orderNumber
// @access  Public
const getOrderTracking = asyncHandler(async (req, res) => {
    const { orderNumber } = req.params;

    const order = await Order.findOne({ orderNumber })
        .populate('deliveryPilot', 'name phone currentLocation')
        .select('orderNumber orderStatus statusHistory shippingAddress deliveryLocation deliveryPilot createdAt');

    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    res.json({
        success: true,
        data: {
            orderNumber: order.orderNumber,
            status: order.orderStatus,
            statusHistory: order.statusHistory,
            deliveryLocation: order.deliveryLocation,
            deliveryPilot: order.deliveryPilot ? {
                name: order.deliveryPilot.name,
                phone: order.deliveryPilot.phone,
                location: order.deliveryPilot.currentLocation
            } : null,
            shippingAddress: {
                city: order.shippingAddress?.city,
                coordinates: order.shippingAddress?.coordinates
            },
            createdAt: order.createdAt
        }
    });
});

// @desc    Update order status (with real-time notification)
// @route   PUT /api/delivery/status/:orderId
// @access  Private/Admin or Delivery Pilot
const updateDeliveryStatus = asyncHandler(async (req, res) => {
    const { status, note } = req.body;
    const { orderId } = req.params;

    const validStatuses = ['pending', 'confirmed', 'packed', 'processing', 'handed_over', 'out_for_delivery', 'delivered', 'cancelled'];

    if (!validStatuses.includes(status)) {
        res.status(400);
        throw new Error(`Invalid status. Valid statuses are: ${validStatuses.join(', ')}`);
    }

    const order = await Order.findById(orderId).populate('deliveryPilot');
    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }

    // Update status using the model method
    order.updateStatus(status, note || '', req.user?._id);

    // Handle delivery completion
    if (status === 'delivered') {
        // Mark COD as paid on delivery
        if (order.paymentMethod === 'cod') {
            order.paymentStatus = 'paid';
        }

        // Free up the delivery pilot
        if (order.deliveryPilot) {
            await order.deliveryPilot.completeDelivery();
        }
    }

    await order.save();

    // Emit real-time status update
    emitOrderStatusUpdate(order.orderNumber, {
        status: order.orderStatus,
        statusHistory: order.statusHistory
    });

    res.json({
        success: true,
        data: {
            orderNumber: order.orderNumber,
            status: order.orderStatus,
            statusHistory: order.statusHistory
        }
    });
});

// @desc    Get available pilots
// @route   GET /api/delivery/pilots/available
// @access  Private/Admin
const getAvailablePilots = asyncHandler(async (req, res) => {
    const pilots = await DeliveryPilot.find({
        isActive: true,
        isOnDelivery: false
    }).select('name phone stats.rating stats.completedDeliveries');

    res.json({
        success: true,
        count: pilots.length,
        data: pilots
    });
});

module.exports = {
    getAllPilots,
    getPilot,
    createPilot,
    updatePilot,
    assignPilotToOrder,
    updateDeliveryLocation,
    getOrderTracking,
    updateDeliveryStatus,
    getAvailablePilots
};
