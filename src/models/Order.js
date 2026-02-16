const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    name: { type: String, required: true },
    image: String,
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 }
});

// Status history entry schema for tracking status changes
const statusHistorySchema = new mongoose.Schema({
    status: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    note: String,
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
});

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    orderNumber: {
        type: String,
        unique: true
    },
    items: [orderItemSchema],
    shippingAddress: {
        street: { type: String, required: true },
        city: { type: String, required: true },
        state: String,
        country: { type: String, default: 'Kuwait' },
        zipCode: String,
        phone: String,
        // Delivery coordinates for map display
        coordinates: {
            lat: Number,
            lng: Number
        }
    },
    paymentMethod: {
        type: String,
        enum: ['cod', 'knet', 'card'],
        default: 'cod'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending'
    },
    // Updated order statuses to match delivery workflow
    orderStatus: {
        type: String,
        enum: [
            'pending',        // Order Placed
            'confirmed',      // Order Confirmed
            'packed',         // Items Packed
            'processing',     // Processing
            'handed_over',    // Handed Over to Delivery Pilot
            'out_for_delivery', // Out for Delivery
            'delivered',      // Delivered
            'cancelled'       // Cancelled
        ],
        default: 'pending'
    },
    // Status history for tracking all status changes
    statusHistory: [statusHistorySchema],
    // Delivery pilot assignment
    deliveryPilot: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // Current delivery location (updated in real-time)
    deliveryLocation: {
        lat: Number,
        lng: Number,
        updatedAt: Date
    },
    subtotal: {
        type: Number,
        required: true
    },
    shippingCost: {
        type: Number,
        default: 0
    },
    discount: {
        type: Number,
        default: 0
    },
    total: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'KWD'
    },
    notes: String,
    deliveredAt: Date,
    cancelledAt: Date
}, {
    timestamps: true
});

// Generate order number before saving
orderSchema.pre('save', async function () {
    if (!this.orderNumber) {
        const count = await mongoose.model('Order').countDocuments();
        this.orderNumber = `ART-${String(count + 1).padStart(6, '0')}`;
    }

    // Add initial status to history if new order
    if (this.isNew && this.statusHistory.length === 0) {
        this.statusHistory.push({
            status: this.orderStatus,
            timestamp: new Date(),
            note: 'Order placed'
        });
    }
});

// Method to update status with history tracking
orderSchema.methods.updateStatus = function (newStatus, note = '', updatedBy = null) {
    this.orderStatus = newStatus;
    this.statusHistory.push({
        status: newStatus,
        timestamp: new Date(),
        note,
        updatedBy
    });

    if (newStatus === 'delivered') {
        this.deliveredAt = new Date();
    }
    if (newStatus === 'cancelled') {
        this.cancelledAt = new Date();
    }

    return this;
};

module.exports = mongoose.model('Order', orderSchema);
