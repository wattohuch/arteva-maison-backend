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
    }
});

const cartSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    items: [cartItemSchema],
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
