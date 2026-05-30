const mongoose = require('mongoose');

const promoCodeProductSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    discountType: {
        type: String,
        enum: ['percentage', 'fixed'],
        required: true,
        default: 'percentage'
    },
    discountValue: {
        type: Number,
        required: true,
        min: 0
    },
    maxDiscountedQuantity: {
        type: Number,
        default: null // null = unlimited
    }
});

// Ensure no duplicate products in a single promo code
promoCodeProductSchema.index({ product: 1 });

// Track per-user usage
const promoUsageSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    count: {
        type: Number,
        default: 1
    }
}, { _id: false });

const promoCodeSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true,
        default: ''
    },
    isActive: {
        type: Boolean,
        default: true
    },
    expiresAt: {
        type: Date,
        required: true
    },
    products: [promoCodeProductSchema],
    usageCount: {
        type: Number,
        default: 0
    },
    maxUsage: {
        type: Number,
        default: null // null = unlimited
    },
    perUserLimit: {
        type: Number,
        default: null // null = unlimited per user
    },
    maxQuantityPerOrder: {
        type: Number,
        default: null // null = unlimited items discounted per order
    },
    usedBy: [promoUsageSchema],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Virtual: check if promo code is expired
promoCodeSchema.virtual('isExpired').get(function () {
    return this.expiresAt && new Date() > this.expiresAt;
});

// Virtual: check if usage limit reached
promoCodeSchema.virtual('isUsageLimitReached').get(function () {
    return this.maxUsage !== null && this.usageCount >= this.maxUsage;
});

// Method: check if promo code is currently valid (basic checks)
promoCodeSchema.methods.isValid = function () {
    if (!this.isActive) return { valid: false, reason: 'Promo code is disabled' };
    if (this.isExpired) return { valid: false, reason: 'Promo code has expired' };
    if (this.isUsageLimitReached) return { valid: false, reason: 'Usage limit reached' };
    return { valid: true };
};

// Method: check if a specific user can use this promo code
promoCodeSchema.methods.canUserUse = function (userId) {
    // First check basic validity
    const basicCheck = this.isValid();
    if (!basicCheck.valid) return basicCheck;

    // Check per-user limit
    if (this.perUserLimit !== null && userId) {
        const userUsage = this.usedBy.find(u => u.user.toString() === userId.toString());
        if (userUsage && userUsage.count >= this.perUserLimit) {
            return { valid: false, reason: 'You have already used this promo code the maximum number of times' };
        }
    }

    return { valid: true };
};

// Method: record usage after successful order (call with save() after)
promoCodeSchema.methods.recordUsage = function (userId) {
    this.usageCount += 1;

    if (userId) {
        const existing = this.usedBy.find(u => u.user.toString() === userId.toString());
        if (existing) {
            existing.count += 1;
        } else {
            this.usedBy.push({ user: userId, count: 1 });
        }
    }
};

// Method: get discount for a specific product
promoCodeSchema.methods.getProductDiscount = function (productId) {
    const entry = this.products.find(p => p.product.toString() === productId.toString());
    if (!entry) return null;
    return {
        type: entry.discountType,
        value: entry.discountValue
    };
};

// Ensure virtuals are included in JSON output
promoCodeSchema.set('toJSON', { virtuals: true });
promoCodeSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('PromoCode', promoCodeSchema);
