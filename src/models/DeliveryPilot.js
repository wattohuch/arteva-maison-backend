const mongoose = require('mongoose');

const deliveryPilotSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide pilot name'],
        trim: true
    },
    phone: {
        type: String,
        required: [true, 'Please provide phone number'],
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    },
    // Pilot availability status
    isActive: {
        type: Boolean,
        default: true
    },
    // Is currently on a delivery
    isOnDelivery: {
        type: Boolean,
        default: false
    },
    // Current GPS location (updated in real-time)
    currentLocation: {
        lat: Number,
        lng: Number,
        updatedAt: {
            type: Date,
            default: Date.now
        }
    },
    // Currently assigned order
    currentOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order'
    },
    // Statistics
    stats: {
        totalDeliveries: {
            type: Number,
            default: 0
        },
        completedDeliveries: {
            type: Number,
            default: 0
        },
        rating: {
            type: Number,
            default: 5.0,
            min: 0,
            max: 5
        }
    }
}, {
    timestamps: true
});

// Virtual for availability check
deliveryPilotSchema.virtual('isAvailable').get(function () {
    return this.isActive && !this.isOnDelivery;
});

// Method to mark as on delivery
deliveryPilotSchema.methods.startDelivery = function (orderId) {
    this.isOnDelivery = true;
    this.currentOrder = orderId;
    return this.save();
};

// Method to complete delivery
deliveryPilotSchema.methods.completeDelivery = function () {
    this.isOnDelivery = false;
    this.currentOrder = null;
    this.stats.completedDeliveries += 1;
    return this.save();
};

// Method to update location
deliveryPilotSchema.methods.updateLocation = function (lat, lng) {
    this.currentLocation = {
        lat,
        lng,
        updatedAt: new Date()
    };
    return this.save();
};

module.exports = mongoose.model('DeliveryPilot', deliveryPilotSchema);
