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
function sanitizeObject(obj, warn = false) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, warn));
    }

    const sanitized = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            // Skip keys that start with $ or contain .
            if (key.startsWith('$') || key.includes('.')) {
                /* Only announced for req.body, where the key really is dropped.
                 * req.query is read-only in Express 5, so the copy built below
                 * is advisory and nothing is removed from what handlers read —
                 * warning there claimed a protection that had not happened, and
                 * did it on every Meta webhook verification, whose parameters
                 * are legitimately named hub.mode, hub.challenge and so on. */
                if (warn) console.warn(`[SANITIZE] Removed dangerous key: ${key}`);
                continue;
            }
            sanitized[key] = sanitizeObject(obj[key], warn);
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
        req.body = sanitizeObject(req.body, true);
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
