/**
 * Error carrying an HTTP status and a stable machine-readable code.
 *
 * Throwing one of these from a controller lets the error middleware emit a
 * meaningful JSON body instead of collapsing everything into a bare 500.
 */
class ApiError extends Error {
    /**
     * @param {number} statusCode  HTTP status to send
     * @param {string} code        stable UPPER_SNAKE identifier for clients
     * @param {string} message     human-readable message (safe to display)
     * @param {object} [details]   optional extra context (field errors, etc.)
     */
    constructor(statusCode, code, message, details) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.code = code;
        if (details) this.details = details;
        this.isOperational = true;
        Error.captureStackTrace?.(this, ApiError);
    }

    static badRequest(code, message, details) {
        return new ApiError(400, code, message, details);
    }

    static unauthorized(message = 'Not authorized') {
        return new ApiError(401, 'UNAUTHORIZED', message);
    }

    static notFound(code, message) {
        return new ApiError(404, code, message);
    }

    static conflict(code, message) {
        return new ApiError(409, code, message);
    }

    /** Upstream provider returned an error or malformed response. */
    static badGateway(code, message, details) {
        return new ApiError(502, code, message, details);
    }

    /** Dependency is not configured or temporarily unavailable. */
    static unavailable(code, message, details) {
        return new ApiError(503, code, message, details);
    }

    /** Upstream provider did not answer in time. */
    static gatewayTimeout(code, message) {
        return new ApiError(504, code, message);
    }
}

module.exports = ApiError;
