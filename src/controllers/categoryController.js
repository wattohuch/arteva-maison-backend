const Category = require('../models/Category');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/error');
const { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } = require('../config/cloudinary');

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

// @desc    Get category by slug
// @route   GET /api/categories/slug/:slug
// @access  Public
const getCategoryBySlug = asyncHandler(async (req, res) => {
    const category = await Category.findOne({ slug: req.params.slug });
    
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
    const { name, nameAr, description, descriptionAr, isActive } = req.body;
    
    // Check if category exists
    const categoryExists = await Category.findOne({ name });
    if (categoryExists) {
        res.status(400);
        throw new Error('Category already exists');
    }
    
    // Upload image to Cloudinary if provided
    let image = null;
    if (req.file) {
        try {
            const result = await uploadToCloudinary(req.file.buffer, 'categories');
            image = result.url;
            console.log(`[CATEGORY CREATE] ⬆️ Image uploaded to Cloudinary: ${result.url}`);
        } catch (err) {
            console.error(`[CATEGORY CREATE] ❌ Failed to upload image:`, err.message);
        }
    }
    
    const category = await Category.create({
        name,
        nameAr,
        description,
        descriptionAr,
        image,
        isActive: isActive !== undefined ? isActive === 'true' || isActive === true : true
    });
    
    console.log(`[CATEGORY CREATE] ✅ Category created: ${category.name} (ID: ${category._id})`);
    res.status(201).json({ success: true, data: category });
});

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
const updateCategory = asyncHandler(async (req, res) => {
    const { name, nameAr, description, descriptionAr, isActive, deleteImage } = req.body;
    
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
    
    // Handle image deletion request
    if (deleteImage === 'true' || deleteImage === true) {
        if (category.image) {
            const publicId = getPublicIdFromUrl(category.image);
            if (publicId) {
                await deleteFromCloudinary(publicId);
                console.log(`[CATEGORY UPDATE] 🗑️ Deleted old image from Cloudinary: ${publicId}`);
            }
            category.image = null;
        }
    }
    
    // Handle new image upload
    if (req.file) {
        // Delete old image from Cloudinary if it exists
        if (category.image) {
            const publicId = getPublicIdFromUrl(category.image);
            if (publicId) {
                await deleteFromCloudinary(publicId);
                console.log(`[CATEGORY UPDATE] 🗑️ Deleted old image from Cloudinary: ${publicId}`);
            }
        }
        
        // Upload new image to Cloudinary
        try {
            const result = await uploadToCloudinary(req.file.buffer, 'categories');
            category.image = result.url;
            console.log(`[CATEGORY UPDATE] ⬆️ New image uploaded to Cloudinary: ${result.url}`);
        } catch (err) {
            console.error(`[CATEGORY UPDATE] ❌ Failed to upload image:`, err.message);
        }
    }
    
    // Allow setting image URL directly (for fixes/migrations)
    if (!req.file && req.body.imageUrl) {
        category.image = req.body.imageUrl;
        console.log(`[CATEGORY UPDATE] 🔗 Image URL set directly: ${req.body.imageUrl}`);
    }
    
    // Update fields
    category.name = name || category.name;
    category.nameAr = nameAr !== undefined ? nameAr : category.nameAr;
    category.description = description !== undefined ? description : category.description;
    category.descriptionAr = descriptionAr !== undefined ? descriptionAr : category.descriptionAr;
    if (isActive !== undefined) {
        category.isActive = isActive === 'true' || isActive === true;
    }
    
    await category.save();
    
    console.log(`[CATEGORY UPDATE] ✅ Category updated: ${category.name}`);
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
    
    // Delete image from Cloudinary if it exists
    if (category.image) {
        const publicId = getPublicIdFromUrl(category.image);
        if (publicId) {
            await deleteFromCloudinary(publicId);
            console.log(`[CATEGORY DELETE] 🗑️ Deleted image from Cloudinary: ${publicId}`);
        }
    }
    
    await category.deleteOne();
    
    console.log(`[CATEGORY DELETE] ✅ Category deleted: ${category.name}`);
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
    getCategoryBySlug,
    createCategory,
    updateCategory,
    deleteCategory,
    getCategoryStats
};
