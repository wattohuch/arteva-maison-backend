const Product = require('../models/Product');
const Category = require('../models/Category');
const { asyncHandler } = require('../middleware/error');
const path = require('path');
const fs = require('fs').promises;

// @desc    Update product image
// @route   PUT /api/images/product/:id
// @access  Private/Admin
const updateProductImage = asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    if (!req.file) {
        res.status(400);
        throw new Error('Please upload an image');
    }

    // Delete old image if it exists (optional - keep for backup)
    // const oldImagePath = path.join(__dirname, '../../../frontend', product.image);
    // try {
    //     await fs.unlink(oldImagePath);
    // } catch (err) {
    //     // Image doesn't exist, continue
    // }

    // Update product with new image path
    const imagePath = `/assets/images/products/${req.file.filename}`;
    product.image = imagePath;
    await product.save();

    res.json({
        success: true,
        data: product,
        message: 'Product image updated successfully'
    });
});

// @desc    Update category image
// @route   PUT /api/images/category/:id
// @access  Private/Admin
const updateCategoryImage = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }

    if (!req.file) {
        res.status(400);
        throw new Error('Please upload an image');
    }

    // Update category with new image path
    const imagePath = `/assets/images/categories/${req.file.filename}`;
    category.image = imagePath;
    await category.save();

    res.json({
        success: true,
        data: category,
        message: 'Category image updated successfully'
    });
});

// @desc    Delete product image (set to default or empty)
// @route   DELETE /api/images/product/:id
// @access  Private/Admin
const deleteProductImage = asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    // Set to default placeholder or empty
    product.image = '/assets/images/products/placeholder.png';
    await product.save();

    res.json({
        success: true,
        data: product,
        message: 'Product image removed'
    });
});

// @desc    Delete category image
// @route   DELETE /api/images/category/:id
// @access  Private/Admin
const deleteCategoryImage = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        res.status(404);
        throw new Error('Category not found');
    }

    // Set to default placeholder or empty
    category.image = '/assets/images/categories/placeholder.png';
    await category.save();

    res.json({
        success: true,
        data: category,
        message: 'Category image removed'
    });
});

module.exports = {
    updateProductImage,
    updateCategoryImage,
    deleteProductImage,
    deleteCategoryImage
};
