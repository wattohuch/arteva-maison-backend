const { param, query } = require('express-validator');

/**
 * Rules shared across resources.
 *
 * An unchecked `:id` reaching Mongoose throws a CastError, which the error
 * handler already turns into a 404. Validating up front makes it a 400 with
 * the field named — the client asked wrongly, it is not that the thing is
 * missing — and avoids the query entirely.
 */

const mongoIdParam = (name = 'id') => [
    param(name).isMongoId().withMessage(`A valid ${name} is required`),
];

/**
 * Upper bound on page size.
 *
 * Not a tidy number like 100, because it cannot be: the admin visitor log asks
 * for `limit=1000` and the legacy admin bundle asks for `limit=10000`. Those
 * are real callers and capping below them would break working screens. This
 * ceiling exists to stop `limit=100000000` walking the entire collection into
 * memory, not to impose a sensible page size — see AUDIT.md, the admin screens
 * that fetch everything in one request are listed as outstanding debt.
 */
const MAX_PAGE_SIZE = 10000;

const paginationRules = [
    query('page')
        .optional({ values: 'falsy' })
        .isInt({ min: 1 }).withMessage('page must be 1 or greater')
        .toInt(),
    query('limit')
        .optional({ values: 'falsy' })
        .isInt({ min: 1, max: MAX_PAGE_SIZE }).withMessage(`limit must be between 1 and ${MAX_PAGE_SIZE}`)
        .toInt(),
];

module.exports = { mongoIdParam, paginationRules, MAX_PAGE_SIZE };
