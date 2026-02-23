const Category = require('../models/Category');
const { asyncHandler } = require('../middleware/error');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
const getCategories = asyncHandler(async (req, res) => {
    const categories = await Category.find({ isActive: true });

    res.json({
        success: true,
        data: categories
    });
});

// @desc    Get single category
// @route   GET /api/categories/:id
// @access  Public
const getCategory = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }

    res.json({
        success: true,
        data: category
    });
});

// @desc    Get category by slug
// @route   GET /api/categories/slug/:slug
// @access  Public
const getCategoryBySlug = asyncHandler(async (req, res) => {
    const category = await Category.findOne({ slug: req.params.slug, isActive: true });

    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }

    res.json({
        success: true,
        data: category
    });
});

// @desc    Create category (Admin)
// @route   POST /api/categories
// @access  Private/Admin
const createCategory = asyncHandler(async (req, res) => {
    const categoryData = { ...req.body };
    
    // Handle image upload
    if (req.file) {
        categoryData.image = `/assets/images/categories/${req.file.filename}`;
        console.log(`[ADMIN] Created category with image: ${categoryData.image}`);
    }
    
    const category = await Category.create(categoryData);

    res.status(201).json({
        success: true,
        data: category
    });
});

// @desc    Update category (Admin)
// @route   PUT /api/categories/:id
// @access  Private/Admin
const updateCategory = asyncHandler(async (req, res) => {
    let category = await Category.findById(req.params.id);

    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }

    // Handle image deletion
    if (req.body.deleteImage === 'true') {
        category.image = null;
        console.log(`[ADMIN] Deleted category image for "${category.name}"`);
    }

    // Handle new image upload
    if (req.file) {
        category.image = `/assets/images/categories/${req.file.filename}`;
        console.log(`[ADMIN] Updated category image for "${category.name}"`);
    }

    // Update other fields
    if (req.body.name) category.name = req.body.name;
    if (req.body.nameAr !== undefined) category.nameAr = req.body.nameAr;
    if (req.body.description !== undefined) category.description = req.body.description;
    if (req.body.isActive !== undefined) category.isActive = req.body.isActive === 'true' || req.body.isActive === true;

    await category.save();

    res.json({
        success: true,
        data: category
    });
});

// @desc    Delete category (Admin)
// @route   DELETE /api/categories/:id
// @access  Private/Admin
const deleteCategory = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }

    await category.deleteOne();

    res.json({
        success: true,
        message: 'Category deleted'
    });
});

module.exports = {
    getCategories,
    getCategory,
    getCategoryBySlug,
    createCategory,
    updateCategory,
    deleteCategory
};
