const jwt = require('jsonwebtoken');
const User = require('../models/User');
const tokens = require('../services/tokenService');

/**
 * ARTÉVA Maison — authentication and authorisation middleware.
 *
 * ── Why every 401 here carries a `code` ──
 *
 * The dashboard used to sign the user out on ANY 401, whatever it meant. That
 * is the root of the "Not Authorized, please log in again" reports: entering
 * the wrong revenue password answered 401, the client read it as "your session
 * is dead", deleted the JWT, and every request after that failed for real. The
 * admin had done nothing wrong and their session was still perfectly valid.
 *
 * So the two cases are now told apart in the protocol rather than guessed at
 * by the client:
 *
 *   · SESSION_* codes (below) mean "this credential is no good" — the client
 *     should refresh, or failing that, sign out.
 *   · Every other failure — including a wrong password typed into a form on an
 *     authenticated page — is a 403 or a 400. The session is untouched.
 *
 * Anything answering 401 without a SESSION_* code is a bug.
 */

/** The client clears the session on exactly these, and nothing else. */
const SESSION_CODES = {
    NO_TOKEN: 'SESSION_NO_TOKEN',
    EXPIRED: 'SESSION_EXPIRED',
    INVALID: 'SESSION_INVALID',
    USER_GONE: 'SESSION_USER_GONE',
};

function sessionFailure(res, code, message) {
    return res.status(401).json({ success: false, code, message });
}

/** Pull the bearer token off a request, wherever it was put. */
function extractToken(req) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        return header.slice(7).trim();
    }
    // Receipt preview URLs are opened in a new tab, which cannot carry a
    // header. Deliberately last, so a header always wins.
    if (req.query.token) return String(req.query.token);
    return null;
}

// Protect routes - require authentication
const protect = async (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
        return sessionFailure(res, SESSION_CODES.NO_TOKEN, 'Not authorized, no token');
    }

    let decoded;
    try {
        decoded = tokens.verifyAccessToken(token);
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return sessionFailure(
                res,
                SESSION_CODES.EXPIRED,
                'Your session has expired. Refreshing…'
            );
        }
        return sessionFailure(res, SESSION_CODES.INVALID, 'Not authorized, token failed');
    }

    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
        return sessionFailure(
            res,
            SESSION_CODES.USER_GONE,
            'Not authorized, user no longer exists'
        );
    }

    next();
};

/**
 * Build a role guard.
 *
 * Every guard in this file is one of these, so "which roles does this endpoint
 * admit" is answerable by reading one line rather than by comparing four
 * hand-written `if` chains that had drifted apart.
 *
 * Always 403, never 401: the caller is authenticated, they are simply not
 * allowed. Answering 401 here is what made the client destroy good sessions.
 */
function requireRole(roles, message) {
    const allowed = new Set(roles);
    return (req, res, next) => {
        if (req.user && allowed.has(req.user.role)) return next();
        return res.status(403).json({
            success: false,
            code: 'FORBIDDEN_ROLE',
            message: message || 'You do not have access to this resource.',
        });
    };
}

/**
 * Full dashboard access.
 *
 * `cashier` is deliberately absent. Counter staff reach exactly the handful of
 * endpoints listed under `cashierOrAdmin`, and everything guarded by `admin`
 * — orders, customers, revenue, settings, analytics — refuses them at the API,
 * so hiding the sidebar items is presentation, not protection.
 */
const admin = requireRole(
    ['admin', 'owner', 'superuser'],
    'Not authorized as admin'
);

/**
 * Endpoints a cashier needs in order to ring up a sale, and nothing else:
 * creating an invoice, and reading the product list it is built from.
 */
const cashierOrAdmin = requireRole(
    ['cashier', 'admin', 'owner', 'superuser'],
    'Not authorized to create invoices'
);

/** Strictly counter staff — used to narrow responses, not to grant access. */
const isCashier = (req) => req.user?.role === 'cashier';

// Owner (includes superuser)
const owner = requireRole(
    ['owner', 'superuser'],
    'Not authorized as owner'
);

/**
 * Strictly the shop owner — superuser is NOT admitted.
 *
 * `superuser` is the developer account: it exists to administer the system and
 * is deliberately kept out of the takings. `owner` is the person who owns the
 * business, and revenue is theirs to see. Everywhere else superuser inherits
 * owner's powers; this is the one place the two roles diverge, so it needs its
 * own guard rather than reusing `owner`.
 */
const ownerOnly = requireRole(
    ['owner'],
    'Revenue is restricted to the owner account.'
);

/**
 * Second factor on top of `ownerOnly`: a short-lived token minted by
 * POST /admin/revenue-auth after the owner re-enters their revenue password.
 *
 * Being logged in as the owner is not enough to read revenue — an unattended
 * open session would otherwise expose it. The token is scoped so an ordinary
 * login JWT cannot be passed off as one.
 */
const revenueUnlocked = (req, res, next) => {
    const token = req.headers['x-revenue-token'] || req.query.revenueToken;

    // 403, not 401, on purpose: the login session is perfectly valid, it just
    // has not been unlocked. A 401 would make the client discard the JWT and
    // sign the owner out of the whole dashboard.
    if (!token) {
        return res.status(403).json({
            success: false,
            code: 'REVENUE_LOCKED',
            message: 'Revenue password required.'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.scope !== 'revenue' || String(decoded.id) !== String(req.user._id)) {
            throw new Error('wrong scope');
        }
        next();
    } catch {
        return res.status(403).json({
            success: false,
            code: 'REVENUE_LOCKED',
            message: 'Revenue session expired. Please re-enter your revenue password.'
        });
    }
};

// Admin only (not owner) middleware (includes superuser)
const adminOnly = requireRole(
    ['admin', 'superuser'],
    'Not authorized as admin'
);

// Optional auth - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
    const token = extractToken(req);
    if (token) {
        try {
            const decoded = tokens.verifyAccessToken(token);
            req.user = await User.findById(decoded.id).select('-password');
        } catch {
            // Token invalid, but we continue anyway
            req.user = null;
        }
    }
    next();
};

// Driver middleware (also allows admin, owner and superuser access)
const driver = requireRole(
    ['driver', 'admin', 'owner', 'superuser'],
    'Not authorized as driver'
);

module.exports = {
    protect,
    requireRole,
    admin,
    adminOnly,
    cashierOrAdmin,
    isCashier,
    owner,
    ownerOnly,
    revenueUnlocked,
    driver,
    optionalAuth,
    SESSION_CODES,
};
