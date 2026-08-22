/**
 * ARTÉVA Maison — keeps the WhatsApp access token alive.
 *
 * Meta's long-lived tokens last 60 days, and re-exchanging one before it dies
 * returns a fresh 60 days. Left alone, WhatsApp therefore stops working roughly
 * every two months — silently, because a dead token looks exactly like a
 * misconfigured one, and the first sign is a customer not getting their order
 * confirmation.
 *
 * This closes that loop: check daily, renew when the remaining life falls below
 * a threshold, store the new token where every instance can see it, and email
 * the owner either way. The renewal happens with weeks to spare, so a failed
 * attempt is a warning rather than an outage.
 *
 * ── What it cannot do ──
 *
 * A permanent System User token never expires and needs none of this — the
 * refresher recognises one and stands down. And if renewal ever fails for the
 * full remaining window (Meta revoked it, the app secret changed), no code can
 * fix that; the emails exist so a human finds out in time to act.
 */

const WhatsAppToken = require('../models/WhatsAppToken');

/** Renew once the token has less than this left. */
const RENEW_BELOW_DAYS = Number(process.env.WHATSAPP_TOKEN_RENEW_DAYS) || 15;

/** Start warning by email at this point, even if renewal is not due. */
const WARN_BELOW_DAYS = Number(process.env.WHATSAPP_TOKEN_WARN_DAYS) || 7;

/** One check a day is plenty for a 60-day clock. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Do not send the same warning more than once a day. */
const ALERT_COOLDOWN_MS = 20 * 60 * 60 * 1000;

const GRAPH = 'https://graph.facebook.com/v25.0';

function creds() {
    return {
        appId: process.env.WHATSAPP_APP_ID || '',
        appSecret: process.env.WHATSAPP_APP_SECRET || '',
    };
}

/** Ask Meta what a token actually is and when it dies. */
async function inspect(token) {
    const { appId, appSecret } = creds();
    if (!appId || !appSecret) {
        return { ok: false, error: 'WHATSAPP_APP_ID / WHATSAPP_APP_SECRET are not set' };
    }

    const url = `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`
        + `&access_token=${encodeURIComponent(appId + '|' + appSecret)}`;

    try {
        const res = await fetch(url);
        const body = await res.json();
        if (body.error) return { ok: false, error: body.error.message };

        const d = body.data || {};
        return {
            ok: true,
            valid: Boolean(d.is_valid),
            // expires_at 0 means "never" — a system user token.
            expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
            scopes: d.scopes || [],
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/** Exchange a long-lived token for a new one with a full 60 days. */
async function exchange(token) {
    const { appId, appSecret } = creds();
    const url = `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
        + `&client_id=${encodeURIComponent(appId)}`
        + `&client_secret=${encodeURIComponent(appSecret)}`
        + `&fb_exchange_token=${encodeURIComponent(token)}`;

    try {
        const res = await fetch(url);
        const body = await res.json();
        if (body.error) return { ok: false, error: body.error.message };
        if (!body.access_token) return { ok: false, error: 'Meta returned no token' };

        return {
            ok: true,
            token: body.access_token,
            expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null,
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Put a token into circulation: persist it, update the running process, and
 * tell the client to re-read. Without the last step the process keeps using
 * the old string until it restarts.
 */
async function adopt(token, expiresAt, source) {
    await WhatsAppToken.findOneAndUpdate(
        { singleton: 'whatsapp' },
        { token, expiresAt, source, refreshedAt: new Date(), lastError: null },
        { upsert: true, setDefaultsOnInsert: true }
    );

    process.env.WHATSAPP_ACCESS_TOKEN = token;
    try {
        require('./whatsappCloudClient').refresh();
    } catch { /* client not loaded in this context — env is enough */ }
}

/** Email the owner. Never throws: a failed alert must not fail the check. */
async function notify(subject, lines) {
    try {
        const { sendEmail } = require('./emailService');
        const to = process.env.WHATSAPP_ALERT_EMAIL
            || process.env.ADMIN_EMAIL
            || process.env.OWNER_EMAIL;

        if (!to) {
            console.warn('[WA-TOKEN] No alert address set (WHATSAPP_ALERT_EMAIL) — not emailing');
            return;
        }

        await sendEmail({
            to,
            subject,
            html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                  <div style="background:#8b7355;padding:18px;text-align:center">
                    <h1 style="color:#fff;margin:0;font-size:20px">ARTÉVA MAISON</h1>
                  </div>
                  <div style="padding:24px;background:#f9f7f2;color:#2c241b">
                    <h2 style="margin-top:0;font-size:17px">${subject}</h2>
                    ${lines.map(l => `<p style="margin:8px 0">${l}</p>`).join('')}
                  </div>
                </div>`,
        });
        console.log(`[WA-TOKEN] Emailed "${subject}" to ${to}`);
    } catch (err) {
        console.error(`[WA-TOKEN] Could not send alert: ${err.message}`);
    }
}

/**
 * One pass: work out how long is left and act.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] renew regardless of how much time remains
 * @returns {Promise<object>} what happened, for the script's exit code
 */
async function checkAndRefresh({ force = false } = {}) {
    const stored = await WhatsAppToken.findOne({ singleton: 'whatsapp' });
    const token = stored?.token || process.env.WHATSAPP_ACCESS_TOKEN;

    if (!token) {
        return { status: 'no-token', message: 'No WhatsApp token configured' };
    }

    const info = await inspect(token);
    if (!info.ok) {
        await notify('WhatsApp token check failed', [
            `Could not verify the WhatsApp token: <b>${info.error}</b>`,
            'WhatsApp messaging may still be working — this is the CHECK failing, not necessarily the token.',
        ]);
        return { status: 'check-failed', message: info.error };
    }

    if (!info.valid) {
        await notify('⚠ WhatsApp token is INVALID — messaging is down', [
            'Meta reports the access token as no longer valid, so order confirmations and the chatbot have stopped.',
            'Generate a new token and set <code>WHATSAPP_ACCESS_TOKEN</code>, then run <code>npm run wa:token -- --force</code>.',
        ]);
        return { status: 'invalid', message: 'Token is not valid' };
    }

    // A system user token has no expiry and needs nothing from us.
    if (!info.expiresAt) {
        if (stored?.expiresAt) await adopt(token, null, stored.source || 'manual');
        return { status: 'permanent', message: 'Token does not expire — nothing to do' };
    }

    const daysLeft = Math.round((info.expiresAt.getTime() - Date.now()) / 86400000);

    // Keep the stored copy honest even when no action is needed.
    if (stored && (!stored.expiresAt || stored.expiresAt.getTime() !== info.expiresAt.getTime())) {
        stored.expiresAt = info.expiresAt;
        await stored.save().catch(() => {});
    }

    if (!force && daysLeft > RENEW_BELOW_DAYS) {
        console.log(`[WA-TOKEN] ${daysLeft} days left — no action needed`);
        return { status: 'ok', daysLeft };
    }

    console.log(`[WA-TOKEN] ${daysLeft} days left — renewing`);
    const renewed = await exchange(token);

    if (!renewed.ok) {
        const cooled = stored?.lastAlertAt
            && Date.now() - stored.lastAlertAt.getTime() < ALERT_COOLDOWN_MS;

        if (!cooled || daysLeft <= WARN_BELOW_DAYS) {
            await notify('⚠ WhatsApp token renewal failed', [
                `The token expires in <b>${daysLeft} day(s)</b> and automatic renewal failed.`,
                `Reason: <b>${renewed.error}</b>`,
                'WhatsApp will stop working when it expires. Generate a fresh token in the Meta dashboard and update <code>WHATSAPP_ACCESS_TOKEN</code>.',
            ]);
            if (stored) {
                stored.lastAlertAt = new Date();
                stored.lastError = renewed.error;
                await stored.save().catch(() => {});
            }
        }
        return { status: 'renew-failed', daysLeft, message: renewed.error };
    }

    await adopt(renewed.token, renewed.expiresAt, force ? 'manual' : 'auto');

    const newDays = renewed.expiresAt
        ? Math.round((renewed.expiresAt.getTime() - Date.now()) / 86400000)
        : null;

    await notify('WhatsApp token renewed', [
        `The WhatsApp access token was renewed automatically and now expires in <b>${newDays} days</b>.`,
        'No action is needed. This email exists so a silent failure later is noticeable by its absence.',
        '<small>Renewing a long-lived token returns a fresh 60 days, so this can continue indefinitely without anyone logging into Meta.</small>',
    ]);

    return { status: 'renewed', daysLeft: newDays };
}

/**
 * Load the stored token at boot.
 *
 * The database wins over the environment, because the environment holds
 * whatever was pasted in months ago while the database holds whatever the
 * refresher last obtained. Env is the seed for a first run.
 */
async function loadStoredToken() {
    try {
        const stored = await WhatsAppToken.findOne({ singleton: 'whatsapp' });

        if (stored?.token) {
            process.env.WHATSAPP_ACCESS_TOKEN = stored.token;
            try { require('./whatsappCloudClient').refresh(); } catch { /* not loaded */ }

            const days = stored.daysRemaining();
            console.log(`[WA-TOKEN] Loaded stored token${days === null ? ' (no expiry)' : ` — ${days} days left`}`);
            return true;
        }

        // First run: adopt whatever is in the environment so there is a row to
        // renew from next time.
        if (process.env.WHATSAPP_ACCESS_TOKEN) {
            const info = await inspect(process.env.WHATSAPP_ACCESS_TOKEN);
            await adopt(process.env.WHATSAPP_ACCESS_TOKEN, info.ok ? info.expiresAt : null, 'env');
            console.log('[WA-TOKEN] Seeded the token store from the environment');
            return true;
        }
    } catch (err) {
        console.error(`[WA-TOKEN] Could not load stored token: ${err.message}`);
    }
    return false;
}

/** Seed from the database, then check once a day. */
function startTokenScheduler() {
    if (process.env.WHATSAPP_TOKEN_AUTORENEW === 'false') {
        console.log('[WA-TOKEN] Auto-renewal disabled by configuration');
        return;
    }

    loadStoredToken()
        .then(() => checkAndRefresh())
        .catch(err => console.error(`[WA-TOKEN] Initial check failed: ${err.message}`));

    setInterval(() => {
        checkAndRefresh().catch(err =>
            console.error(`[WA-TOKEN] Scheduled check failed: ${err.message}`));
    }, CHECK_INTERVAL_MS).unref();

    console.log('[WA-TOKEN] Token auto-renewal active (daily check)');
}

module.exports = {
    checkAndRefresh,
    loadStoredToken,
    startTokenScheduler,
    inspect,
    exchange,
    RENEW_BELOW_DAYS,
};
