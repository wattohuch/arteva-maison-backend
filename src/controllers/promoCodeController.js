const PromoCode = require('../models/PromoCode');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { asyncHandler } = require('../middleware/error');

// @desc    Create a new promo code
// @route   POST /api/admin/promo-codes
// @access  Private/Admin
const createPromoCode = asyncHandler(async (req, res) => {
    const { code, name, description, expiresAt, maxUsage, perUserLimit, maxQuantityPerOrder, products } = req.body;

    // Check for duplicate code
    const existing = await PromoCode.findOne({ code: code.toUpperCase().trim() });
    if (existing) {
        res.status(400);
        throw new Error(`Promo code "${code}" already exists`);
    }

    const promoCode = await PromoCode.create({
        code: code.toUpperCase().trim(),
        name,
        description,
        expiresAt,
        maxUsage: maxUsage || null,
        perUserLimit: perUserLimit || null,
        maxQuantityPerOrder: maxQuantityPerOrder || null,
        products: products || [],
        createdBy: req.user._id
    });

    console.log(`[PROMO] ✅ Created promo code "${promoCode.code}" by ${req.user.email}`);

    res.status(201).json({
        success: true,
        data: promoCode
    });
});

// @desc    Get all promo codes
// @route   GET /api/admin/promo-codes
// @access  Private/Admin
const getAllPromoCodes = asyncHandler(async (req, res) => {
    const promoCodes = await PromoCode.find({})
        .populate('products.product', 'name nameAr price images')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 });

    res.json({
        success: true,
        data: promoCodes
    });
});

// @desc    Get single promo code with full details
// @route   GET /api/admin/promo-codes/:id
// @access  Private/Admin
const getPromoCodeById = asyncHandler(async (req, res) => {
    const promoCode = await PromoCode.findById(req.params.id)
        .populate('products.product', 'name nameAr price images sku')
        .populate('createdBy', 'name email');

    if (!promoCode) {
        res.status(404);
        throw new Error('Promo code not found');
    }

    res.json({
        success: true,
        data: promoCode
    });
});

// @desc    Get promo code stats with usage analytics
// @route   GET /api/admin/promo-codes/:id/stats
// @access  Private/Admin
const getPromoCodeStats = asyncHandler(async (req, res) => {
    const promoCode = await PromoCode.findById(req.params.id)
        .populate('products.product', 'name nameAr price images sku')
        .populate('usedBy.user', 'name email')
        .populate('createdBy', 'name email');

    if (!promoCode) {
        res.status(404);
        throw new Error('Promo code not found');
    }

    // Find all orders that used this promo code
    const orders = await Order.find({ 'promoCode.promoCodeId': promoCode._id })
        .select('orderNumber total promoCode createdAt user paymentStatus')
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .limit(50);

    const totalRevenue = orders
        .filter(o => o.paymentStatus === 'paid')
        .reduce((sum, o) => sum + (o.total || 0), 0);

    const totalDiscountGiven = orders.reduce((sum, o) => sum + (o.promoCode?.totalDiscount || 0), 0);

    res.json({
        success: true,
        data: {
            promoCode,
            stats: {
                totalOrders: orders.length,
                totalRevenue: parseFloat(totalRevenue.toFixed(3)),
                totalDiscountGiven: parseFloat(totalDiscountGiven.toFixed(3)),
                uniqueUsers: promoCode.usedBy.length
            },
            recentOrders: orders
        }
    });
});

// @desc    Update promo code
// @route   PUT /api/admin/promo-codes/:id
// @access  Private/Admin
const updatePromoCode = asyncHandler(async (req, res) => {
    const promoCode = await PromoCode.findById(req.params.id);

    if (!promoCode) {
        res.status(404);
        throw new Error('Promo code not found');
    }

    const { code, name, description, isActive, expiresAt, maxUsage, perUserLimit, maxQuantityPerOrder } = req.body;

    // If changing code, check for duplicates
    if (code && code.toUpperCase().trim() !== promoCode.code) {
        const existing = await PromoCode.findOne({ code: code.toUpperCase().trim() });
        if (existing) {
            res.status(400);
            throw new Error(`Promo code "${code}" already exists`);
        }
        promoCode.code = code.toUpperCase().trim();
    }

    if (name !== undefined) promoCode.name = name;
    if (description !== undefined) promoCode.description = description;
    if (isActive !== undefined) promoCode.isActive = isActive;
    if (expiresAt !== undefined) promoCode.expiresAt = expiresAt;
    if (maxUsage !== undefined) promoCode.maxUsage = maxUsage || null;
    if (perUserLimit !== undefined) promoCode.perUserLimit = perUserLimit || null;
    if (maxQuantityPerOrder !== undefined) promoCode.maxQuantityPerOrder = maxQuantityPerOrder || null;

    await promoCode.save();

    console.log(`[PROMO] ✏️ Updated promo code "${promoCode.code}" by ${req.user.email}`);

    const populated = await PromoCode.findById(promoCode._id)
        .populate('products.product', 'name nameAr price images')
        .populate('createdBy', 'name email');

    res.json({
        success: true,
        data: populated
    });
});

// @desc    Delete promo code
// @route   DELETE /api/admin/promo-codes/:id
// @access  Private/Admin
const deletePromoCode = asyncHandler(async (req, res) => {
    const promoCode = await PromoCode.findById(req.params.id);

    if (!promoCode) {
        res.status(404);
        throw new Error('Promo code not found');
    }

    await promoCode.deleteOne();

    console.log(`[PROMO] 🗑️ Deleted promo code "${promoCode.code}" by ${req.user.email}`);

    res.json({
        success: true,
        message: `Promo code "${promoCode.code}" deleted`
    });
});

// @desc    Add/update products to promo code (batch)
// @route   POST /api/admin/promo-codes/:id/products
// @access  Private/Admin
const addProductsToPromo = asyncHandler(async (req, res) => {
    const promoCode = await PromoCode.findById(req.params.id);

    if (!promoCode) {
        res.status(404);
        throw new Error('Promo code not found');
    }

    const { products } = req.body;
    // products: [{ product: ObjectId, discountType: 'percentage'|'fixed', discountValue: Number, maxDiscountedQuantity: Number }]

    if (!products || !Array.isArray(products) || products.length === 0) {
        res.status(400);
        throw new Error('Products array is required');
    }

    // Validate all product IDs exist
    const productIds = products.map(p => p.product);
    const existingProducts = await Product.find({ _id: { $in: productIds } }).select('_id');
    const existingIds = new Set(existingProducts.map(p => p._id.toString()));

    for (const p of products) {
        if (!existingIds.has(p.product.toString())) {
            res.status(400);
            throw new Error(`Product ${p.product} not found`);
        }
    }

    // Upsert: update existing, add new
    for (const newProduct of products) {
        const existingIndex = promoCode.products.findIndex(
            p => p.product.toString() === newProduct.product.toString()
        );

        if (existingIndex >= 0) {
            // Update existing
            promoCode.products[existingIndex].discountType = newProduct.discountType;
            promoCode.products[existingIndex].discountValue = newProduct.discountValue;
            promoCode.products[existingIndex].maxDiscountedQuantity = newProduct.maxDiscountedQuantity || null;
        } else {
            // Add new
            promoCode.products.push({
                product: newProduct.product,
                discountType: newProduct.discountType,
                discountValue: newProduct.discountValue,
                maxDiscountedQuantity: newProduct.maxDiscountedQuantity || null
            });
        }
    }

    await promoCode.save();

    console.log(`[PROMO] 📦 Added/updated ${products.length} products to "${promoCode.code}" by ${req.user.email}`);

    const populated = await PromoCode.findById(promoCode._id)
        .populate('products.product', 'name nameAr price images');

    res.json({
        success: true,
        data: populated
    });
});

// @desc    Remove a product from promo code
// @route   DELETE /api/admin/promo-codes/:id/products/:productId
// @access  Private/Admin
const removeProductFromPromo = asyncHandler(async (req, res) => {
    const promoCode = await PromoCode.findById(req.params.id);

    if (!promoCode) {
        res.status(404);
        throw new Error('Promo code not found');
    }

    const beforeCount = promoCode.products.length;
    promoCode.products = promoCode.products.filter(
        p => p.product.toString() !== req.params.productId
    );

    if (promoCode.products.length === beforeCount) {
        res.status(404);
        throw new Error('Product not found in this promo code');
    }

    await promoCode.save();

    console.log(`[PROMO] ➖ Removed product ${req.params.productId} from "${promoCode.code}"`);

    res.json({
        success: true,
        data: promoCode
    });
});

// @desc    Validate promo code at checkout (PUBLIC)
// @route   POST /api/promo-codes/validate
// @access  Private (requires login to use promo codes)
const validatePromoCode = asyncHandler(async (req, res) => {
    const { code, cartItems } = req.body;
    // cartItems: [{ product: ObjectId, quantity: Number, price: Number }]

    if (!code) {
        res.status(400);
        throw new Error('Promo code is required');
    }

    const promoCode = await PromoCode.findOne({ code: code.toUpperCase().trim() })
        .populate('products.product', 'name nameAr price');

    if (!promoCode) {
        res.status(404);
        throw new Error('Invalid promo code');
    }

    // Check validity including per-user limit
    const userId = req.user ? req.user._id : null;
    const validity = promoCode.canUserUse(userId);
    if (!validity.valid) {
        res.status(400);
        throw new Error(validity.reason);
    }

    // Calculate discounts for cart items
    const discounts = [];
    let totalDiscount = 0;

    if (cartItems && Array.isArray(cartItems)) {
        for (const cartItem of cartItems) {
            const promoProduct = promoCode.products.find(
                p => p.product._id.toString() === cartItem.product.toString()
            );

            if (promoProduct) {
                let discount = 0;
                if (promoProduct.discountType === 'percentage') {
                    discount = (cartItem.price * promoProduct.discountValue / 100) * cartItem.quantity;
                } else {
                    // Fixed discount per unit
                    discount = promoProduct.discountValue * cartItem.quantity;
                }

                // Ensure discount doesn't exceed item total
                const itemTotal = cartItem.price * cartItem.quantity;
                discount = Math.min(discount, itemTotal);

                discounts.push({
                    product: cartItem.product,
                    productName: promoProduct.product.name,
                    originalPrice: cartItem.price,
                    discountType: promoProduct.discountType,
                    discountValue: promoProduct.discountValue,
                    quantity: cartItem.quantity,
                    discountAmount: parseFloat(discount.toFixed(3))
                });

                totalDiscount += discount;
            }
        }
    }

    res.json({
        success: true,
        data: {
            code: promoCode.code,
            name: promoCode.name,
            promoCodeId: promoCode._id,
            valid: true,
            discounts,
            totalDiscount: parseFloat(totalDiscount.toFixed(3)),
            applicableProducts: promoCode.products.length,
            matchedProducts: discounts.length
        }
    });
});

module.exports = {
    createPromoCode,
    getAllPromoCodes,
    getPromoCodeById,
    getPromoCodeStats,
    updatePromoCode,
    deletePromoCode,
    addProductsToPromo,
    removeProductFromPromo,
    validatePromoCode
};
