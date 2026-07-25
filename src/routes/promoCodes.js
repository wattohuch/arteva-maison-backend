const express = require('express');
const router = express.Router();
const {
    createPromoCode,
    getAllPromoCodes,
    getPromoCodeById,
    getPromoCodeStats,
    updatePromoCode,
    deletePromoCode,
    addProductsToPromo,
    removeProductFromPromo,
    validatePromoCode,
    trackPromoVisit,
    getPromoAnalytics
} = require('../controllers/promoCodeController');
const { protect, admin, optionalAuth } = require('../middleware/auth');

// Public validation endpoint (requires login)
router.post('/validate', protect, validatePromoCode);

// Visit tracking — fires on page load for anyone arriving with a code, so it
// must work for logged-out visitors. optionalAuth attaches the user when there
// is one without rejecting when there is not.
router.post('/track-visit', optionalAuth, trackPromoVisit);

// Cross-code visitor/conversion analytics. Declared before '/:id' so the
// literal path is not swallowed by the id param.
router.get('/analytics', protect, admin, getPromoAnalytics);

// Admin CRUD routes
router.route('/')
    .get(protect, admin, getAllPromoCodes)
    .post(protect, admin, createPromoCode);

router.route('/:id')
    .get(protect, admin, getPromoCodeById)
    .put(protect, admin, updatePromoCode)
    .delete(protect, admin, deletePromoCode);

// Stats/analytics for a promo code
router.get('/:id/stats', protect, admin, getPromoCodeStats);

// Product management within a promo code
router.post('/:id/products', protect, admin, addProductsToPromo);
router.delete('/:id/products/:productId', protect, admin, removeProductFromPromo);

module.exports = router;
