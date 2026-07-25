const crypto = require('crypto');

/**
 * Attaches a short request id to every request so a client-visible error can be
 * matched to a specific server log line.
 */
const requestId = (req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomBytes(6).toString('hex');
    res.setHeader('X-Request-Id', req.id);
    next();
};

/**
 * Central error handler.
 *
 * Emits `{ success, code, message, requestId }` for every failure. `code` is a
 * stable UPPER_SNAKE identifier the frontend can branch on — previously every
 * unhandled throw collapsed into an untyped 500 carrying only a message, which
 * made a misconfigured payment gateway indistinguishable from a real fault.
 */
const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);
    let code = (typeof err.code === 'string' && /^[A-Z0-9_]+$/.test(err.code)) ? err.code : null;
    let message = err.message || 'Server Error';
    let details = err.details;

    // ── Normalise well-known error shapes ──

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        statusCode = 404;
        code = 'RESOURCE_NOT_FOUND';
        message = 'Resource not found';
    }

    // Mongoose duplicate key
    else if (err.code === 11000) {
        statusCode = 409;
        const field = err.keyValue ? Object.keys(err.keyValue)[0] : 'unknown';
        code = 'DUPLICATE_KEY';
        message = `Duplicate value for field: ${field}`;
        details = { field };
    }

    // Mongoose validation
    else if (err.name === 'ValidationError' && err.errors) {
        statusCode = 400;
        code = 'VALIDATION_ERROR';
        details = Object.entries(err.errors).map(([field, e]) => ({ field, message: e.message }));
        message = details.map(d => d.message).join(', ');
    }

    // JWT
    else if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        code = 'INVALID_TOKEN';
        message = 'Invalid authentication token';
    } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        code = 'TOKEN_EXPIRED';
        message = 'Session expired, please sign in again';
    }

    // Upstream HTTP failures that escaped a service layer
    else if (err.isAxiosError) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
            statusCode = 504;
            code = 'UPSTREAM_TIMEOUT';
            message = 'An upstream service did not respond in time';
        } else {
            statusCode = 502;
            code = 'UPSTREAM_ERROR';
            message = 'An upstream service returned an error';
        }
    }

    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) statusCode = 500;
    if (!code) code = statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';

    // ── Logging ──
    // Unexpected 5xx logs a stack. Operational failures we raised deliberately
    // (a gateway being down, a timeout) are single lines — they are expected
    // conditions, and stack-spamming them buries the ones that matter.
    const line = `[${new Date().toISOString()}] [${req.id || '-'}] ${req.method} ${req.originalUrl} → ${statusCode} ${code}: ${message}`;
    if (statusCode >= 500 && !err.isOperational) {
        console.error(line);
        console.error(err.stack || err);
    } else if (statusCode >= 500) {
        console.error(line, details ? JSON.stringify(details) : '');
    } else {
        console.warn(line);
    }

    // Never leak internals on an unexpected 500 in production.
    const safeMessage = (statusCode >= 500 && process.env.NODE_ENV === 'production' && !err.isOperational)
        ? 'Something went wrong on our end. Please try again.'
        : message;

    const body = {
        success: false,
        code,
        message: safeMessage,
        requestId: req.id,
    };
    if (details) body.details = details;
    if (process.env.NODE_ENV !== 'production' && statusCode >= 500) body.stack = err.stack;

    res.status(statusCode).json(body);
};

/** Wraps an async controller so rejections reach the error handler. */
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/** 404 for unmatched routes — keeps the shape consistent with real errors. */
const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: `Route not found: ${req.method} ${req.originalUrl}`,
        requestId: req.id,
    });
};

module.exports = { errorHandler, asyncHandler, requestId, notFoundHandler };
