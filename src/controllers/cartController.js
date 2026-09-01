const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/error');
const { giftWrapFee, cleanGiftMessage, wantsWrap } = require('../config/pricing');

// @desc    Get user's cart
// @route   GET /api/cart
// @access  Private
const getCart = asyncHandler(async (req, res) => {
    let cart = await Cart.findOne({ user: req.user._id })
        .populate('items.product', 'name price images stock');

    if (!cart) {
        cart = await Cart.create({ user: req.user._id, items: [] });
    }

    res.json({
        success: true,
        // The wrapping fee is quoted alongside the cart so the storefront can
        // show the price without knowing it. Nothing client-side computes it.
        data: { ...cart.toObject(), giftWrapFee: giftWrapFee() }
    });
});

// @desc    Add item to cart
// @route   POST /api/cart
// @access  Private
const addToCart = asyncHandler(async (req, res) => {
    const { productId, quantity = 1, giftWrap } = req.body;

    if (!productId) {
        res.status(400);
        throw new Error('Product ID is required');
    }

    const product = await Product.findById(productId);
    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    const wanted = Math.max(1, parseInt(quantity, 10) || 1);

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
        cart = new Cart({ user: req.user._id, items: [] });
    }

    const existingItemIndex = cart.items.findIndex(item => item.product.toString() === productId);
    const alreadyInCart = existingItemIndex > -1
        ? (cart.items[existingItemIndex].quantity || 0)
        : 0;

    /* Check the RESULTING quantity, not the increment.
     *
     * This compared `product.stock < quantity`, which only ever looked at the
     * units being added this time. With 2 in stock and 2 already in the basket,
     * "add 1" was checked as 2 < 1 — false — and the cart happily went to 3.
     * Checkout then tried to deduct 3 units that did not exist.
     */
    const resulting = alreadyInCart + wanted;

    if (product.stock < resulting) {
        // `available` and `inCart` let the storefront say "only 2 left, and you
        // already have 2" rather than a bare "Insufficient stock".
        return res.status(400).json({
            success: false,
            code: 'INSUFFICIENT_STOCK',
            message: product.stock === 0
                ? `${product.name} is out of stock.`
                : `Only ${product.stock} left in stock for ${product.name}.`,
            details: {
                productId: String(product._id),
                available: product.stock,
                inCart: alreadyInCart,
                requested: resulting,
            },
        });
    }

    /* The wrap choice rides along with the add.
     *
     * The product page used to add the item and then call PUT /cart/gift-wrap
     * behind it. Those two requests race, and on a first-ever add the second
     * one arrived before this cart existed and came back 404 — which the
     * storefront rolled back, so the tick silently undid itself. Taking the
     * choice here means there is nothing to race. */
    const asked = giftWrap === undefined ? null : wantsWrap(giftWrap);

    if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity = resulting;
        if (asked !== null) cart.items[existingItemIndex].giftWrap = asked;
    } else {
        cart.items.push({ product: productId, quantity: wanted, giftWrap: asked === true });
    }

    await cart.save();

    await cart.populate('items.product', 'name price images stock');

    res.json({ success: true, cart });
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/:productId
// @access  Private
const updateCartItem = asyncHandler(async (req, res) => {
    const { quantity } = req.body;
    const { productId } = req.params;

    if (quantity < 1) {
        res.status(400);
        throw new Error('Quantity must be at least 1');
    }

    const product = await Product.findById(productId);
    if (product && product.stock < quantity) {
        return res.status(400).json({
            success: false,
            code: 'INSUFFICIENT_STOCK',
            message: product.stock === 0
                ? `${product.name} is out of stock.`
                : `Only ${product.stock} left in stock for ${product.name}.`,
            details: {
                productId: String(product._id),
                available: product.stock,
                requested: quantity,
            },
        });
    }

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
        res.status(404);
        throw new Error('Cart not found');
    }

    const itemIndex = cart.items.findIndex(
        item => item.product.toString() === productId
    );

    if (itemIndex === -1) {
        res.status(404);
        throw new Error('Item not in cart');
    }

    cart.items[itemIndex].quantity = quantity;
    await cart.save();

    cart = await Cart.findById(cart._id).populate('items.product', 'name price images stock');

    res.json({
        success: true,
        data: cart
    });
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/:productId
// @access  Private
const removeFromCart = asyncHandler(async (req, res) => {
    const { productId } = req.params;

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
        res.status(404);
        throw new Error('Cart not found');
    }

    cart.items = cart.items.filter(
        item => item.product.toString() !== productId
    );

    await cart.save();

    cart = await Cart.findById(cart._id).populate('items.product', 'name price images stock');

    res.json({
        success: true,
        data: cart
    });
});

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
const clearCart = asyncHandler(async (req, res) => {
    let cart = await Cart.findOne({ user: req.user._id });

    if (cart) {
        cart.items = [];
        // Emptying the bag drops the wrapping request with it.
        cart.giftWrap = { enabled: false, message: '' };
        await cart.save();
    }

    res.json({
        success: true,
        message: 'Cart cleared'
    });
});

// @desc    Ask for (or cancel) gift wrapping, line by line
// @route   PUT /api/cart/gift-wrap
// @access  Private
//
// Kept on the cart because checkout hands the customer to a payment gateway
// and gets them back on a different request; a choice held only in the browser
// does not survive that. The price is not stored — it is applied when the
// order is created, so a client cannot name its own fee.
//
// Body takes either a single line (`productId` plus `enabled`), the card
// message on its own (`message`), or both.
const setGiftWrap = asyncHandler(async (req, res) => {
    /* Created rather than refused when absent.
     *
     * This threw 404 "No cart to wrap", which a customer met by ticking the
     * box before anything had reached the server — the ordinary path for
     * someone who browsed as a guest and then signed in at checkout. The
     * storefront rolled the tick back and the box appeared to untick itself.
     * A cart is cheap; asking to wrap one is reason enough to have it. */
    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = new Cart({ user: req.user._id, items: [] });

    const { productId, enabled, message } = req.body;

    if (productId !== undefined) {
        const line = cart.items.find(item => String(item.product) === String(productId));
        if (!line) {
            res.status(404);
            throw new Error('That item is not in your bag');
        }
        line.giftWrap = wantsWrap(enabled);
    }

    if (message !== undefined) cart.giftWrap.message = cleanGiftMessage(message);

    /* The order-level flag is a summary of the lines, never set on its own —
       one place decides whether this bag is being wrapped at all. */
    const wrappedCount = cart.items.filter(item => item.giftWrap).length;
    cart.giftWrap.enabled = wrappedCount > 0;

    // A card message with nothing left to wrap is dead weight, and would
    // reappear if the customer wrapped something else having forgotten it.
    if (wrappedCount === 0) cart.giftWrap.message = '';

    await cart.save();

    res.json({
        success: true,
        data: {
            giftWrap: cart.giftWrap,
            items: cart.items.map(item => ({
                product: String(item.product),
                giftWrap: Boolean(item.giftWrap)
            })),
            unitFee: giftWrapFee(),
            fee: parseFloat((wrappedCount * giftWrapFee()).toFixed(3))
        }
    });
});

// @desc    Replace the whole bag in one request
// @route   PUT /api/cart
// @access  Private
//
// Checkout used to sync by calling DELETE /api/cart and then re-adding every
// line. That works for items and destroys everything else: clearing a cart
// drops the wrapping with it, so the selection was wiped a moment before the
// order was created. The customer saw the fee in the total they agreed to,
// the server rebuilt the order from a cart that no longer mentioned wrapping,
// and the gift went out unwrapped.
//
// Replacing in one write keeps the wrap flags the client sends for the lines
// it is sending, and cannot leave the cart empty halfway through.
const replaceCart = asyncHandler(async (req, res) => {
    const { items, message } = req.body;

    if (!Array.isArray(items)) {
        res.status(400);
        throw new Error('items must be an array');
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = new Cart({ user: req.user._id, items: [] });

    const next = [];
    for (const raw of items) {
        if (!raw || !raw.productId) continue;
        if (!mongoose.Types.ObjectId.isValid(String(raw.productId))) continue;

        const product = await Product.findById(raw.productId).select('stock name');
        if (!product) continue;

        // Never let a sync write more than the shelf holds. The cart is what
        // every payment path prices from, so an oversell here is an oversell
        // everywhere.
        const wanted = Math.max(1, parseInt(raw.quantity, 10) || 1);
        const quantity = Math.min(wanted, product.stock);
        if (quantity < 1) continue;

        next.push({
            product: product._id,
            quantity,
            giftWrap: wantsWrap(raw.giftWrap)
        });
    }

    cart.items = next;

    const wrappedCount = next.filter(item => item.giftWrap).length;
    cart.giftWrap.enabled = wrappedCount > 0;
    cart.giftWrap.message = wrappedCount > 0
        ? cleanGiftMessage(message !== undefined ? message : cart.giftWrap.message)
        : '';

    await cart.save();
    await cart.populate('items.product', 'name price images stock');

    res.json({
        success: true,
        data: { ...cart.toObject(), giftWrapFee: giftWrapFee() }
    });
});

module.exports = {
    setGiftWrap,
    replaceCart,
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart
};
