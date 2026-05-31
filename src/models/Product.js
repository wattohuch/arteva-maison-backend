const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Product name is required'],
        trim: true,
        maxlength: [100, 'Product name cannot exceed 100 characters']
    },
    nameAr: {
        type: String,
        trim: true
    },
    sku: {
        type: String,
        unique: true,
        sparse: true
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true
    },
    description: {
        type: String,
        trim: true
    },
    descriptionAr: {
        type: String,
        trim: true
    },
    price: {
        type: Number,
        required: [true, 'Product price is required'],
        min: [0, 'Price cannot be negative']
    },
    compareAtPrice: {
        type: Number,
        min: [0, 'Compare at price cannot be negative']
    },
    currency: {
        type: String,
        default: 'KWD'
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: [true, 'Product category is required']
    },
    additionalCategories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    }],
    images: [{
        url: { type: String, required: true },
        alt: { type: String },
        isPrimary: { type: Boolean, default: false }
    }],
    stock: {
        type: Number,
        default: 0,
        min: [0, 'Stock cannot be negative']
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isComingSoon: {
        type: Boolean,
        default: false
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    isNewArrival: {
        type: Boolean,
        default: false
    },
    tags: [{
        type: String,
        trim: true
    }],
    sizeText: {
        type: String,
        trim: true
    },
    sortOrder: {
        type: Number,
        default: 0
    },
    dimensions: {
        height: Number,
        width: Number,
        depth: Number,
        unit: { type: String, default: 'cm' }
    },
    weight: {
        value: Number,
        unit: { type: String, default: 'kg' }
    },
    materials: [{
        type: String,
        trim: true
    }],
    averageRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    reviewCount: {
        type: Number,
        default: 0
    },
    viewCount: {
        type: Number,
        default: 0
    },
    isCollectionFeatured: {
        type: Boolean,
        default: false
    },
    priceHistory: [{
        price: { type: Number, required: true },
        compareAtPrice: { type: Number },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: { type: String, trim: true }
    }],
    discountPercentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    }
}, {
    timestamps: true
});

// Generate slug before saving + track price changes
productSchema.pre('save', function () {
    if (this.isModified('name')) {
        this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
    
    // Auto-track price changes
    if (this.isModified('price') || this.isModified('compareAtPrice')) {
        // Don't log on first creation (no previous price to compare)
        if (!this.isNew) {
            this.priceHistory.push({
                price: this.price,
                compareAtPrice: this.compareAtPrice || null,
                changedAt: new Date(),
                reason: this.compareAtPrice && this.compareAtPrice > this.price ? 'discount' : 'price_update'
            });
        }
    }
    
    // Auto-calculate discount percentage
    if (this.compareAtPrice && this.compareAtPrice > this.price) {
        this.discountPercentage = Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100);
    } else {
        this.discountPercentage = 0;
    }
});

// Indexes for search and query performance
// Includes Arabic fields for bilingual search support
productSchema.index({ name: 'text', nameAr: 'text', description: 'text', descriptionAr: 'text', tags: 'text' });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ additionalCategories: 1, isActive: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
productSchema.index({ isNewArrival: 1, isActive: 1 });
productSchema.index({ viewCount: -1 });

module.exports = mongoose.model('Product', productSchema);
