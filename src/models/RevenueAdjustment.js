const mongoose = require('mongoose');

/**
 * An owner's correction to a revenue figure.
 *
 * ── Why a delta and not the number itself ──
 *
 * Revenue is derived from paid orders on every request, so it moves the moment
 * a sale lands. Storing the typed value would freeze the figure: type 40 when
 * the system says 38 and the card reads 40 forever, including after the next
 * order should have taken it to 65.
 *
 * So what is stored is the DIFFERENCE. Typing 40 against a computed 38 records
 * +2, and the card shows `computed + 2` from then on — 67 once the underlying
 * figure reaches 65. The correction survives; the number stays live. That is
 * what makes this semi-automatic rather than manual.
 *
 * ── Scope ──
 *
 * An adjustment belongs to the exact period it was entered against, identified
 * by the resolved date range. Editing "Today" does not silently alter "This
 * month": those are different windows, and a correction the owner made while
 * looking at one day is not evidence about the other. The UI says which period
 * an edit applies to for exactly this reason.
 *
 * `computedWhenSet` and `typedValue` are kept for the audit trail — together
 * they answer "what did the system say, what did the owner believe, and when",
 * which a bare delta cannot.
 */
const revenueAdjustmentSchema = new mongoose.Schema({
    /**
     * The window this correction applies to, as `YYYY-MM-DD:YYYY-MM-DD`.
     * Presets resolve to a range before they get here, so "today" and an
     * explicit single-day range are the same key — which is what the owner
     * would expect.
     */
    periodKey: {
        type: String,
        required: true,
        index: true,
    },

    /**
     * Which card was edited. Constrained so a typo cannot create a silent
     * adjustment that never displays anywhere.
     */
    field: {
        type: String,
        required: true,
        enum: ['net', 'gross', 'refunds', 'averageOrderValue', 'onlineGross', 'manualGross'],
    },

    /** Signed correction applied to the computed figure. */
    delta: {
        type: Number,
        required: true,
        default: 0,
    },

    /** What the aggregation returned at the moment the owner typed over it. */
    computedWhenSet: { type: Number, default: 0 },

    /** What the owner actually typed. `computedWhenSet + delta` by construction. */
    typedValue: { type: Number, default: 0 },

    /** Optional reason, so a figure that looks odd months later can be explained. */
    note: { type: String, trim: true, maxlength: 300 },

    setBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
}, { timestamps: true });

// One adjustment per field per period — setting it again updates in place
// rather than stacking corrections the owner cannot see or undo.
revenueAdjustmentSchema.index({ periodKey: 1, field: 1 }, { unique: true });

module.exports = mongoose.model('RevenueAdjustment', revenueAdjustmentSchema);
