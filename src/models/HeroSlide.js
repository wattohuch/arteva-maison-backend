const mongoose = require('mongoose');

const heroSlideSchema = new mongoose.Schema({
    image: {
        type: String,
        required: [true, 'Hero slide image is required']
    },
    title: {
        type: String,
        trim: true,
        default: ''
    },
    titleAr: {
        type: String,
        trim: true,
        default: ''
    },
    subtitle: {
        type: String,
        trim: true,
        default: ''
    },
    subtitleAr: {
        type: String,
        trim: true,
        default: ''
    },
    description: {
        type: String,
        trim: true,
        default: ''
    },
    descriptionAr: {
        type: String,
        trim: true,
        default: ''
    },
    buttonText: {
        type: String,
        trim: true,
        default: ''
    },
    buttonTextAr: {
        type: String,
        trim: true,
        default: ''
    },
    buttonLink: {
        type: String,
        trim: true,
        default: ''
    },
    order: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Sort by order ascending by default
heroSlideSchema.index({ order: 1 });
heroSlideSchema.index({ isActive: 1, order: 1 });

module.exports = mongoose.model('HeroSlide', heroSlideSchema);
