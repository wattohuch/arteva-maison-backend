/**
 * Custom NoSQL Injection Prevention Middleware
 * Compatible with Express 5.x (where req.query, req.body, req.params are read-only)
 * 
 * This middleware sanitizes user input by removing MongoDB operators ($, .) 
 * from query strings, request bodies, and URL parameters.
 * 
 * IMPORTANT: This runs AFTER body parsing but does NOT modify req.query/req.params
 * directly. Instead, it sanitizes req.body and provides sanitized versions via req.sanitized
 */

/**
 * Recursively sanitize an object by removing keys that start with $ or contain .
 * @param {*} obj - The object to sanitize
 * @returns {*} - Sanitized object
 */
function sanitizeObject(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }

    const sanitized = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            // Skip keys that start with $ or contain .
            if (key.startsWith('$') || key.includes('.')) {
                console.warn(`[SANITIZE] Removed dangerous key: ${key}`);
                continue;
            }
            sanitized[key] = sanitizeObject(obj[key]);
        }
    }
    return sanitized;
}

/**
 * Express middleware to sanitize request data
 * Works with Express 5.x by only sanitizing req.body (which is writable)
 * For query and params, we provide sanitized versions in req.sanitized
 */
function sanitizeRequest(req, res, next) {
    // Sanitize req.body (writable in Express 5.x)
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }

    // For req.query and req.params (read-only in Express 5.x), 
    // provide sanitized versions in req.sanitized for manual use if needed
    req.sanitized = {
        query: req.query ? sanitizeObject({ ...req.query }) : {},
        params: req.params ? sanitizeObject({ ...req.params }) : {}
    };

    next();
}

module.exports = sanitizeRequest;
