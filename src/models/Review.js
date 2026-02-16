const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        required: true
    },
    images: [{
        type: String // URL to image
    }],
    isVerifiedPurchase: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Prevent user from reviewing the same product twice
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

// Static method to calculate average rating
reviewSchema.statics.calcAverageRatings = async function (productId) {
    const stats = await this.aggregate([
        {
            $match: { product: productId }
        },
        {
            $group: {
                _id: '$product',
                nRating: { $sum: 1 },
                avgRating: { $avg: '$rating' }
            }
        }
    ]);

    try {
        if (stats.length > 0) {
            await this.model('Product').findByIdAndUpdate(productId, {
                averageRating: stats[0].avgRating,
                reviewCount: stats[0].nRating
            });
        } else {
            await this.model('Product').findByIdAndUpdate(productId, {
                averageRating: 0,
                reviewCount: 0
            });
        }
    } catch (err) {
        console.error(err);
    }
};

// Call getAverageCost after save
reviewSchema.post('save', function () {
    this.constructor.calcAverageRatings(this.product);
});

// Call getAverageCost before remove
reviewSchema.post('remove', function () {
    this.constructor.calcAverageRatings(this.product);
});

module.exports = mongoose.model('Review', reviewSchema);
