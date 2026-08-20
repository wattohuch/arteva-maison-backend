/**
 * ARTÉVA Maison — Token service
 *
 * One place that mints and verifies every credential the app issues, so the
 * claims on a token and the checks made against it cannot drift apart.
 *
 * ── Why there are two tokens ──
 *
 * The dashboard used to carry a single 30-day JWT. That is a long time for a
 * bearer token to sit in localStorage on a shared counter machine, and it left
 * no way to end a session server-side: the only revocation available was
 * waiting a month. Lengthening it further — the tempting fix for "I keep
 * getting logged out" — makes that worse rather than better.
 *
 * So:
 *   · ACCESS token  — short-lived (default 2h), sent as `Authorization:
 *     Bearer`. Stateless: no database read to validate beyond loading the user.
 *   · REFRESH token — long-lived (default 30d), used only against
 *     POST /api/auth/refresh. Stored on the user document as a SHA-256 hash,
 *     so a database leak does not hand out sessions, and so logout can revoke
 *     it for real.
 *
 * Refresh tokens ROTATE: spending one invalidates it and issues a replacement.
 * A token presented after it has already been spent is treated as theft and
 * every session for that user is dropped — the standard reuse-detection
 * response, and the reason rotation is worth the extra bookkeeping.
 *
 * ── Legacy tokens ──
 *
 * Tokens minted before this file existed carry no `type` claim. They are
 * accepted as access tokens (see `verifyAccessToken`) so that deploying this
 * does not sign out every admin mid-shift. They expire on their original
 * schedule and are replaced by the two-token pair at the next login.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/** How long an access token is good for. Short by design. */
const ACCESS_TTL = process.env.JWT_ACCESS_EXPIRES_IN || '2h';

/** How long a refresh token — and therefore a session — can live. */
const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_EXPIRES_DAYS) || 30;

/** Most simultaneous sessions one account may hold (phone + counter + laptop…). */
const MAX_SESSIONS = 8;

/** Token type claims. Present on everything this file mints. */
const TYPE_ACCESS = 'access';
const TYPE_REFRESH = 'refresh';

function secret() {
    const value = process.env.JWT_SECRET;
    if (!value) throw new Error('JWT_SECRET is not set');
    return value;
}

/**
 * Refresh tokens are stored hashed, never in the clear.
 *
 * SHA-256 rather than bcrypt on purpose: the token is 256 bits of CSPRNG
 * output, so there is no low-entropy secret for an attacker to grind and
 * nothing for a slow KDF to buy. It also means the lookup is a single indexed
 * comparison instead of a bcrypt run per stored session.
 */
function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Sign a short-lived access token. */
function generateAccessToken(userId) {
    return jwt.sign(
        { id: String(userId), type: TYPE_ACCESS },
        secret(),
        { expiresIn: ACCESS_TTL }
    );
}

/**
 * Mint a refresh token and the record that should be persisted alongside it.
 *
 * The `jti` lets a specific session be named — that is what makes "log out of
 * this device" possible without dropping the others.
 *
 * @returns {{ token: string, record: { jti, tokenHash, expiresAt, createdAt, userAgent } }}
 */
function generateRefreshToken(userId, { userAgent = '' } = {}) {
    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    const token = jwt.sign(
        { id: String(userId), type: TYPE_REFRESH, jti },
        secret(),
        { expiresIn: `${REFRESH_TTL_DAYS}d` }
    );

    return {
        token,
        record: {
            jti,
            tokenHash: hashRefreshToken(token),
            expiresAt,
            createdAt: new Date(),
            // Truncated: this is a diagnostic label for the sessions list, not
            // a fingerprint worth storing in full.
            userAgent: String(userAgent).slice(0, 160),
        },
    };
}

/**
 * Verify an access token.
 *
 * A token with no `type` claim is accepted: those are the pre-refresh tokens
 * still in circulation. A token that is explicitly a REFRESH token is refused
 * — otherwise the long-lived credential could be replayed as a short-lived one
 * and the split would buy nothing.
 *
 * @throws {jwt.JsonWebTokenError} on anything invalid or expired.
 */
function verifyAccessToken(token) {
    const decoded = jwt.verify(token, secret());
    if (decoded.type && decoded.type !== TYPE_ACCESS) {
        const err = new jwt.JsonWebTokenError('wrong token type');
        err.tokenType = decoded.type;
        throw err;
    }
    return decoded;
}

/** Verify a refresh token. Refuses anything that is not explicitly one. */
function verifyRefreshToken(token) {
    const decoded = jwt.verify(token, secret());
    if (decoded.type !== TYPE_REFRESH || !decoded.jti) {
        throw new jwt.JsonWebTokenError('not a refresh token');
    }
    return decoded;
}

/**
 * Drop expired sessions and trim the oldest ones past `MAX_SESSIONS`.
 *
 * Without this the array grows without bound — every login on every device for
 * the life of the account — and an unbounded array on a hot document is a real
 * cost on a collection this small.
 */
function pruneSessions(sessions = []) {
    const now = Date.now();
    return sessions
        .filter(s => s?.expiresAt && new Date(s.expiresAt).getTime() > now)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, MAX_SESSIONS);
}

/**
 * Issue a fresh access+refresh pair and persist the refresh side on the user.
 *
 * `replaceJti` is set when rotating: the session being spent is removed in the
 * same write that adds its replacement, so there is never a window in which
 * both are valid.
 */
async function issueSession(user, { userAgent = '', replaceJti = null } = {}) {
    const accessToken = generateAccessToken(user._id);
    const { token: refreshToken, record } = generateRefreshToken(user._id, { userAgent });

    const kept = pruneSessions(user.refreshTokens || [])
        .filter(s => !replaceJti || s.jti !== replaceJti);

    user.refreshTokens = pruneSessions([record, ...kept]);
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken, expiresIn: ACCESS_TTL };
}

/** Revoke one session. Returns true when a matching session was actually held. */
async function revokeSession(user, jti) {
    const before = (user.refreshTokens || []).length;
    user.refreshTokens = pruneSessions(user.refreshTokens || []).filter(s => s.jti !== jti);
    await user.save({ validateBeforeSave: false });
    return user.refreshTokens.length < before;
}

/** Revoke everything. Used on refresh-token reuse and on password change. */
async function revokeAllSessions(user) {
    user.refreshTokens = [];
    await user.save({ validateBeforeSave: false });
}

module.exports = {
    ACCESS_TTL,
    REFRESH_TTL_DAYS,
    MAX_SESSIONS,
    TYPE_ACCESS,
    TYPE_REFRESH,
    hashRefreshToken,
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    pruneSessions,
    issueSession,
    revokeSession,
    revokeAllSessions,
};
