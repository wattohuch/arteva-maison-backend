/**
 * ARTEVA Maison - Product View Model
 * Tracks unique product views by IP address for analytics.
 * Each document = one unique IP viewing one product in a day.
 */
const mongoose = require('mongoose');

const productViewSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },
    ip: {
        type: String,
        required: true,
        index: true
    },
    userAgent: {
        type: String,
        default: ''
    },
    date: {
        type: String, // YYYY-MM-DD format for daily uniqueness
        required: true,
        index: true
    },
    country: String,
    city: String,
    referrer: String,
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 90 * 24 * 60 * 60 // Auto-delete after 90 days
    }
});

// Compound index: one view per IP per product per day
productViewSchema.index({ product: 1, ip: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('ProductView', productViewSchema);
