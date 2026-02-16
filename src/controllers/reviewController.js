const Review = require('../models/Review');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/error');

// @desc    Get reviews for a product
// @route   GET /api/products/:productId/reviews
// @access  Public
const getProductReviews = asyncHandler(async (req, res) => {
    const reviews = await Review.find({ product: req.params.productId })
        .populate('user', 'name')
        .sort({ createdAt: -1 });

    res.json({
        success: true,
        count: reviews.length,
        data: reviews
    });
});

// @desc    Create new review
// @route   POST /api/products/:productId/reviews
// @access  Private
const createProductReview = asyncHandler(async (req, res) => {
    const { rating, comment } = req.body;
    const product = await Product.findById(req.params.productId);

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    // Check if user already reviewed
    const alreadyReviewed = await Review.findOne({
        user: req.user._id,
        product: req.params.productId
    });

    if (alreadyReviewed) {
        res.status(400);
        throw new Error('Product already reviewed');
    }

    const review = await Review.create({
        user: req.user._id,
        product: req.params.productId,
        rating: Number(rating),
        comment,
        isVerifiedPurchase: true // Ideally check if user ordered this product
    });

    res.status(201).json({
        success: true,
        data: review
    });
});

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private
const deleteReview = asyncHandler(async (req, res) => {
    const review = await Review.findById(req.params.id);

    if (!review) {
        res.status(404);
        throw new Error('Review not found');
    }

    // Check ownership or admin
    if (review.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        res.status(401);
        throw new Error('Not authorized to delete this review');
    }

    await review.deleteOne(); // Trigger post-remove hook

    res.json({
        success: true,
        data: {}
    });
});

module.exports = {
    getProductReviews,
    createProductReview,
    deleteReview
};
