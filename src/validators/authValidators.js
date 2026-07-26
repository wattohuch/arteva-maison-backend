const { body } = require('express-validator');

/**
 * Auth input rules.
 *
 * Constraints here mirror what the User schema already enforces (email format,
 * 6-character minimum password, 50-character name) rather than inventing new
 * ones. The point is not to reject more requests than before — it is to reject
 * them *before* a database round trip, and with a typed VALIDATION_ERROR
 * carrying the offending field instead of a raw Mongoose error.
 *
 * Deliberately NOT using `normalizeEmail()`: it rewrites addresses (stripping
 * dots and +tags on some providers), which would stop existing accounts from
 * matching their stored email. Passwords are never trimmed for the same
 * reason — a password with a leading space is a valid password.
 */

const email = (field = 'email') =>
    body(field)
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Enter a valid email address');

const otp = body('otp')
    .trim()
    .notEmpty().withMessage('The OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('The OTP is 6 digits')
    .isNumeric().withMessage('The OTP is 6 digits');

const registerRules = [
    body('name')
        .trim()
        .notEmpty().withMessage('Name is required')
        .isLength({ max: 50 }).withMessage('Name cannot be more than 50 characters'),
    email(),
    body('password')
        .isString().withMessage('Password is required')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('phone')
        .optional({ values: 'falsy' })
        .trim()
        .isLength({ max: 30 }).withMessage('Phone number is too long'),
];

const loginRules = [
    email(),
    body('password').notEmpty().withMessage('Password is required'),
];

const forgotPasswordRules = [email()];

const verifyOtpRules = [email(), otp];

const resetPasswordRules = [
    email(),
    otp,
    body('newPassword')
        .isString().withMessage('A new password is required')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const verifyPasswordRules = [
    body('password').notEmpty().withMessage('Password is required'),
];

/**
 * Address writes. `coordinates` is optional because addresses predating the
 * map picker have none, but when present it has to be a real point — the
 * driver navigates to it.
 */
const addAddressRules = [
    body('street').trim().notEmpty().withMessage('Street address is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('label').optional({ values: 'falsy' }).trim().isLength({ max: 40 }),
    body('zipCode').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
    body('coordinates.lat')
        .optional({ values: 'falsy' })
        .isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
    body('coordinates.lng')
        .optional({ values: 'falsy' })
        .isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),
];

module.exports = {
    registerRules,
    loginRules,
    forgotPasswordRules,
    verifyOtpRules,
    resetPasswordRules,
    verifyPasswordRules,
    addAddressRules,
};
