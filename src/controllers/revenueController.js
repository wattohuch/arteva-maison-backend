/**
 * ARTÉVA Maison — Revenue Controller
 *
 * One coherent revenue model over BOTH order sources.
 *
 * The numbers the owner sees are defined once, here:
 *
 *   gross   = sum of order totals for paid orders in range
 *   refunds = sum of refundAmount on those orders
 *   net     = gross - refunds            ← the headline figure
 *   discount= sum of promo discounts granted (already excluded from gross)
 *
 * `total` on an order is stored net of its discount, so gross must NOT have
 * discounts subtracted again — doing so was the easiest way to get this wrong,
 * hence the explicit note. Refunds are subtracted because a refunded sale is
 * money that left the business after the order was recorded.
 *
 * Every figure is computed in a single aggregation pipeline per grouping so the
 * dashboard is one round trip per view rather than one per card.
 */

const Order = require('../models/Order');
const PromoVisit = require('../models/PromoVisit');
const RevenueAdjustment = require('../models/RevenueAdjustment');
const { asyncHandler } = require('../middleware/error');

const round3 = (n) => parseFloat((Number(n) || 0).toFixed(3));

/** Orders that count as revenue. */
const PAID = { paymentStatus: 'paid' };

/**
 * Resolve the requested window. Defaults to the last 30 days, which is what
 * the dashboard opens on.
 */
function resolveRange(query) {
    const { from, to, preset } = query;
    const now = new Date();
    let start;
    let end = new Date(now);
    end.setHours(23, 59, 59, 999);

    if (from || to) {
        start = from ? new Date(from) : new Date(0);
        start.setHours(0, 0, 0, 0);
        if (to) {
            end = new Date(to);
            end.setHours(23, 59, 59, 999);
        }
    } else {
        switch (preset) {
            case 'today':
                start = new Date(now); start.setHours(0, 0, 0, 0);
                break;
            case 'week':
                start = new Date(now); start.setHours(0, 0, 0, 0);
                start.setDate(start.getDate() - start.getDay());
                break;
            case 'month':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'year':
                start = new Date(now.getFullYear(), 0, 1);
                break;
            case 'all':
                start = new Date(0);
                break;
            default:
                start = new Date(now); start.setHours(0, 0, 0, 0);
                start.setDate(start.getDate() - 29);
        }
    }

    return { start, end, preset: preset || (from || to ? 'custom' : '30d') };
}

/** Shared $group stage — every breakdown reports the same four measures. */
const MEASURES = {
    gross: { $sum: '$total' },
    refunds: { $sum: { $ifNull: ['$refundAmount', 0] } },
    discount: { $sum: { $ifNull: ['$discount', 0] } },
    orders: { $sum: 1 },
    items: { $sum: { $sum: '$items.quantity' } },
};

/** Turn a raw $group result into the public shape. */
function shape(row = {}) {
    const gross = row.gross || 0;
    const refunds = row.refunds || 0;
    return {
        gross: round3(gross),
        refunds: round3(refunds),
        // Net is the figure the owner should act on.
        net: round3(gross - refunds),
        discount: round3(row.discount || 0),
        orders: row.orders || 0,
        items: row.items || 0,
        averageOrderValue: row.orders ? round3(gross / row.orders) : 0,
    };
}


/**
 * Identify a window as `YYYY-MM-DD:YYYY-MM-DD`, in Kuwait time.
 *
 * Presets are resolved to a range before they reach here, so "today" and an
 * explicit one-day range produce the same key — an owner who corrects today's
 * figure and then re-picks the same dates sees their own correction, which is
 * the only behaviour that would not feel broken.
 */
function periodKeyFor(start, end) {
    const day = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuwait' });
    return `${day(start)}:${day(end)}`;
}

/** The fields an owner may correct. Mirrors the model's enum. */
const ADJUSTABLE = ['net', 'gross', 'refunds', 'averageOrderValue', 'onlineGross', 'manualGross'];

/**
 * Layer the owner's corrections onto the computed figures.
 *
 * Returns both numbers for every adjusted field rather than just the result:
 * the card has to be able to say "38.000 computed, +2.000 yours", and an owner
 * who cannot see what the system thinks has no way to notice when their own
 * correction has stopped making sense.
 */
function applyAdjustments(totals, bySourceShaped, adjustments) {
    const byField = new Map(adjustments.map(a => [a.field, a]));
    const meta = {};

    const adjust = (obj, field, key = field) => {
        const entry = byField.get(key);
        if (!entry) return;
        const computed = obj[field] || 0;
        obj[field] = round3(computed + entry.delta);
        meta[key] = {
            computed: round3(computed),
            delta: round3(entry.delta),
            adjusted: obj[field],
            note: entry.note || '',
            setAt: entry.updatedAt,
        };
    };

    adjust(totals, 'net');
    adjust(totals, 'gross');
    adjust(totals, 'refunds');
    adjust(totals, 'averageOrderValue');
    adjust(bySourceShaped.online, 'gross', 'onlineGross');
    adjust(bySourceShaped.manual, 'gross', 'manualGross');

    return meta;
}

// @desc    Unified revenue overview across online orders and manual receipts
// @route   GET /api/admin/revenue/overview
// @access  Private/Owner
//
// Query: from, to, preset, source=all|online|manual, promoCode
const getRevenueOverview = asyncHandler(async (req, res) => {
    const { start, end, preset } = resolveRange(req.query);
    const { source = 'all', promoCode } = req.query;

    const match = {
        ...PAID,
        createdAt: { $gte: start, $lte: end },
    };

    if (source === 'manual') match.orderSource = 'manual';
    // Orders predating orderSource are online orders.
    if (source === 'online') match.orderSource = { $in: ['online', null] };

    if (promoCode && promoCode !== 'all') {
        match['promoCode.code'] = String(promoCode).toUpperCase().trim();
    }

    // Daily buckets use Kuwait time (UTC+3) so "today" on the dashboard matches
    // the shop's day, not UTC's.
    const TZ = 'Asia/Kuwait';

    const [
        totals,
        bySource,
        byDay,
        byMonth,
        byPaymentMethod,
        byPromo,
        topProducts,
        recentOrders,
    ] = await Promise.all([
        Order.aggregate([{ $match: match }, { $group: { _id: null, ...MEASURES } }]),

        Order.aggregate([
            { $match: { ...PAID, createdAt: { $gte: start, $lte: end } } },
            { $group: { _id: { $ifNull: ['$orderSource', 'online'] }, ...MEASURES } },
        ]),

        Order.aggregate([
            { $match: match },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
                    ...MEASURES,
                    manualGross: {
                        $sum: { $cond: [{ $eq: ['$orderSource', 'manual'] }, '$total', 0] },
                    },
                    onlineGross: {
                        $sum: { $cond: [{ $eq: ['$orderSource', 'manual'] }, 0, '$total'] },
                    },
                },
            },
            { $sort: { _id: 1 } },
        ]),

        Order.aggregate([
            { $match: match },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: TZ } },
                    ...MEASURES,
                },
            },
            { $sort: { _id: 1 } },
        ]),

        Order.aggregate([
            { $match: match },
            { $group: { _id: { $ifNull: ['$paymentMethod', 'unknown'] }, ...MEASURES } },
            { $sort: { gross: -1 } },
        ]),

        Order.aggregate([
            { $match: { ...match, 'promoCode.code': { $ne: null } } },
            {
                $group: {
                    _id: '$promoCode.code',
                    name: { $first: '$promoCode.name' },
                    promoCodeId: { $first: '$promoCode.promoCodeId' },
                    ...MEASURES,
                },
            },
            { $sort: { gross: -1 } },
            { $limit: 25 },
        ]),

        // Product-level revenue excludes refunded lines — a refunded item did
        // not sell, and leaving it in overstates the best-sellers list.
        Order.aggregate([
            { $match: match },
            { $unwind: '$items' },
            { $match: { 'items.isRefunded': { $ne: true } } },
            {
                $group: {
                    _id: { $ifNull: ['$items.product', '$items.name'] },
                    name: { $first: '$items.name' },
                    nameAr: { $first: '$items.nameAr' },
                    image: { $first: '$items.image' },
                    units: { $sum: '$items.quantity' },
                    revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: 20 },
        ]),

        Order.find(match)
            .select('orderNumber total refundAmount orderSource paymentMethod paymentStatus promoCode createdAt user items')
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .limit(50)
            .lean(),
    ]);

    const sourceMap = bySource.reduce((acc, r) => ({ ...acc, [r._id]: r }), {});

    // The owner's corrections for exactly this window.
    const periodKey = periodKeyFor(start, end);
    const adjustments = await RevenueAdjustment.find({ periodKey }).lean();

    // Promo-driven traffic for the same window, so the owner can see reach as
    // well as redemption.
    const [promoTraffic] = await PromoVisit.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
            $group: {
                _id: null,
                visits: { $sum: 1 },
                uniqueVisitors: { $addToSet: '$visitorId' },
                conversions: { $sum: { $cond: ['$converted', 1, 0] } },
            },
        },
    ]);

    const shapedTotals = shape(totals[0]);
    const shapedBySource = {
        online: shape(sourceMap.online),
        manual: shape(sourceMap.manual),
    };

    /* Corrections are applied to the headline cards only, deliberately.
     *
     * The breakdowns below — by day, by product, by payment method — are
     * evidence about individual orders, and quietly bending them to match a
     * typed total would turn a correction into a falsified record. The cards
     * carry the owner's view; the tables keep saying what actually happened. */
    const adjustmentMeta = applyAdjustments(shapedTotals, shapedBySource, adjustments);

    res.json({
        success: true,
        data: {
            range: { from: start, to: end, preset },
            periodKey,
            adjustments: adjustmentMeta,
            totals: shapedTotals,
            bySource: shapedBySource,
            byDay: byDay.map(d => ({
                date: d._id,
                ...shape(d),
                onlineGross: round3(d.onlineGross),
                manualGross: round3(d.manualGross),
            })),
            byMonth: byMonth.map(m => ({ month: m._id, ...shape(m) })),
            byPaymentMethod: byPaymentMethod.map(p => ({ method: p._id, ...shape(p) })),
            byPromoCode: byPromo.map(p => ({
                code: p._id,
                name: p.name,
                promoCodeId: p.promoCodeId,
                ...shape(p),
            })),
            topProducts: topProducts.map(p => ({
                productId: String(p._id),
                name: p.name,
                nameAr: p.nameAr,
                image: p.image,
                units: p.units,
                revenue: round3(p.revenue),
            })),
            promoTraffic: {
                visits: promoTraffic?.visits || 0,
                uniqueVisitors: promoTraffic?.uniqueVisitors?.length || 0,
                conversions: promoTraffic?.conversions || 0,
            },
            recentOrders: recentOrders.map(o => ({
                _id: o._id,
                orderNumber: o.orderNumber,
                source: o.orderSource || 'online',
                customer: o.user ? { name: o.user.name, email: o.user.email } : null,
                total: round3(o.total),
                refundAmount: round3(o.refundAmount),
                net: round3((o.total || 0) - (o.refundAmount || 0)),
                paymentMethod: o.paymentMethod,
                promoCode: o.promoCode?.code || null,
                itemCount: (o.items || []).reduce((s, i) => s + (i.quantity || 0), 0),
                createdAt: o.createdAt,
            })),
        },
    });
});


// @desc    Correct a revenue figure for a period
// @route   PUT /api/admin/revenue/adjustments
// @access  Private/Owner + revenue unlocked
//
// Body: { field, value, from, to, preset, note }
//
// `value` is what the owner typed. What gets stored is the difference from the
// computed figure, so the card tracks new orders instead of freezing — see the
// model for why that distinction is the whole point.
const setRevenueAdjustment = asyncHandler(async (req, res) => {
    const { field, value, note } = req.body;

    if (!ADJUSTABLE.includes(field)) {
        res.status(400);
        throw new Error(`Cannot adjust "${field}".`);
    }

    const typed = Number(value);
    if (!Number.isFinite(typed)) {
        res.status(400);
        throw new Error('A revenue figure has to be a number.');
    }

    const { start, end } = resolveRange(req.query.from || req.body.from ? { ...req.body, ...req.query } : req.body);
    const periodKey = periodKeyFor(start, end);

    // Recompute the figure being corrected, so the stored delta is measured
    // against what the system says right now rather than a number the client
    // told us. A client-supplied baseline would let a stale page write a
    // correction that is wrong the moment it lands.
    const computed = await computeFigure(field, start, end);

    const doc = await RevenueAdjustment.findOneAndUpdate(
        { periodKey, field },
        {
            periodKey,
            field,
            delta: round3(typed - computed),
            computedWhenSet: round3(computed),
            typedValue: round3(typed),
            note: note || '',
            setBy: req.user._id,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    console.log(
        `[REVENUE] ${req.user.email} corrected ${field} for ${periodKey}: ` +
        `computed ${computed.toFixed(3)} → ${typed.toFixed(3)} (delta ${doc.delta.toFixed(3)})`
    );

    res.json({
        success: true,
        data: {
            field, periodKey,
            computed: round3(computed),
            delta: doc.delta,
            adjusted: round3(computed + doc.delta),
            note: doc.note,
        },
    });
});

// @desc    Drop a correction, returning the figure to what the orders say
// @route   DELETE /api/admin/revenue/adjustments/:field
// @access  Private/Owner + revenue unlocked
const clearRevenueAdjustment = asyncHandler(async (req, res) => {
    const { field } = req.params;

    if (!ADJUSTABLE.includes(field)) {
        res.status(400);
        throw new Error(`Cannot adjust "${field}".`);
    }

    const { start, end } = resolveRange(req.query);
    const periodKey = periodKeyFor(start, end);

    const removed = await RevenueAdjustment.findOneAndDelete({ periodKey, field });
    const computed = await computeFigure(field, start, end);

    console.log(
        `[REVENUE] ${req.user.email} reset ${field} for ${periodKey} ` +
        `(was ${removed ? removed.delta.toFixed(3) : '0.000'})`
    );

    res.json({
        success: true,
        data: { field, periodKey, computed: round3(computed), delta: 0, adjusted: round3(computed) },
    });
});

/**
 * The computed value of one adjustable field, server-side.
 *
 * Deliberately re-derived here rather than trusted from the request: the delta
 * is only meaningful relative to what the aggregation actually says, and a page
 * left open while orders arrived would otherwise write a correction against a
 * baseline that no longer exists.
 */
async function computeFigure(field, start, end) {
    const base = { ...PAID, createdAt: { $gte: start, $lte: end } };

    const sourceMatch =
        field === 'onlineGross' ? { ...base, orderSource: { $in: ['online', null] } }
        : field === 'manualGross' ? { ...base, orderSource: 'manual' }
        : base;

    const [row] = await Order.aggregate([{ $match: sourceMatch }, { $group: { _id: null, ...MEASURES } }]);
    const shaped = shape(row);

    switch (field) {
        case 'onlineGross':
        case 'manualGross':
            return shaped.gross;
        default:
            return shaped[field] || 0;
    }
}

module.exports = {
    getRevenueOverview,
    setRevenueAdjustment,
    clearRevenueAdjustment,
    resolveRange,
    round3,
};
