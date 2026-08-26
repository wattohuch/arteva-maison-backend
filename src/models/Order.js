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
    quantity: { type: Number, required: true, min: 1 },
    isRefunded: { type: Boolean, default: false },
    refundAmount: { type: Number, default: 0 },
    refundedAt: Date,
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isExchanged: { type: Boolean, default: false },
    oldName: { type: String },
    oldPrice: { type: Number },
    exchangeDiff: { type: Number },
    /**
     * How many units this line has actually taken out of Product.stock.
     * Every stock mutation reconciles against this number rather than against
     * `quantity`, which is what makes edits and refunds idempotent: replaying
     * the same save can never double-deduct or double-restore.
     */
    stockHeld: { type: Number, default: 0, min: 0 }
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
    /**
     * Where the order came from. `online` is a customer checkout; `manual` is a
     * receipt an admin built in the receipt generator. The admin Orders page
     * filters on this, and revenue reports break down by it.
     */
    orderSource: {
        type: String,
        enum: ['online', 'manual'],
        default: 'online',
        index: true
    },
    // Admin who created a manual receipt (null for online orders)
    createdByAdmin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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
    refundStatus: {
        type: String,
        enum: ['None', 'Partial', 'Full'],
        default: 'None'
    },
    refundAmount: {
        type: Number,
        default: 0
    },
    refundReason: String,
    refundedAt: Date,
    refundedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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
        /**
         * Attribution trail. `visitId` links back to the PromoVisit created when
         * the shopper first landed on a promo link, so a code that drives traffic
         * but no sales is still measurable. `source` records how the code got
         * onto the order.
         */
        visitId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PromoVisit'
        },
        source: {
            type: String,
            enum: ['link', 'manual_entry', 'admin_receipt'],
            default: 'manual_entry'
        },
        // Set once the code's usageCount has been incremented for this order,
        // so payment retries and webhook replays cannot inflate usage.
        usageCounted: {
            type: Boolean,
            default: false
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
    /**
     * Which generation of stock accounting this order was written under.
     *
     *   0 (or absent) — legacy. Stock was deducted at checkout by a
     *     read-modify-write that never recorded how much each line took, so
     *     `items.stockHeld` on these orders is a schema default of 0 and says
     *     nothing about reality. Refunding one restored nothing, because the
     *     reconcile computed a delta of 0 - 0. That is the "refund does not
     *     restore stock" bug.
     *
     *   1 — every line carries a truthful `stockHeld`, so refunds, edits and
     *     cancellations reconcile against it and are idempotent.
     *
     * Orders created from now on are stamped 1 at creation. Legacy orders are
     * upgraded in place the first time stock is touched (see
     * stockService.currentHoldings) and by scripts/backfill-stock-ledger.js,
     * so neither a migration run nor its absence can leave the two paths
     * disagreeing.
     */
    stockLedgerVersion: {
        type: Number,
        default: 0,
        index: true
    },
    notes: String,
    deliveryProof: String,  // Path to delivery proof photo
    trackingToken: {
        type: String,
        index: true
    },
    deliveredAt: Date,
    cancelledAt: Date,
    paidAt: Date,
    printedAt: Date,
    /**
     * How many copies the print agent should run off.
     *
     * Set per order rather than as one setting on the Pi, because the answer
     * differs by source: a receipt written at the counter needs two — one for
     * the customer, one the shop keeps — while an online order that will be
     * packed and shipped needs one.
     *
     * The agent clamps this and falls back to its own PRINT_COPIES for orders
     * created before this field existed, so nothing already in the queue
     * changes behaviour.
     */
    printCopies: { type: Number, default: 1, min: 1, max: 5 }
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
// Admin Orders list: newest-first within a source filter
orderSchema.index({ orderSource: 1, createdAt: -1 });
// Revenue aggregation scans paid orders inside a date window
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
// Promo code analytics (orders attributed to a code, newest first)
orderSchema.index({ 'promoCode.promoCodeId': 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
