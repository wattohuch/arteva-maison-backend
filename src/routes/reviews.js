const express = require('express');
const {
    getProductReviews,
    createProductReview,
    deleteReview
} = require('../controllers/reviewController');

const Review = require('../models/Review');

const router = express.Router({ mergeParams: true });

const { protect, admin } = require('../middleware/auth');

router
    .route('/')
    .get(getProductReviews)
    .post(protect, createProductReview);

router
    .route('/:id')
    .delete(protect, deleteReview); // Logic handles validation

module.exports = router;
