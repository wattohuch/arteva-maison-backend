const Category = require('../models/Category');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/error');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
const getCategories = asyncHandler(async (req, res) => {
    const categories = await Category.find({}).sort({ name: 1 });
    res.json({ success: true, data: categories });
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
    
    res.json({ success: true, data: category });
});

// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
const createCategory = asyncHandler(async (req, res) => {
    const { name, nameAr, description, descriptionAr } = req.body;
    
    // Check if category exists
    const categoryExists = await Category.findOne({ name });
    if (categoryExists) {
        res.status(400);
        throw new Error('Category already exists');
    }
    
    let image = null;
    if (req.file) {
        image = `/assets/images/categories/${req.file.filename}`;
    }
    
    const category = await Category.create({
        name,
        nameAr,
        description,
        descriptionAr,
        image
    });
    
    res.status(201).json({ success: true, data: category });
});

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
const updateCategory = asyncHandler(async (req, res) => {
    const { name, nameAr, description, descriptionAr } = req.body;
    
    const category = await Category.findById(req.params.id);
    
    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }
    
    // Check if new name conflicts with existing category
    if (name && name !== category.name) {
        const nameExists = await Category.findOne({ name });
        if (nameExists) {
            res.status(400);
            throw new Error('Category name already exists');
        }
    }
    
    category.name = name || category.name;
    category.nameAr = nameAr || category.nameAr;
    category.description = description || category.description;
    category.descriptionAr = descriptionAr || category.descriptionAr;
    
    if (req.file) {
        category.image = `/assets/images/categories/${req.file.filename}`;
    }
    
    await category.save();
    
    res.json({ success: true, data: category });
});

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
const deleteCategory = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);
    
    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }
    
    // Check if category has products
    const productsCount = await Product.countDocuments({ category: req.params.id });
    if (productsCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete category. ${productsCount} product(s) are linked to this category.`);
    }
    
    await category.deleteOne();
    
    res.json({ success: true, message: 'Category deleted' });
});

// @desc    Get category with products count
// @route   GET /api/categories/:id/stats
// @access  Private/Admin
const getCategoryStats = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);
    
    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }
    
    const productsCount = await Product.countDocuments({ category: req.params.id });
    
    res.json({
        success: true,
        data: {
            ...category.toObject(),
            productsCount
        }
    });
});

module.exports = {
    getCategories,
    getCategory,
    createCategory,
    updateCategory,
    deleteCategory,
    getCategoryStats
};
