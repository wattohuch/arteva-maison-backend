/**
 * ARTÉVA Maison — WhatsApp transport via Twilio
 *
 * Deliberately the SAME shape as whatsappCloudClient: `sendText` and
 * `sendTemplate` returning `{ success, messageId, raw }` on success and
 * `{ success, error, permanent, code }` on failure. whatsappService picks
 * between the two by env var and needs to know nothing else, so switching
 * providers is a configuration change rather than a rewrite.
 *
 * ── Why Twilio at all ──
 *
 * Twilio is still Meta underneath — every official WhatsApp API is — but its
 * Sandbox works immediately, with no number registration and no Business
 * Manager. That means customer conversations can be running today and the
 * production number registered later, calmly, instead of both at once.
 *
 * ── Two things Twilio does differently from Meta ──
 *
 *  1. Addresses are `whatsapp:+965…`, not bare digits. The prefix is applied
 *     here so callers keep passing plain phone numbers.
 *  2. Templates are identified by Content SID (`HX…`), not by name. Meta names
 *     its templates; Twilio gives them an opaque id. `templateFor` in
 *     whatsappService returns whatever is configured, so a Twilio deployment
 *     puts the SID where a Meta deployment puts the name — see resolveTemplate.
 */

const axios = require('axios');

const API_ROOT = 'https://api.twilio.com/2010-04-01';

/** Twilio failures that will never succeed on a retry. */
const PERMANENT_ERROR_CODES = new Set([
    21211,  // invalid 'To' number
    21408,  // permission denied for that region
    21610,  // recipient has opted out — retrying is both futile and rude
    21614,  // 'To' is not a valid mobile number
    63003,  // channel could not be found (usually a bad From)
    63005,  // sender not opted into the sandbox
    63016,  // free-form outside the 24h window — needs a template, not a retry
    63024,  // invalid message body
]);

/** Transport-level conditions worth another attempt. */
const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);

const DEFAULT_TIMEOUT_MS = Number(process.env.TWILIO_TIMEOUT_MS) || 20000;
const MAX_ATTEMPTS = Number(process.env.TWILIO_MAX_ATTEMPTS) || 3;

class TwilioWhatsAppClient {
    get accountSid() { return process.env.TWILIO_ACCOUNT_SID || ''; }
    get authToken() { return process.env.TWILIO_AUTH_TOKEN || ''; }

    /**
     * The sender, as Twilio expects it.
     *
     * Accepts the number with or without the `whatsapp:` prefix and with or
     * without the `+`, because all three spellings appear in Twilio's own
     * console and docs and picking the wrong one fails with an opaque 63003.
     */
    get from() {
        const raw = (process.env.TWILIO_WHATSAPP_FROM || '').trim();
        if (!raw) return '';
        if (raw.startsWith('whatsapp:')) return raw;
        return `whatsapp:${raw.startsWith('+') ? raw : '+' + raw.replace(/\D/g, '')}`;
    }

    get isConfigured() {
        return Boolean(this.accountSid && this.authToken && this.from);
    }

    /** Why it is not configured, in the words of the variables to set. */
    missingConfig() {
        const missing = [];
        if (!this.accountSid) missing.push('TWILIO_ACCOUNT_SID — Console dashboard');
        if (!this.authToken) missing.push('TWILIO_AUTH_TOKEN — Console dashboard (keep secret)');
        if (!this.from) missing.push('TWILIO_WHATSAPP_FROM — e.g. +14155238886 for the Sandbox');
        return missing;
    }

    /** `whatsapp:+<digits>` for an arbitrary caller-supplied number. */
    toAddress(phone) {
        const digits = String(phone || '').replace(/\D/g, '');
        return digits ? `whatsapp:+${digits}` : '';
    }

    /**
     * One POST to the Messages endpoint, with retries on transient failure.
     *
     * Errors are classified rather than merely counted: a wrong number and a
     * momentary 503 both "fail", but retrying the first wastes the customer's
     * time and burns rate limit, while not retrying the second loses a real
     * message.
     */
    async _post(params, label) {
        if (!this.isConfigured) {
            return {
                success: false,
                permanent: true,
                code: null,
                error: `Twilio is not configured: ${this.missingConfig().join('; ')}`,
            };
        }

        const url = `${API_ROOT}/Accounts/${this.accountSid}/Messages.json`;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const res = await axios.post(url, new URLSearchParams(params).toString(), {
                    auth: { username: this.accountSid, password: this.authToken },
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: DEFAULT_TIMEOUT_MS,
                });

                /* Twilio answers 201 for "queued" — accepted, not delivered.
                 * Real delivery arrives later on the status webhook, which is
                 * why the message row is written with the SID: it is the only
                 * thing that later status callback can be matched against. */
                return {
                    success: true,
                    messageId: res.data?.sid || null,
                    status: res.data?.status || 'queued',
                    raw: { messages: [{ id: res.data?.sid }] },  // Meta-shaped, for callers
                };
            } catch (err) {
                const httpStatus = err.response?.status || null;
                const code = err.response?.data?.code ?? null;
                const message = err.response?.data?.message || err.message;

                const permanent = code !== null
                    ? PERMANENT_ERROR_CODES.has(Number(code))
                    : !(httpStatus === null || RETRYABLE_HTTP.has(httpStatus));

                lastError = { success: false, error: message, permanent, code, httpStatus };

                if (permanent || attempt === MAX_ATTEMPTS) {
                    console.error(`[TWILIO] ${label} failed (${code || httpStatus}): ${message}`);
                    return lastError;
                }

                const backoff = attempt * 1500;
                console.warn(`[TWILIO] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed (${message}) — retrying in ${backoff}ms`);
                await new Promise(r => setTimeout(r, backoff));
            }
        }

        return lastError;
    }

    /** Free-form text. Only reaches a customer inside the 24-hour window. */
    sendText(to, text) {
        const address = this.toAddress(to);
        if (!address) return Promise.resolve({ success: false, error: 'No recipient', permanent: true });

        return this._post({
            From: this.from,
            To: address,
            Body: String(text ?? ''),
        }, 'sendText');
    }

    /**
     * An approved template.
     *
     * Twilio identifies templates by Content SID, so `nameOrSid` is expected to
     * be an `HX…` value. A Meta-style template NAME cannot be resolved here —
     * Twilio has no lookup from name to SID on the Messages endpoint — so that
     * case fails loudly rather than silently sending nothing, which is the
     * failure mode that would otherwise only surface as a customer never
     * receiving their order confirmation.
     */
    sendTemplate(to, nameOrSid, _language, bodyParams = []) {
        const address = this.toAddress(to);
        if (!address) return Promise.resolve({ success: false, error: 'No recipient', permanent: true });

        if (!/^HX[0-9a-f]{32}$/i.test(String(nameOrSid || ''))) {
            return Promise.resolve({
                success: false,
                permanent: true,
                code: null,
                error:
                    `Twilio needs a Content SID (HX…), got "${nameOrSid}". ` +
                    `Set the WHATSAPP_TEMPLATE_* variable to the SID from ` +
                    `Twilio Console → Messaging → Content Template Builder.`,
            });
        }

        /* Twilio numbers its variables from "1", matching {{1}} in the template
         * body — the same convention Meta uses, so callers pass the same
         * ordered array to either provider. */
        const variables = {};
        bodyParams.forEach((v, i) => { variables[String(i + 1)] = String(v ?? ''); });

        return this._post({
            From: this.from,
            To: address,
            ContentSid: nameOrSid,
            ...(bodyParams.length ? { ContentVariables: JSON.stringify(variables) } : {}),
        }, `sendTemplate(${nameOrSid})`);
    }

    /** Whether the account and sender actually work, for the health endpoint. */
    async probe() {
        if (!this.isConfigured) {
            return { ok: false, error: this.missingConfig().join('; ') };
        }
        try {
            const res = await axios.get(`${API_ROOT}/Accounts/${this.accountSid}.json`, {
                auth: { username: this.accountSid, password: this.authToken },
                timeout: DEFAULT_TIMEOUT_MS,
            });
            return {
                ok: res.data?.status === 'active',
                accountStatus: res.data?.status,
                friendlyName: res.data?.friendly_name,
                from: this.from,
            };
        } catch (err) {
            return { ok: false, error: err.response?.data?.message || err.message };
        }
    }
}

module.exports = new TwilioWhatsAppClient();
module.exports.TwilioWhatsAppClient = TwilioWhatsAppClient;
module.exports.PERMANENT_ERROR_CODES = PERMANENT_ERROR_CODES;
