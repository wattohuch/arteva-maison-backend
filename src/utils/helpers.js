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

// Paginate results
const paginate = (page = 1, limit = 12) => {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 12;
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
    return sortOptions[sortBy] || { createdAt: -1 };
};

module.exports = {
    generateToken,
    formatPrice,
    paginate,
    buildSortQuery
};
