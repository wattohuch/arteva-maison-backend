/**
 * Socket.IO Handler for Real-time Order Tracking
 * Manages rooms for orders and broadcasts status/location updates
 */

let io = null;

/**
 * Initialize Socket.IO with the HTTP server
 * @param {Object} httpServer - The HTTP server instance
 * @param {Object} corsOptions - CORS configuration
 */
function initializeSocket(httpServer, corsOptions) {
    const { Server } = require('socket.io');

    io = new Server(httpServer, {
        cors: corsOptions,
        pingTimeout: 60000,
        pingInterval: 25000
    });

    io.on('connection', (socket) => {
        console.log(`🔌 Client connected: ${socket.id}`);

        // Join order tracking room
        socket.on('join_order_room', (orderNumber) => {
            if (orderNumber) {
                socket.join(`order_${orderNumber}`);
                console.log(`📦 Socket ${socket.id} joined room: order_${orderNumber}`);
            }
        });

        // Leave order tracking room
        socket.on('leave_order_room', (orderNumber) => {
            if (orderNumber) {
                socket.leave(`order_${orderNumber}`);
                console.log(`📦 Socket ${socket.id} left room: order_${orderNumber}`);
            }
        });

        // Join admin room (for real-time admin notifications)
        socket.on('join_admin_room', () => {
            socket.join('admin_room');
            console.log(`🛡️ Socket ${socket.id} joined admin room`);
        });

        // Join pilot tracking room (for admin dashboard)
        socket.on('join_pilot_room', (pilotId) => {
            if (pilotId) {
                socket.join(`pilot_${pilotId}`);
                console.log(`🚀 Socket ${socket.id} joined pilot room: pilot_${pilotId}`);
            }
        });

        // Leave pilot tracking room
        socket.on('leave_pilot_room', (pilotId) => {
            if (pilotId) {
                socket.leave(`pilot_${pilotId}`);
                console.log(`🚀 Socket ${socket.id} left pilot room: pilot_${pilotId}`);
            }
        });

        // Delivery pilot location update
        socket.on('pilot_location_update', (data) => {
            const { orderNumber, lat, lng, pilotId } = data;

            // Broadcast to order room
            if (orderNumber) {
                io.to(`order_${orderNumber}`).emit('delivery_location_update', {
                    lat,
                    lng,
                    timestamp: new Date().toISOString()
                });
            }

            // Broadcast to pilot room (for admin)
            if (pilotId) {
                io.to(`pilot_${pilotId}`).emit('pilot_location', {
                    lat,
                    lng,
                    timestamp: new Date().toISOString()
                });
            }
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Client disconnected: ${socket.id}`);
        });
    });

    console.log('🔌 Socket.IO initialized');
    return io;
}

/**
 * Get the Socket.IO instance
 */
function getIO() {
    if (!io) {
        throw new Error('Socket.IO has not been initialized');
    }
    return io;
}

/**
 * Emit order status update to the order's room
 * @param {string} orderNumber - The order number
 * @param {Object} statusData - Status update data
 */
function emitOrderStatusUpdate(orderNumber, statusData) {
    if (io && orderNumber) {
        const updateData = {
            orderNumber,
            status: statusData.status,
            statusHistory: statusData.statusHistory,
            timestamp: new Date().toISOString()
        };
        
        // Emit to order room (for customers tracking)
        io.to(`order_${orderNumber}`).emit('order_status_update', updateData);
        
        // Also emit to admin room (for admin dashboard)
        io.to('admin_room').emit('admin_order_status_update', {
            ...updateData,
            orderId: statusData.orderId // Include order ID for admin to update specific row
        });
        
        console.log(`📨 Emitted status update for order ${orderNumber}: ${statusData.status}`);
    }
}

/**
 * Emit delivery location update to the order's room
 * @param {string} orderNumber - The order number
 * @param {Object} locationData - Location data with lat, lng
 */
function emitDeliveryLocationUpdate(orderNumber, locationData) {
    if (io && orderNumber) {
        io.to(`order_${orderNumber}`).emit('delivery_location_update', {
            orderNumber,
            lat: locationData.lat,
            lng: locationData.lng,
            timestamp: new Date().toISOString()
        });
        console.log(`📍 Emitted location update for order ${orderNumber}`);
    }
}

/**
 * Emit pilot assignment notification
 * @param {string} orderNumber - The order number
 * @param {Object} pilotData - Delivery pilot info
 */
function emitPilotAssigned(orderNumber, pilotData) {
    if (io && orderNumber) {
        io.to(`order_${orderNumber}`).emit('pilot_assigned', {
            orderNumber,
            pilot: {
                name: pilotData.name,
                phone: pilotData.phone
            },
            timestamp: new Date().toISOString()
        });
        console.log(`🚀 Emitted pilot assigned for order ${orderNumber}`);
    }
}

/**
 * Emit new order notification to admin dashboard
 * @param {Object} orderData - New order data
 */
function emitNewOrder(orderData) {
    if (io) {
        io.to('admin_room').emit('new_order', {
            orderNumber: orderData.orderNumber,
            total: orderData.total,
            customer: orderData.user?.name || 'Guest',
            timestamp: new Date().toISOString()
        });
        console.log(`🆕 Emitted new order notification: ${orderData.orderNumber}`);
    }
}

module.exports = {
    initializeSocket,
    getIO,
    emitOrderStatusUpdate,
    emitDeliveryLocationUpdate,
    emitPilotAssigned,
    emitNewOrder
};
