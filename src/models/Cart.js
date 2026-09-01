const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    /**
     * Whether this line is to be gift wrapped.
     *
     * Per line rather than per order: a bag can hold one gift and one thing
     * the customer bought for themselves. No fee is stored — the price is
     * applied at order time by config/pricing, never here where a client
     * could reach it.
     */
    giftWrap: { type: Boolean, default: false }
});

const cartSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    items: [cartItemSchema],
    /**
     * Gift wrapping the customer asked for, kept on the cart rather than sent
     * with the order request.
     *
     * Checkout hands the customer to a payment gateway and gets them back on
     * a different request, so anything held only in the browser is lost in
     * between. The fee is deliberately absent: it is decided at order time by
     * config/pricing, never stored here where a client could reach it.
     */
    giftWrap: {
        enabled: { type: Boolean, default: false },
        message: { type: String, default: '', maxlength: 300 }
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Update timestamp on modification
cartSchema.pre('save', function () {
    this.updatedAt = Date.now();
});

// Virtual for calculating total
cartSchema.virtual('total').get(function () {
    return this.items.reduce((acc, item) => {
        if (item.product && item.product.price) {
            return acc + (item.product.price * item.quantity);
        }
        return acc;
    }, 0);
});

module.exports = mongoose.model('Cart', cartSchema);
