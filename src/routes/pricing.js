const express = require('express');
const router = express.Router();
const { giftWrapFee } = require('../config/pricing');

/**
 * @desc    Prices the storefront needs to display but must never decide
 * @route   GET /api/pricing
 * @access  Public
 *
 * Quoting these lets every screen show one figure that comes from one place.
 * The gift wrapping fee used to be written as `|| 3` on the product page, at
 * checkout and on the admin receipt — three copies of a number the server
 * owns, which all showed the wrong price the moment GIFT_WRAP_FEE changed.
 *
 * Public because a signed-out shopper sees the price too, and reads it before
 * there is a cart to quote it alongside. Nothing here is a secret: it is the
 * same number printed on the product page. Displaying it is all a client may
 * do with it — every order is still priced server-side from the server's own
 * copy of the bag.
 */
router.get('/', (req, res) => {
    res.json({
        success: true,
        data: { giftWrapFee: giftWrapFee() }
    });
});

module.exports = router;
