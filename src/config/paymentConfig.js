/**
 * Payment gateway configuration guard.
 *
 * Every MyFatoorah call was previously made with whatever string happened to be
 * in MYFATOORAH_API_KEY. When that value is missing — or is still the
 * `your_myfatoorah_api_key_here` placeholder shipped in the setup docs — the
 * gateway answers 401, axios throws, and the controller surfaced a bare
 * HTTP 500 with no indication of what was wrong.
 *
 * This module detects an unusable configuration up front so the API can return
 * an accurate, machine-readable response instead.
 */

/** Placeholder values that appear in the setup guides and .env templates. */
const PLACEHOLDERS = new Set([
    'your_myfatoorah_api_key_here',
    'your_deema_test_api_key_here',
    'your_api_key_here',
    'changeme',
    'todo',
]);

function isUsableKey(value) {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
    // MyFatoorah and Deema both issue JWT-style keys, always well over 40 chars.
    // Anything shorter is a truncated paste or a leftover placeholder.
    if (trimmed.length < 40) return false;
    return true;
}

/**
 * @returns {{configured: boolean, reason: string|null, mode: string}}
 */
function getMyFatoorahStatus() {
    const key = process.env.MYFATOORAH_API_KEY;
    const mode = process.env.MYFATOORAH_MODE || 'test';

    if (!key || !key.trim()) {
        return { configured: false, reason: 'MYFATOORAH_API_KEY is not set', mode };
    }
    if (!isUsableKey(key)) {
        return {
            configured: false,
            reason: 'MYFATOORAH_API_KEY is a placeholder or truncated value',
            mode,
        };
    }
    return { configured: true, reason: null, mode };
}

function getDeemaStatus() {
    const key = process.env.DEEMA_API_KEY;
    const mode = process.env.DEEMA_MODE || 'test';

    if (!key || !key.trim()) {
        return { configured: false, reason: 'DEEMA_API_KEY is not set', mode };
    }
    if (!isUsableKey(key)) {
        return {
            configured: false,
            reason: 'DEEMA_API_KEY is a placeholder or truncated value',
            mode,
        };
    }
    return { configured: true, reason: null, mode };
}

/**
 * Logs a clear, actionable warning at boot for every unusable gateway.
 * Called once from server.js.
 */
function reportPaymentConfig(logger = console) {
    const mf = getMyFatoorahStatus();
    const deema = getDeemaStatus();

    if (mf.configured) {
        logger.log?.(`[PAYMENTS] MyFatoorah configured (${mf.mode} mode)`);
    } else {
        logger.error(
            `[PAYMENTS] ⚠️  MyFatoorah DISABLED — ${mf.reason}.\n` +
            `           KNET, card and Apple Pay will be hidden at checkout and\n` +
            `           /api/payments/execute will return 503 PAYMENT_GATEWAY_UNAVAILABLE.\n` +
            `           Set MYFATOORAH_API_KEY to the JWT from your MyFatoorah dashboard\n` +
            `           (Integration → API Key) to enable them.`
        );
    }

    if (deema.configured) {
        logger.log?.(`[PAYMENTS] Deema configured (${deema.mode} mode)`);
    } else {
        logger.error(`[PAYMENTS] ⚠️  Deema BNPL DISABLED — ${deema.reason}.`);
    }

    return { myfatoorah: mf, deema };
}

module.exports = {
    isUsableKey,
    getMyFatoorahStatus,
    getDeemaStatus,
    reportPaymentConfig,
};
