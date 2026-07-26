const { body, param } = require('express-validator');

/**
 * Cart input rules.
 *
 * `quantity` arrives straight off the request and is added to the stored
 * quantity with `+=`. Untyped, that had two ways to go wrong: a string `"3"`
 * concatenates rather than adds (1 += "3" gives "13", which Mongoose then
 * happily casts to 13 units), and a negative number passes the
 * `product.stock < quantity` stock check because it is always smaller. Forcing
 * a positive integer here closes both without the controller changing.
 */

const MAX_QUANTITY = 999;

const addToCartRules = [
    body('productId').isMongoId().withMessage('A valid product is required'),
    body('quantity')
        .optional({ values: 'falsy' })
        .isInt({ min: 1, max: MAX_QUANTITY }).withMessage(`Quantity must be between 1 and ${MAX_QUANTITY}`)
        .toInt(),
];

const updateCartItemRules = [
    param('productId').isMongoId().withMessage('A valid product is required'),
    // Minimum 1, matching the controller — removal is DELETE /cart/:productId,
    // not a zero quantity.
    body('quantity')
        .isInt({ min: 1, max: MAX_QUANTITY }).withMessage(`Quantity must be between 1 and ${MAX_QUANTITY}`)
        .toInt(),
];

const productIdParamRules = [
    param('productId').isMongoId().withMessage('A valid product is required'),
];

module.exports = { addToCartRules, updateCartItemRules, productIdParamRules, MAX_QUANTITY };
