const HeroSlide = require('../models/HeroSlide');
const { asyncHandler } = require('../middleware/error');
const { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } = require('../config/cloudinary');

// @desc    Get active hero slides (public)
// @route   GET /api/hero
// @access  Public
const getHeroSlides = asyncHandler(async (req, res) => {
    const slides = await HeroSlide.find({ isActive: true }).sort({ order: 1 });
    res.json({ success: true, data: slides });
});

// @desc    Get ALL hero slides (admin)
// @route   GET /api/hero/all
// @access  Private/Admin
const getAllHeroSlides = asyncHandler(async (req, res) => {
    const slides = await HeroSlide.find({}).sort({ order: 1 });
    res.json({ success: true, data: slides });
});

// @desc    Create hero slide
// @route   POST /api/hero
// @access  Private/Admin
const createHeroSlide = asyncHandler(async (req, res) => {
    if (!req.file) {
        res.status(400);
        throw new Error('Please upload an image for the hero slide');
    }

    // Upload image to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, 'hero');
    console.log(`[HERO CREATE] ⬆️ Image uploaded to Cloudinary: ${result.url}`);

    const { title, titleAr, subtitle, subtitleAr, description, descriptionAr,
            buttonText, buttonTextAr, buttonLink, order, isActive } = req.body;

    // Auto-assign order if not provided
    let slideOrder = parseInt(order) || 0;
    if (!order && order !== 0) {
        const count = await HeroSlide.countDocuments();
        slideOrder = count;
    }

    const slide = await HeroSlide.create({
        image: result.url,
        title: title || '',
        titleAr: titleAr || '',
        subtitle: subtitle || '',
        subtitleAr: subtitleAr || '',
        description: description || '',
        descriptionAr: descriptionAr || '',
        buttonText: buttonText || '',
        buttonTextAr: buttonTextAr || '',
        buttonLink: buttonLink || '',
        order: slideOrder,
        isActive: isActive !== undefined ? isActive === 'true' || isActive === true : true
    });

    console.log(`[HERO CREATE] ✅ Hero slide created (ID: ${slide._id})`);
    res.status(201).json({ success: true, data: slide });
});

// @desc    Update hero slide
// @route   PUT /api/hero/:id
// @access  Private/Admin
const updateHeroSlide = asyncHandler(async (req, res) => {
    const slide = await HeroSlide.findById(req.params.id);

    if (!slide) {
        res.status(404);
        throw new Error('Hero slide not found');
    }

    // Handle new image upload
    if (req.file) {
        // Delete old image from Cloudinary
        if (slide.image) {
            const publicId = getPublicIdFromUrl(slide.image);
            if (publicId) {
                await deleteFromCloudinary(publicId);
                console.log(`[HERO UPDATE] 🗑️ Deleted old image: ${publicId}`);
            }
        }

        const result = await uploadToCloudinary(req.file.buffer, 'hero');
        slide.image = result.url;
        console.log(`[HERO UPDATE] ⬆️ New image uploaded: ${result.url}`);
    }

    // Update text fields
    const fields = ['title', 'titleAr', 'subtitle', 'subtitleAr', 'description',
                    'descriptionAr', 'buttonText', 'buttonTextAr', 'buttonLink'];
    fields.forEach(field => {
        if (req.body[field] !== undefined) {
            slide[field] = req.body[field];
        }
    });

    if (req.body.order !== undefined) {
        slide.order = parseInt(req.body.order) || 0;
    }

    if (req.body.isActive !== undefined) {
        slide.isActive = req.body.isActive === 'true' || req.body.isActive === true;
    }

    await slide.save();

    console.log(`[HERO UPDATE] ✅ Hero slide updated (ID: ${slide._id})`);
    res.json({ success: true, data: slide });
});

// @desc    Delete hero slide
// @route   DELETE /api/hero/:id
// @access  Private/Admin
const deleteHeroSlide = asyncHandler(async (req, res) => {
    const slide = await HeroSlide.findById(req.params.id);

    if (!slide) {
        res.status(404);
        throw new Error('Hero slide not found');
    }

    // Delete image from Cloudinary
    if (slide.image) {
        const publicId = getPublicIdFromUrl(slide.image);
        if (publicId) {
            await deleteFromCloudinary(publicId);
            console.log(`[HERO DELETE] 🗑️ Deleted image: ${publicId}`);
        }
    }

    await slide.deleteOne();

    console.log(`[HERO DELETE] ✅ Hero slide deleted (ID: ${req.params.id})`);
    res.json({ success: true, message: 'Hero slide deleted' });
});

// @desc    Reorder hero slides
// @route   PUT /api/hero/reorder
// @access  Private/Admin
const reorderHeroSlides = asyncHandler(async (req, res) => {
    const { items } = req.body; // [{id, order}, ...]

    if (!items || !Array.isArray(items)) {
        res.status(400);
        throw new Error('Please provide an array of {id, order} items');
    }

    const bulkOps = items.map(item => ({
        updateOne: {
            filter: { _id: item.id },
            update: { $set: { order: item.order } }
        }
    }));

    await HeroSlide.bulkWrite(bulkOps);

    const slides = await HeroSlide.find({}).sort({ order: 1 });
    console.log(`[HERO REORDER] ✅ Reordered ${items.length} slides`);
    res.json({ success: true, data: slides });
});

module.exports = {
    getHeroSlides,
    getAllHeroSlides,
    createHeroSlide,
    updateHeroSlide,
    deleteHeroSlide,
    reorderHeroSlides
};
