const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

/**
 * Runs a set of express-validator chains and turns any failures into the same
 * error shape everything else on this API produces.
 *
 * Before this existed, `express-validator` was a declared dependency that
 * nothing imported: every endpoint took `req.body` on trust and relied on
 * Mongoose to reject bad input at save time. That produced inconsistent
 * results — a missing field surfaced as a 400 ValidationError, a wrong *type*
 * often did not surface at all (Mongoose casts "5" to 5, `{}` to a subdocument)
 * and anything not persisted, like a status string or a pair of coordinates,
 * was never checked at all.
 *
 * Validation belongs in front of the controller, not inside the database
 * driver. Failures are raised as ApiError so the central handler formats them,
 * which keeps `{ success, code, message, details, requestId }` identical to
 * every other failure the client already handles.
 *
 * @param {Array} chains express-validator chains to run
 */
const validate = (chains) => [
    ...chains,
    (req, res, next) => {
        const result = validationResult(req);
        if (result.isEmpty()) return next();

        // `field: message` pairs, matching the shape the Mongoose branch of the
        // error handler already emits, so clients parse one thing, not two.
        const details = result.array({ onlyFirstError: true }).map(e => ({
            field: e.path || e.param,
            message: e.msg,
        }));

        next(new ApiError(
            400,
            'VALIDATION_ERROR',
            details.map(d => d.message).join(', '),
            details
        ));
    },
];

module.exports = validate;
