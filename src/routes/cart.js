const express = require('express');
const router = express.Router();
const {
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart
} = require('../controllers/cartController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
    addToCartRules,
    updateCartItemRules,
    productIdParamRules,
} = require('../validators/cartValidators');

// All cart routes require authentication
router.use(protect);

router.get('/', getCart);
router.post('/', validate(addToCartRules), addToCart);
router.put('/:productId', validate(updateCartItemRules), updateCartItem);
router.delete('/:productId', validate(productIdParamRules), removeFromCart);
router.delete('/', clearCart);

module.exports = router;
