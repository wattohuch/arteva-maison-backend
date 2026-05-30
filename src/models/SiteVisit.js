/**
 * ARTEVA Maison - Site Visit Model
 * Tracks actual website visits (page loads) by IP address.
 * Each document = one unique IP visiting the site in a day.
 * Separate from ProductView which only tracks product page views.
 */
const mongoose = require('mongoose');

const siteVisitSchema = new mongoose.Schema({
    ip: {
        type: String,
        required: true,
        index: true
    },
    date: {
        type: String, // YYYY-MM-DD format for daily uniqueness
        required: true,
        index: true
    },
    userAgent: {
        type: String,
        default: ''
    },
    referrer: {
        type: String,
        default: ''
    },
    page: {
        type: String,
        default: '/'
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 180 * 24 * 60 * 60 // Auto-delete after 180 days (6 months)
    }
});

// Compound index: one record per IP per day (true unique visitor tracking)
siteVisitSchema.index({ ip: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('SiteVisit', siteVisitSchema);
