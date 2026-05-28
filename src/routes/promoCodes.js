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
    validatePromoCode
} = require('../controllers/promoCodeController');
const { protect, admin } = require('../middleware/auth');

// Public validation endpoint (requires login)
router.post('/validate', protect, validatePromoCode);

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
