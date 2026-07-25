/**
 * ARTÉVA Maison — Promo Visit Model
 *
 * One document per (promo code, visitor, day). Created when someone lands on
 * the site carrying a promo code — either via a share link (`?promo=CODE`) or
 * by typing the code at checkout.
 *
 * This is what turns a promo code from "a discount" into "a marketing channel":
 * a code that pulls 400 visits and 2 orders is a very different signal from one
 * that pulls 12 visits and 9 orders, and neither is visible from usageCount
 * alone.
 *
 * `visitorId` is an anonymous client-generated id kept in localStorage. IP is
 * stored alongside it purely so a cleared localStorage does not inflate the
 * unique count, and both age out with the document.
 */
const mongoose = require('mongoose');

const promoVisitSchema = new mongoose.Schema({
    promoCodeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PromoCode',
        required: true,
        index: true
    },
    code: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        index: true
    },
    // Anonymous per-browser identifier (localStorage), NOT a user id.
    visitorId: {
        type: String,
        required: true,
        index: true
    },
    // YYYY-MM-DD — gives us "unique visitors per day" without a time grouping.
    date: {
        type: String,
        required: true,
        index: true
    },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    referrer: { type: String, default: '' },
    landingPage: { type: String, default: '/' },
    // How the code reached the visitor.
    source: {
        type: String,
        enum: ['link', 'manual_entry'],
        default: 'link'
    },
    // Set to the logged-in user once the visitor authenticates, so we can tell
    // "anonymous browsing on a promo link" from "a known customer".
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // ── Conversion ──
    converted: { type: Boolean, default: false, index: true },
    convertedAt: Date,
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order'
    },
    // Order total at conversion time, denormalised so revenue-per-code reports
    // do not need to join every order back in.
    orderTotal: { type: Number, default: 0 },
    discountGiven: { type: Number, default: 0 },
    createdAt: {
        type: Date,
        default: Date.now,
        // Matches SiteVisit's retention so analytics windows line up.
        expires: 180 * 24 * 60 * 60
    }
});

// One row per visitor per code per day — repeat page loads bump `updatedAt`
// via upsert rather than creating duplicates that would inflate visit counts.
promoVisitSchema.index({ promoCodeId: 1, visitorId: 1, date: 1 }, { unique: true });
// Funnel queries: conversions for a code inside a date window.
promoVisitSchema.index({ promoCodeId: 1, converted: 1, createdAt: -1 });

module.exports = mongoose.model('PromoVisit', promoVisitSchema);
