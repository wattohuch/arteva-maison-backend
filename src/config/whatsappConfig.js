/**
 * ARTEVA Maison — WhatsApp configuration check
 *
 * Run once at boot. The point is that a half-configured integration announces
 * itself on startup rather than at 2am when an order confirmation silently
 * fails to send.
 *
 * Two levels, and the distinction matters:
 *
 *   Missing — the feature cannot work at all. Reported as an error.
 *   Weak    — it will work, but in a way that is unsafe or surprising in
 *             production. Reported as a warning.
 *
 * Nothing here reads or prints a secret's value. It reports only whether one
 * is present, because a startup log is one of the easiest places to leak a
 * token into a hosting provider's log retention.
 */

/** Required for any WhatsApp traffic at all. */
const REQUIRED = [
    ['WHATSAPP_ACCESS_TOKEN', 'the permanent system-user token from Business Manager'],
    ['WHATSAPP_PHONE_NUMBER_ID', 'the Phone number ID from WhatsApp > API Setup (not the phone number)'],
];

/** Required for the webhook — inbound messages and delivery receipts. */
const REQUIRED_FOR_WEBHOOK = [
    ['WHATSAPP_VERIFY_TOKEN', 'any random string; must match the Verify token in the Meta dashboard'],
    ['WHATSAPP_APP_SECRET', 'App dashboard > Settings > Basic > App secret — proves a webhook really came from Meta'],
];

/**
 * @returns {{ ok: boolean, missing: string[], warnings: string[], enabled: boolean }}
 */
function checkWhatsAppConfig() {
    const missing = [];
    const warnings = [];

    const has = (name) => Boolean(process.env[name] && String(process.env[name]).trim());

    // META_APP_SECRET was the original name and is still set in production.
    // Accepting both avoids an outage on the deploy that renames it.
    const hasAppSecret = has('WHATSAPP_APP_SECRET') || has('META_APP_SECRET');

    for (const [name, hint] of REQUIRED) {
        if (!has(name)) missing.push(`${name} is missing — ${hint}`);
    }

    for (const [name, hint] of REQUIRED_FOR_WEBHOOK) {
        if (name === 'WHATSAPP_APP_SECRET') {
            if (!hasAppSecret) missing.push(`${name} is missing — ${hint}`);
            continue;
        }
        if (!has(name)) missing.push(`${name} is missing — ${hint}`);
    }

    const enabled = has('WHATSAPP_ACCESS_TOKEN') && has('WHATSAPP_PHONE_NUMBER_ID');

    // ── Warnings: configured, but in a shape that will bite ──

    if (enabled && !has('WHATSAPP_BUSINESS_ACCOUNT_ID')) {
        warnings.push('WHATSAPP_BUSINESS_ACCOUNT_ID is not set — messaging works, but template management APIs will not.');
    }

    if (enabled && !has('PUBLIC_WEBHOOK_URL')) {
        warnings.push('PUBLIC_WEBHOOK_URL is not set — nothing breaks, but the setup docs use it to tell you what to paste into Meta.');
    }

    const version = process.env.WHATSAPP_API_VERSION;
    if (version && /^v(1[0-8])\./.test(version)) {
        warnings.push(`WHATSAPP_API_VERSION is ${version}, which Meta has retired or will soon. v21.0 or later is expected.`);
    }

    if (process.env.WHATSAPP_PI_FALLBACK === 'true') {
        warnings.push('WHATSAPP_PI_FALLBACK is on — failed Cloud API sends will be queued for the Raspberry Pi agent. Only leave this on if that agent is verified working.');
    }

    if (process.env.NODE_ENV === 'production' && !hasAppSecret) {
        warnings.push('The webhook will refuse every request until an app secret is set. This is deliberate: without it, anyone who knows the URL can forge customer messages.');
    }

    return { ok: missing.length === 0, missing, warnings, enabled };
}

/**
 * Print the result at startup.
 *
 * Does not exit the process. WhatsApp is one feature of a shop that also takes
 * payments and prints receipts, and refusing to boot the whole application
 * because a notification channel is unconfigured would turn a degraded feature
 * into an outage. The banner is loud enough not to be missed.
 */
function reportWhatsAppConfig() {
    const { ok, missing, warnings, enabled } = checkWhatsAppConfig();

    if (ok) {
        console.log('✅ WhatsApp Cloud API: configuration complete');
    } else if (enabled) {
        console.warn('⚠️  WhatsApp configuration incomplete:');
        missing.forEach(m => console.warn(`     ${m}`));
    } else {
        console.warn('╔══════════════════════════════════════════════════════════════╗');
        console.warn('║  WhatsApp Cloud API is NOT configured — no messages will     ║');
        console.warn('║  be sent or received.                                        ║');
        console.warn('╚══════════════════════════════════════════════════════════════╝');
        missing.forEach(m => console.warn(`     ${m}`));
        console.warn('     See docs/WHATSAPP_SETUP.md');
    }

    warnings.forEach(w => console.warn(`⚠️  ${w}`));

    return { ok, missing, warnings, enabled };
}

module.exports = { checkWhatsAppConfig, reportWhatsAppConfig };
