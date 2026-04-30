const Product = require('../models/Product');
const Category = require('../models/Category');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/error');
const { paginate, buildSortQuery } = require('../utils/helpers');

// @desc    Get all products
// @route   GET /api/products
// @access  Public
const getProducts = asyncHandler(async (req, res) => {
    const { category, search, sort, minPrice, maxPrice, featured, isNew } = req.query;
    const { skip, limit, page } = paginate(req.query.page, req.query.limit);

    // Build filter query
    let filter = { isActive: true };

    if (category) {
        // Support both ObjectId and slug-based category filtering
        let catId;
        if (mongoose.Types.ObjectId.isValid(category)) {
            catId = category;
        } else {
            // Look up category by slug
            const cat = await Category.findOne({ slug: category });
            if (cat) {
                catId = cat._id;
            } else {
                // No matching category — return empty results
                return res.json({ success: true, data: [], pagination: { page, limit, total: 0, pages: 0 } });
            }
        }
        // Match products where primary category OR additionalCategories contains the target
        filter.$or = [
            { category: catId },
            { additionalCategories: catId }
        ];
    }

    if (search) {
        filter.$text = { $search: search };
    }

    if (minPrice || maxPrice) {
        filter.price = {};
        if (minPrice) filter.price.$gte = parseFloat(minPrice);
        if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }

    if (featured === 'true') {
        filter.isFeatured = true;
    }

    if (isNew === 'true') {
        filter.isNewArrival = true;
    }

    const sortQuery = buildSortQuery(sort);

    const products = await Product.find(filter)
        .populate('category', 'name slug')
        .populate('additionalCategories', 'name slug')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .lean();

    const total = await Product.countDocuments(filter);

    res.json({
        success: true,
        data: products,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
const getProduct = asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id).populate('category', 'name slug').populate('additionalCategories', 'name slug').lean();

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    res.json({
        success: true,
        data: product
    });
});

// @desc    Get product by slug
// @route   GET /api/products/slug/:slug
// @access  Public
const getProductBySlug = asyncHandler(async (req, res) => {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
        .populate('category', 'name slug')
        .populate('additionalCategories', 'name slug')
        .lean();

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    res.json({
        success: true,
        data: product
    });
});

// @desc    Create product (Admin)
// @route   POST /api/products
// @access  Private/Admin
const createProduct = asyncHandler(async (req, res) => {
    const product = await Product.create(req.body);

    res.status(201).json({
        success: true,
        data: product
    });
});

// @desc    Update product (Admin)
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = asyncHandler(async (req, res) => {
    let product = await Product.findById(req.params.id);

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    // Parse additionalCategories if sent as JSON string (from FormData)
    if (req.body.additionalCategories && typeof req.body.additionalCategories === 'string') {
        try {
            req.body.additionalCategories = JSON.parse(req.body.additionalCategories);
        } catch (e) {
            req.body.additionalCategories = [];
        }
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
        returnDocument: 'after',
        runValidators: true
    });

    res.json({
        success: true,
        data: product
    });
});

// @desc    Delete product (Admin)
// @route   DELETE /api/products/:id
// @access  Private/Admin
const deleteProduct = asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    await product.deleteOne();

    res.json({
        success: true,
        message: 'Product deleted'
    });
});

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
const getFeaturedProducts = asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 8;

    const products = await Product.find({ isActive: true, isFeatured: true })
        .populate('category', 'name slug')
        .limit(limit)
        .lean();

    res.json({
        success: true,
        data: products
    });
});

// @desc    Increment product view count
// @route   POST /api/products/:id/view
// @access  Public
const incrementProductView = asyncHandler(async (req, res) => {
    const product = await Product.findByIdAndUpdate(
        req.params.id,
        { $inc: { viewCount: 1 } },
        { returnDocument: 'before', select: '_id' }
    );

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    res.json({ success: true });
});

module.exports = {
    getProducts,
    getProduct,
    getProductBySlug,
    createProduct,
    updateProduct,
    deleteProduct,
    getFeaturedProducts,
    incrementProductView
};
