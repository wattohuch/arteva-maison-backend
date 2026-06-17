const mongoose = require('mongoose');
const crypto = require('crypto');

const orderItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    name: { type: String, required: true },
    nameAr: { type: String }, // Arabic name
    sku: { type: String }, // Product SKU / number
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
        label: { type: String, default: 'Home' },
        // Delivery coordinates for map display
        coordinates: {
            lat: Number,
            lng: Number
        }
    },
    paymentMethod: {
        type: String,
        enum: ['cod', 'knet', 'card', 'myfatoorah', 'applepay', 'deema'],
        default: 'cod'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'awaiting_payment', 'paid', 'failed', 'cancelled', 'refunded', 'payment_expired'],
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
    // Promo code tracking for revenue analytics
    promoCode: {
        code: String,
        name: String,
        promoCodeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PromoCode'
        },
        totalDiscount: {
            type: Number,
            default: 0
        },
        discounts: [{
            product: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product'
            },
            productName: String,
            discountType: {
                type: String,
                enum: ['percentage', 'fixed']
            },
            discountValue: Number,
            discountedQuantity: Number,
            discountAmount: Number
        }]
    },
    total: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'KWD'
    },
    // MyFatoorah payment fields
    myfatoorahInvoiceId: String,
    myfatoorahTransactionId: String,
    // Deema BNPL payment field (Tap Payments charge ID)
    deemaChargeId: String,
    // Legacy Stripe field (deprecated)
    stripeSessionId: String,
    notes: String,
    deliveryProof: String,  // Path to delivery proof photo
    trackingToken: {
        type: String,
        index: true
    },
    deliveredAt: Date,
    cancelledAt: Date,
    paidAt: Date,
    printedAt: Date
}, {
    timestamps: true
});

// Generate a cryptographically secure order number (8 chars, A-Z0-9)
function generateOrderNumber() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(8);
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}

// Pre-save: assign order number + tracking token + initial status
orderSchema.pre('save', async function () {
    // Generate order number if not set (uses crypto for true randomness)
    if (!this.orderNumber) {
        this.orderNumber = generateOrderNumber();
    }

    // Generate secure tracking token for shareable tracking/receipt links
    if (!this.trackingToken) {
        this.trackingToken = crypto.randomBytes(16).toString('hex');
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

/**
 * Create an order with automatic retry on duplicate orderNumber collision.
 * This is the ONLY safe way to create orders — it catches the E11000 duplicate
 * key error on orderNumber and regenerates + retries up to MAX_RETRIES times.
 * 
 * Usage: const order = await Order.createWithRetry({ user, items, ... });
 */
orderSchema.statics.createWithRetry = async function (orderData, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const order = await this.create(orderData);
            return order;
        } catch (err) {
            // E11000 = duplicate key error on the unique orderNumber index
            const isDuplicateOrderNumber = err.code === 11000 &&
                err.message && err.message.includes('orderNumber');

            if (isDuplicateOrderNumber && attempt < maxRetries) {
                console.warn(`[ORDER] ⚠️ Order number collision on attempt ${attempt}, regenerating...`);
                // The pre-save hook will generate a new orderNumber on next attempt
                // Clear any stale orderNumber so pre-save generates a fresh one
                delete orderData.orderNumber;
                continue;
            }

            // Not a duplicate key error, or we've exhausted retries — throw
            throw err;
        }
    }
};

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

// Indexes for query performance
orderSchema.index({ user: 1, createdAt: -1 });
// orderNumber already has unique index from schema definition
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ printedAt: 1, paymentStatus: 1 });

module.exports = mongoose.model('Order', orderSchema);
