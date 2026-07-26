const jwt = require('jsonwebtoken');

// Generate JWT token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

// Format price for display
const formatPrice = (price, currency = 'KWD') => {
    return `${price.toFixed(3)} ${currency}`;
};

/**
 * Hard ceiling on page size, applied to every paginated query.
 *
 * `limit` comes straight off the query string, so without a cap `?limit=1e9`
 * asks the database for the entire collection and buffers it in memory — one
 * unauthenticated request was enough to do it. Clamped rather than rejected so
 * existing callers keep working; the admin screens that legitimately ask for
 * 10000 rows are noted as debt in AUDIT.md.
 */
const MAX_PAGE_SIZE = 10000;

// Paginate results
const paginate = (page = 1, limit = 12) => {
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);

    // Negative or non-numeric input previously produced a negative `skip`,
    // which MongoDB rejects outright.
    const pageNum = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limitNum = Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_PAGE_SIZE)
        : 12;

    const skip = (pageNum - 1) * limitNum;
    return { skip, limit: limitNum, page: pageNum };
};

// Build sort object from query string
const buildSortQuery = (sortBy) => {
    const sortOptions = {
        'price-asc': { price: 1 },
        'price-desc': { price: -1 },
        'name-asc': { name: 1 },
        'name-desc': { name: -1 },
        'newest': { createdAt: -1 },
        'oldest': { createdAt: 1 },
        'featured': { isFeatured: -1, createdAt: -1 }
    };
    return sortOptions[sortBy] || { sortOrder: 1, createdAt: -1 };
};

module.exports = {
    generateToken,
    formatPrice,
    paginate,
    buildSortQuery,
    MAX_PAGE_SIZE
};
