const express = require('express');
const router = express.Router();
const {
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    setGiftWrap,
    replaceCart
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

/* Literal paths first.
 *
 * Express matches in registration order, so with PUT /:productId declared
 * above it, PUT /cart/gift-wrap was read as an update to a product called
 * "gift-wrap" and rejected by isMongoId with 400 "A valid product is
 * required". The endpoint could never be reached, so no wrapping choice ever
 * reached the server: the storefront rolled the failed request back and the
 * tick appeared to undo itself.
 *
 * Gift wrapping travels with the cart so it survives the trip to the payment
 * gateway and back. Replacing the bag wholesale is how checkout syncs it
 * without destroying that choice on the way. */
router.put('/gift-wrap', setGiftWrap);
router.put('/', replaceCart);

router.put('/:productId', validate(updateCartItemRules), updateCartItem);
router.delete('/:productId', validate(productIdParamRules), removeFromCart);
router.delete('/', clearCart);

module.exports = router;
