const PromoCode = require('../models/PromoCode');
const Product = require('../models/Product');
const Order = require('../models/Order');
const PromoVisit = require('../models/PromoVisit');
const promoService = require('../services/promoService');
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

    // Visitor funnel for this code
    const [visitStats] = await PromoVisit.aggregate([
        { $match: { promoCodeId: promoCode._id } },
        {
            $group: {
                _id: null,
                visits: { $sum: 1 },
                uniqueVisitors: { $addToSet: '$visitorId' },
                conversions: { $sum: { $cond: ['$converted', 1, 0] } },
            }
        },
    ]);

    const uniqueVisitors = visitStats ? visitStats.uniqueVisitors.length : 0;

    // Daily visit trend (last 30 days) so a code's traffic curve is visible
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyVisits = await PromoVisit.aggregate([
        { $match: { promoCodeId: promoCode._id, createdAt: { $gte: thirtyDaysAgo } } },
        {
            $group: {
                _id: '$date',
                visitors: { $addToSet: '$visitorId' },
                conversions: { $sum: { $cond: ['$converted', 1, 0] } },
            }
        },
        { $sort: { _id: 1 } },
    ]);

    res.json({
        success: true,
        data: {
            promoCode,
            stats: {
                totalOrders: orders.length,
                totalRevenue: parseFloat(totalRevenue.toFixed(3)),
                totalDiscountGiven: parseFloat(totalDiscountGiven.toFixed(3)),
                uniqueUsers: promoCode.usedBy.length,
                visits: visitStats ? visitStats.visits : 0,
                uniqueVisitors,
                conversions: visitStats ? visitStats.conversions : 0,
                conversionRate: uniqueVisitors > 0
                    ? parseFloat(((orders.length / uniqueVisitors) * 100).toFixed(1))
                    : 0,
            },
            dailyVisits: dailyVisits.map(d => ({
                date: d._id,
                visitors: d.visitors.length,
                conversions: d.conversions,
            })),
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

    const userId = req.user ? req.user._id : null;
    const resolved = await promoService.resolveForUser(code, userId);

    if (!resolved.ok) {
        res.status(resolved.reason === 'Invalid promo code' ? 404 : 400);
        throw new Error(resolved.reason);
    }

    const { promo } = resolved;

    // Same calculator the payment path uses, so the quoted saving is exactly
    // what the shopper will be charged.
    const { discounts, totalDiscount, matchedProducts, discountedUnits } =
        promoService.calculateDiscount(promo, Array.isArray(cartItems) ? cartItems : []);

    res.json({
        success: true,
        data: {
            code: promo.code,
            name: promo.name,
            promoCodeId: promo._id,
            valid: true,
            discounts,
            totalDiscount,
            discountedUnits,
            applicableProducts: promo.products.length,
            matchedProducts
        }
    });
});

// @desc    Record a visitor arriving with a promo code (link or manual entry)
// @route   POST /api/promo-codes/track-visit
// @access  Public (optionalAuth)
const trackPromoVisit = asyncHandler(async (req, res) => {
    const { code, visitorId, referrer, landingPage, source } = req.body;

    if (!code || !visitorId) {
        res.status(400);
        throw new Error('code and visitorId are required');
    }

    const visit = await promoService.recordVisit({
        code,
        visitorId: String(visitorId).slice(0, 64),
        ip: req.ip || req.headers['x-forwarded-for'] || '',
        userAgent: req.headers['user-agent'] || '',
        referrer,
        landingPage,
        source,
        userId: req.user?._id,
    });

    // An unknown code is not an error for the client — tracking must never
    // interrupt a page load — but nothing is recorded.
    res.json({
        success: true,
        data: visit ? { visitId: visit._id, code: visit.code } : null,
    });
});

// @desc    Visitor / conversion analytics for every promo code
// @route   GET /api/admin/promo-codes/analytics
// @access  Private/Admin
const getPromoAnalytics = asyncHandler(async (req, res) => {
    const { from, to } = req.query;

    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
    }
    const dateFilter = Object.keys(range).length ? { createdAt: range } : {};

    const [visitAgg, orderAgg, codes] = await Promise.all([
        PromoVisit.aggregate([
            { $match: dateFilter },
            {
                $group: {
                    _id: '$promoCodeId',
                    visits: { $sum: 1 },
                    uniqueVisitors: { $addToSet: '$visitorId' },
                    conversions: { $sum: { $cond: ['$converted', 1, 0] } },
                    attributedRevenue: { $sum: { $cond: ['$converted', '$orderTotal', 0] } },
                }
            },
        ]),
        // Orders are the authoritative revenue figure; visits only cover
        // shoppers who arrived through a tracked link.
        Order.aggregate([
            {
                $match: {
                    'promoCode.promoCodeId': { $ne: null },
                    paymentStatus: 'paid',
                    ...dateFilter,
                }
            },
            {
                $group: {
                    _id: '$promoCode.promoCodeId',
                    orders: { $sum: 1 },
                    revenue: { $sum: '$total' },
                    discountGiven: { $sum: '$promoCode.totalDiscount' },
                    refunded: { $sum: '$refundAmount' },
                }
            },
        ]),
        PromoCode.find({}).select('code name isActive expiresAt usageCount maxUsage').lean(),
    ]);

    const visitsById = new Map(visitAgg.map(v => [String(v._id), v]));
    const ordersById = new Map(orderAgg.map(o => [String(o._id), o]));

    const rows = codes.map(c => {
        const v = visitsById.get(String(c._id));
        const o = ordersById.get(String(c._id));
        const uniqueVisitors = v ? v.uniqueVisitors.length : 0;
        const orders = o ? o.orders : 0;
        return {
            _id: c._id,
            code: c.code,
            name: c.name,
            isActive: c.isActive,
            expiresAt: c.expiresAt,
            usageCount: c.usageCount,
            maxUsage: c.maxUsage,
            visits: v ? v.visits : 0,
            uniqueVisitors,
            orders,
            // Conversion is orders per unique visitor who arrived on the code.
            conversionRate: uniqueVisitors > 0
                ? parseFloat(((orders / uniqueVisitors) * 100).toFixed(1))
                : 0,
            revenue: promoService.round3(o ? o.revenue : 0),
            netRevenue: promoService.round3(o ? o.revenue - (o.refunded || 0) : 0),
            discountGiven: promoService.round3(o ? o.discountGiven : 0),
        };
    });

    rows.sort((a, b) => b.revenue - a.revenue || b.visits - a.visits);

    res.json({
        success: true,
        data: {
            codes: rows,
            totals: {
                visits: rows.reduce((s, r) => s + r.visits, 0),
                uniqueVisitors: rows.reduce((s, r) => s + r.uniqueVisitors, 0),
                orders: rows.reduce((s, r) => s + r.orders, 0),
                revenue: promoService.round3(rows.reduce((s, r) => s + r.revenue, 0)),
                discountGiven: promoService.round3(rows.reduce((s, r) => s + r.discountGiven, 0)),
            },
        },
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
    validatePromoCode,
    trackPromoVisit,
    getPromoAnalytics
};
