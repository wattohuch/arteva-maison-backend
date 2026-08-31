const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/error');
const { giftWrapFee } = require('../config/pricing');

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
    const { productId, quantity = 1 } = req.body;

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

    if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity = resulting;
    } else {
        cart.items.push({ product: productId, quantity: wanted });
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

// @desc    Ask for (or cancel) gift wrapping on this cart
// @route   PUT /api/cart/gift-wrap
// @access  Private
//
// Kept on the cart because checkout hands the customer to a payment gateway
// and gets them back on a different request; a choice held only in the browser
// does not survive that. The price is not stored — it is applied when the
// order is created, so a client cannot name its own fee.
const setGiftWrap = asyncHandler(async (req, res) => {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
        res.status(404);
        throw new Error('No cart to wrap');
    }

    const enabled = req.body.enabled === true || req.body.enabled === 'true';
    cart.giftWrap = {
        enabled,
        // A message on a cancelled wrap is dead weight, and would reappear if
        // the customer turned wrapping back on having forgotten it was there.
        message: enabled ? String(req.body.message || '').trim().slice(0, 300) : '',
    };
    await cart.save();

    res.json({ success: true, data: { giftWrap: cart.giftWrap, fee: enabled ? giftWrapFee() : 0 } });
});

module.exports = {
    setGiftWrap,
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart
};
