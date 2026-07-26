const { body, param } = require('express-validator');

/**
 * Delivery workflow input rules.
 *
 * The status list is duplicated from the Order schema deliberately: this is the
 * set the delivery endpoint accepts, and the controller already checks against
 * its own copy. Keeping the check here as well means a bad value is rejected
 * before any document is loaded.
 */
const DELIVERY_STATUSES = [
    'pending', 'confirmed', 'packed', 'processing',
    'handed_over', 'out_for_delivery', 'delivered', 'cancelled',
];

const orderIdParam = [
    param('orderId').isMongoId().withMessage('A valid order id is required'),
];

const orderNumberParam = [
    param('orderNumber')
        .trim()
        .notEmpty().withMessage('An order number is required')
        .isLength({ max: 40 }).withMessage('Order number is too long'),
];

const updateStatusRules = [
    ...orderIdParam,
    body('status')
        .isIn(DELIVERY_STATUSES)
        .withMessage(`Status must be one of: ${DELIVERY_STATUSES.join(', ')}`),
    body('note')
        .optional({ values: 'falsy' })
        .isString().withMessage('Note must be text')
        .isLength({ max: 500 }).withMessage('Note is too long'),
];

const updateLocationRules = [
    ...orderIdParam,
    // Bounded to real coordinates. The previous check was `if (!lat || !lng)`,
    // which also rejected a legitimate 0 and accepted any non-zero value,
    // including strings and objects.
    body('lat')
        .isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90')
        .toFloat(),
    body('lng')
        .isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180')
        .toFloat(),
    body('pilotId')
        .optional({ values: 'falsy' })
        .isMongoId().withMessage('pilotId must be a valid id'),
];

module.exports = {
    DELIVERY_STATUSES,
    orderIdParam,
    orderNumberParam,
    updateStatusRules,
    updateLocationRules,
};
