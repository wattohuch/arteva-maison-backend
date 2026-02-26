const Product = require('../models/Product');
const Category = require('../models/Category');
const { asyncHandler } = require('../middleware/error');
const { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } = require('../config/cloudinary');

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

    // Delete old image from Cloudinary if it exists
    if (product.image) {
        const oldPublicId = getPublicIdFromUrl(product.image);
        if (oldPublicId) {
            await deleteFromCloudinary(oldPublicId);
        }
    }

    // Upload new image to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, 'products');

    // Update product with Cloudinary URL
    product.image = result.url;
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

    // Delete old image from Cloudinary if it exists
    if (category.image) {
        const oldPublicId = getPublicIdFromUrl(category.image);
        if (oldPublicId) {
            await deleteFromCloudinary(oldPublicId);
        }
    }

    // Upload new image to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, 'categories');

    // Update category with Cloudinary URL
    category.image = result.url;
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

    // Delete from Cloudinary
    if (product.image) {
        const publicId = getPublicIdFromUrl(product.image);
        if (publicId) {
            await deleteFromCloudinary(publicId);
        }
    }

    // Set to empty
    product.image = '';
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

    // Delete from Cloudinary
    if (category.image) {
        const publicId = getPublicIdFromUrl(category.image);
        if (publicId) {
            await deleteFromCloudinary(publicId);
        }
    }

    // Set to empty
    category.image = '';
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
