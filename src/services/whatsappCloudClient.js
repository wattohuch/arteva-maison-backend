/**
 * ARTEVA Maison — WhatsApp Cloud API transport
 *
 * The single place in this codebase that speaks HTTP to Meta. Everything else
 * — order notifications, the AI reply path, the admin REST API — goes through
 * whatsappService, which goes through here. Raw axios calls to graph.facebook
 * .com scattered through controllers is how a project ends up with four
 * different retry policies and no idea which one dropped a message.
 *
 * Two things this layer exists to get right:
 *
 *   Retry classification. A 500 from Meta and an invalid recipient are both
 *   "the send failed", but retrying the first is correct and retrying the
 *   second is how a number gets rate-limited and eventually restricted. They
 *   are told apart by error code, not by guessing.
 *
 *   Never throwing at the caller. A WhatsApp outage must not fail a checkout.
 *   Every public method resolves to a result object; the only throws are
 *   programmer errors like a missing recipient.
 */

const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');

const DEFAULT_API_BASE = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v21.0';

/** Meta caps media at 16MB for most types; refuse earlier than they do. */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/*
 * Read at call time, not at module load.
 *
 * These were captured once when the file was first required, which meant any
 * change to the environment afterwards was silently ignored — including a test
 * turning the backoff down to keep a suite fast, and a Pi operator retuning a
 * timeout for a slow link without a restart. Reading them per call costs a
 * property lookup and removes a whole class of "I changed it and nothing
 * happened".
 */
const timeoutMs = () => Number(process.env.WHATSAPP_TIMEOUT_MS || 15000);
const maxAttempts = () => Number(process.env.WHATSAPP_MAX_ATTEMPTS || 3);
const baseBackoffMs = () => Number(process.env.WHATSAPP_BACKOFF_MS || 1000);

/**
 * Meta error codes that will never succeed on a retry.
 *
 * Retrying these is actively harmful: it burns quota, and repeated sends to an
 * invalid or unreachable recipient is one of the signals Meta uses to restrict
 * a number. Anything not listed here is treated as transient, which is the
 * safe default — a needless retry costs one request, a missed retry loses a
 * customer's order confirmation.
 */
const PERMANENT_ERROR_CODES = new Set([
    0,        // AuthException — bad credentials
    3,        // API method unavailable to this app
    10,       // permission denied
    190,      // access token invalid or expired
    100,      // invalid parameter
    131008,   // required parameter missing
    131009,   // parameter value not valid
    131021,   // recipient and sender are the same number
    131026,   // message undeliverable (not on WhatsApp / cannot receive)
    131031,   // account has been locked
    131047,   // re-engagement required — outside the 24h window, needs a template
    131051,   // unsupported message type
    131052,   // media download error (their end, for this asset)
    131053,   // media upload error
    132000,   // template param count mismatch
    132001,   // template does not exist in this language
    132005,   // template hydrated text too long
    132007,   // template format character policy violated
    132012,   // template parameter format mismatch
    132015,   // template is paused
    132016,   // template is disabled
    133010,   // phone number not registered
]);

/** Transport-level failures that are worth another attempt. */
const RETRYABLE_NETWORK_CODES = new Set([
    'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND',
    'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'ERR_NETWORK',
]);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Redact anything that must never reach a log line. */
function redact(value) {
    if (!value) return value;
    return String(value).replace(/(Bearer\s+)[A-Za-z0-9_\-.]+/gi, '$1[redacted]');
}

class WhatsAppCloudClient {
    constructor() {
        this.refresh();
    }

    /** Re-read configuration. Exposed so tests can reconfigure without reimport. */
    refresh() {
        this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
        this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
        this.businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
        this.apiBase = (process.env.WHATSAPP_API_BASE_URL
            || process.env.WHATSAPP_API_URL
            || DEFAULT_API_BASE).replace(/\/$/, '');
        this.apiVersion = process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION;
    }

    get configured() {
        return Boolean(this.accessToken && this.phoneNumberId);
    }

    get messagesUrl() {
        return `${this.apiBase}/${this.apiVersion}/${this.phoneNumberId}/messages`;
    }

    /**
     * Decide whether a failure is worth another attempt.
     * @returns {{ retryable: boolean, code: number|null, message: string, httpStatus: number|null }}
     */
    classifyError(err) {
        const httpStatus = err.response?.status ?? null;
        const metaError = err.response?.data?.error;
        const code = metaError?.code ?? null;
        const message = metaError?.message || err.message || 'Unknown WhatsApp error';

        // Meta spoke and named a code — that is the authoritative answer.
        if (code !== null && code !== undefined) {
            if (PERMANENT_ERROR_CODES.has(code)) {
                return { retryable: false, code, message, httpStatus };
            }
            // 130429 / 131048 are rate limits: retryable, but the backoff
            // matters more here than anywhere else.
            return { retryable: true, code, message, httpStatus };
        }

        // No structured error. Fall back to HTTP status, then to the socket.
        if (httpStatus !== null) {
            const retryable = httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
            return { retryable, code: null, message, httpStatus };
        }

        return {
            retryable: RETRYABLE_NETWORK_CODES.has(err.code) || err.code === undefined,
            code: null,
            message,
            httpStatus,
        };
    }

    /**
     * Call the Cloud API with bounded retries and exponential backoff.
     *
     * Backoff is exponential with jitter. The jitter is not decoration: the
     * order pipeline can fire several sends at once, and without it a Meta
     * blip makes them all retry in lockstep and hit the same wall together.
     */
    async request(url, payload, options = {}) {
        const {
            method = 'post',
            headers = {},
            timeout = timeoutMs(),
            maxAttempts: attemptCap = maxAttempts(),
            label = 'request',
        } = options;

        if (!this.configured) {
            return { success: false, error: 'WhatsApp Cloud API is not configured', permanent: true, code: null };
        }

        let lastError = null;

        for (let attempt = 1; attempt <= attemptCap; attempt++) {
            try {
                const res = await axios({
                    method,
                    url,
                    ...(payload === null || payload === undefined ? {} : { data: payload }),
                    timeout,
                    headers: {
                        Authorization: `Bearer ${this.accessToken}`,
                        ...headers,
                    },
                });

                if (attempt > 1) {
                    console.log(`[WA-API] ${label} succeeded on attempt ${attempt}`);
                }
                return { success: true, data: res.data, status: res.status };
            } catch (err) {
                const verdict = this.classifyError(err);
                lastError = verdict;

                if (!verdict.retryable) {
                    console.error(`[WA-API] ${label} failed permanently (code ${verdict.code}): ${redact(verdict.message)}`);
                    return {
                        success: false,
                        error: verdict.message,
                        code: verdict.code,
                        httpStatus: verdict.httpStatus,
                        permanent: true,
                    };
                }

                if (attempt === attemptCap) break;

                const backoff = Math.round(baseBackoffMs() * 2 ** (attempt - 1) * (0.5 + Math.random()));
                console.warn(`[WA-API] ${label} attempt ${attempt}/${attemptCap} failed (${redact(verdict.message)}); retrying in ${backoff}ms`);
                await sleep(backoff);
            }
        }

        console.error(`[WA-API] ${label} exhausted ${attemptCap} attempts: ${redact(lastError && lastError.message)}`);
        return {
            success: false,
            error: (lastError && lastError.message) || 'WhatsApp request failed',
            code: (lastError && lastError.code) ?? null,
            httpStatus: (lastError && lastError.httpStatus) ?? null,
            permanent: false,
        };
    }

    /** Shape every send the same way, so callers never special-case a type. */
    async _send(to, body, label) {
        if (!to) return { success: false, error: 'No recipient', permanent: true };

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            ...body,
        };

        const res = await this.request(this.messagesUrl, payload, { label });
        if (!res.success) return res;

        return {
            success: true,
            messageId: res.data?.messages?.[0]?.id || null,
            waId: res.data?.contacts?.[0]?.wa_id || to,
            raw: res.data,
        };
    }

    // ── Outbound message types ──────────────────────────────────────────────

    /**
     * @param {string} to    E.164 digits, no plus
     * @param {string} text
     * @param {object} [opts] { previewUrl, replyTo }
     */
    sendText(to, text, opts = {}) {
        return this._send(to, {
            type: 'text',
            text: { preview_url: Boolean(opts.previewUrl), body: String(text ?? '') },
            ...(opts.replyTo ? { context: { message_id: opts.replyTo } } : {}),
        }, 'sendText');
    }

    /**
     * Approved template. The only form Meta delivers outside the 24-hour
     * customer service window, which is where every order notification sits.
     *
     * @param {Array<string|object>} bodyParams fill {{1}}, {{2}} … in order
     * @param {object} [opts] { headerParams, buttonParams }
     */
    sendTemplate(to, name, language = 'en', bodyParams = [], opts = {}) {
        const components = [];

        if (opts.headerParams && opts.headerParams.length) {
            components.push({
                type: 'header',
                parameters: opts.headerParams.map(p =>
                    (typeof p === 'object' ? p : { type: 'text', text: String(p ?? '') })),
            });
        }
        if (bodyParams && bodyParams.length) {
            components.push({
                type: 'body',
                parameters: bodyParams.map(p =>
                    (typeof p === 'object' ? p : { type: 'text', text: String(p ?? '') })),
            });
        }
        if (opts.buttonParams && opts.buttonParams.length) {
            opts.buttonParams.forEach((btn, index) => {
                components.push({
                    type: 'button',
                    sub_type: btn.subType || 'url',
                    index: String(index),
                    parameters: [{ type: 'text', text: String(btn.text ?? '') }],
                });
            });
        }

        return this._send(to, {
            type: 'template',
            template: {
                name,
                language: { code: language || 'en' },
                ...(components.length ? { components } : {}),
            },
        }, `sendTemplate(${name})`);
    }

    /**
     * Media is addressed either by a public URL Meta can fetch, or by the id
     * of something already uploaded to Meta. Detected rather than configured,
     * because callers have one or the other and should not have to say which.
     */
    _mediaBody(kind, source, extra = {}) {
        const ref = /^https?:\/\//i.test(source) ? { link: source } : { id: source };
        return { type: kind, [kind]: { ...ref, ...extra } };
    }

    sendImage(to, source, opts = {}) {
        return this._send(to, this._mediaBody('image', source,
            opts.caption ? { caption: opts.caption } : {}), 'sendImage');
    }

    sendDocument(to, source, opts = {}) {
        return this._send(to, this._mediaBody('document', source, {
            ...(opts.caption ? { caption: opts.caption } : {}),
            ...(opts.filename ? { filename: opts.filename } : {}),
        }), 'sendDocument');
    }

    /** Audio takes no caption — Meta rejects the payload if one is present. */
    sendAudio(to, source) {
        return this._send(to, this._mediaBody('audio', source), 'sendAudio');
    }

    sendVideo(to, source, opts = {}) {
        return this._send(to, this._mediaBody('video', source,
            opts.caption ? { caption: opts.caption } : {}), 'sendVideo');
    }

    sendSticker(to, source) {
        return this._send(to, this._mediaBody('sticker', source), 'sendSticker');
    }

    sendLocation(to, loc = {}) {
        return this._send(to, {
            type: 'location',
            location: {
                latitude: Number(loc.latitude),
                longitude: Number(loc.longitude),
                ...(loc.name ? { name: loc.name } : {}),
                ...(loc.address ? { address: loc.address } : {}),
            },
        }, 'sendLocation');
    }

    /** @param {Array<object>} contacts Meta's contact objects, passed through. */
    sendContacts(to, contacts) {
        return this._send(to, { type: 'contacts', contacts }, 'sendContacts');
    }

    /**
     * Interactive message — reply buttons or a list.
     *
     * The `interactive` object is passed through rather than wrapped: its
     * shape differs per sub-type, and a partial abstraction over it would hide
     * more than it helped. `sendButtons` below covers the common case.
     */
    sendInteractive(to, interactive) {
        return this._send(to, { type: 'interactive', interactive }, 'sendInteractive');
    }

    /** Reply buttons — up to three, and titles cap at 20 chars, per Meta. */
    sendButtons(to, bodyText, buttons = [], opts = {}) {
        return this.sendInteractive(to, {
            type: 'button',
            ...(opts.header ? { header: { type: 'text', text: opts.header } } : {}),
            body: { text: bodyText },
            ...(opts.footer ? { footer: { text: opts.footer } } : {}),
            action: {
                buttons: buttons.slice(0, 3).map((b, i) => ({
                    type: 'reply',
                    reply: { id: b.id || `btn_${i}`, title: String(b.title).slice(0, 20) },
                })),
            },
        });
    }

    /**
     * Mark an inbound message read (the blue ticks the customer sees).
     *
     * Best effort by design: failing to show a read receipt is not worth a
     * retry storm, so this gets a single attempt.
     */
    async markAsRead(messageId) {
        if (!messageId) return { success: false, error: 'No message id', permanent: true };
        const res = await this.request(this.messagesUrl, {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
        }, { label: 'markAsRead', maxAttempts: 1 });
        return res.success ? { success: true } : res;
    }

    // ── Media ───────────────────────────────────────────────────────────────

    /**
     * Resolve a media id to Meta's temporary download URL.
     *
     * That URL is short-lived and only works with our bearer token, which is
     * exactly why it must never be handed to a browser.
     */
    async getMediaUrl(mediaId) {
        if (!mediaId) return { success: false, error: 'No media id', permanent: true };
        const res = await this.request(
            `${this.apiBase}/${this.apiVersion}/${mediaId}`,
            null,
            { method: 'get', label: 'getMediaUrl' }
        );
        if (!res.success) return res;
        return {
            success: true,
            url: res.data?.url,
            mimeType: res.data?.mime_type,
            sha256: res.data?.sha256,
            fileSize: Number(res.data?.file_size) || 0,
        };
    }

    /**
     * Download media Meta is holding for us.
     *
     * Size is checked twice — from the metadata before the transfer, and
     * against the delivered buffer afterwards. The first check saves the
     * bandwidth; the second is what actually protects a Raspberry Pi from a
     * content-length that lied.
     */
    async downloadMedia(mediaId) {
        const meta = await this.getMediaUrl(mediaId);
        if (!meta.success) return meta;

        if (meta.fileSize && meta.fileSize > MAX_MEDIA_BYTES) {
            return {
                success: false,
                permanent: true,
                error: `Media is ${Math.round(meta.fileSize / 1024 / 1024)}MB, over the ${MAX_MEDIA_BYTES / 1024 / 1024}MB limit`,
            };
        }

        try {
            const res = await axios.get(meta.url, {
                headers: { Authorization: `Bearer ${this.accessToken}` },
                responseType: 'arraybuffer',
                timeout: Number(process.env.WHATSAPP_MEDIA_TIMEOUT_MS || 30000),
                maxContentLength: MAX_MEDIA_BYTES,
                maxBodyLength: MAX_MEDIA_BYTES,
            });

            const buffer = Buffer.from(res.data);
            if (buffer.length > MAX_MEDIA_BYTES) {
                return { success: false, permanent: true, error: 'Media exceeded the size limit mid-transfer' };
            }

            return {
                success: true,
                buffer,
                mimeType: meta.mimeType || res.headers['content-type'] || 'application/octet-stream',
                sha256: meta.sha256 || crypto.createHash('sha256').update(buffer).digest('hex'),
                fileSize: buffer.length,
            };
        } catch (err) {
            const verdict = this.classifyError(err);
            console.error(`[WA-API] media download failed: ${redact(verdict.message)}`);
            return { success: false, error: verdict.message, permanent: !verdict.retryable };
        }
    }

    /**
     * Upload media to Meta and get back an id usable in a send.
     *
     * Preferred over sending a public link when the asset is not already on a
     * CDN: Meta fetches a link from its own network, which fails for anything
     * behind auth or on a home connection.
     */
    async uploadMedia(buffer, mimeType, filename = 'file') {
        if (!this.configured) {
            return { success: false, error: 'WhatsApp Cloud API is not configured', permanent: true };
        }
        if (!Buffer.isBuffer(buffer)) {
            return { success: false, error: 'uploadMedia expects a Buffer', permanent: true };
        }
        if (buffer.length > MAX_MEDIA_BYTES) {
            return { success: false, permanent: true, error: 'Media exceeds the 16MB limit' };
        }

        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', buffer, { filename, contentType: mimeType });

        const res = await this.request(
            `${this.apiBase}/${this.apiVersion}/${this.phoneNumberId}/media`,
            form,
            { headers: form.getHeaders(), label: 'uploadMedia' }
        );
        if (!res.success) return res;
        return { success: true, mediaId: res.data?.id };
    }

    /**
     * The WhatsApp Business Account this phone number belongs to.
     *
     * Template management is addressed by WABA id, not phone number id, and
     * WHATSAPP_BUSINESS_ACCOUNT_ID is easy to leave unset because messaging
     * works without it. Rather than fail on a missing variable, ask Meta which
     * account the number we are already using belongs to.
     */
    async resolveBusinessAccountId() {
        if (this.businessAccountId) return { success: true, id: this.businessAccountId };

        const res = await this.request(
            `${this.apiBase}/${this.apiVersion}/${this.phoneNumberId}?fields=whatsapp_business_account{id,name}`,
            null,
            { method: 'get', label: 'resolveWaba', maxAttempts: 1 }
        );
        if (!res.success) return res;

        const waba = res.data && res.data.whatsapp_business_account;
        if (!waba || !waba.id) {
            return {
                success: false,
                permanent: true,
                error: 'Meta did not report a business account for this phone number. Set WHATSAPP_BUSINESS_ACCOUNT_ID.',
            };
        }

        // Cache for the life of the process; it does not change.
        this.businessAccountId = waba.id;
        return { success: true, id: waba.id, name: waba.name };
    }

    /**
     * Every message template on the account, with its status and placeholders.
     *
     * The placeholder count is what callers actually need: a template approved
     * with three variables and sent four is rejected with 132000, and that
     * failure is invisible until a customer says they never got their
     * confirmation.
     */
    async listTemplates() {
        const waba = await this.resolveBusinessAccountId();
        if (!waba.success) return waba;

        const res = await this.request(
            `${this.apiBase}/${this.apiVersion}/${waba.id}/message_templates?fields=name,status,language,category,components&limit=100`,
            null,
            { method: 'get', label: 'listTemplates', maxAttempts: 2 }
        );
        if (!res.success) return res;

        const templates = (res.data.data || []).map(t => {
            const components = t.components || [];
            const body = components.find(c => c.type === 'BODY');
            const header = components.find(c => c.type === 'HEADER');
            const buttons = components.find(c => c.type === 'BUTTONS');

            // Meta does not report the variable count, so read it off the text.
            const countVars = (text) => {
                const found = String(text || '').match(/\{\{\s*\d+\s*\}\}/g) || [];
                return new Set(found.map(v => v.replace(/\D/g, ''))).size;
            };

            return {
                name: t.name,
                status: t.status,
                language: t.language,
                category: t.category,
                bodyParams: countVars(body && body.text),
                headerParams: countVars(header && header.text),
                /* A variable inside a button URL needs buttonParams rather than
                 * bodyParams — a different payload shape, and a common reason a
                 * template that looks right is rejected. */
                hasButtonVariable: Boolean(
                    buttons && (buttons.buttons || []).some(b => /\{\{\s*\d+\s*\}\}/.test(b.url || ''))
                ),
                bodyText: body && body.text,
            };
        });

        return { success: true, businessAccountId: waba.id, templates };
    }

    /** Configuration report for the health endpoint. Never returns a secret. */
    describe() {
        return {
            configured: this.configured,
            phoneNumberId: this.phoneNumberId ? `…${this.phoneNumberId.slice(-4)}` : null,
            businessAccountId: this.businessAccountId ? `…${this.businessAccountId.slice(-4)}` : null,
            apiVersion: this.apiVersion,
            apiBase: this.apiBase,
            hasAccessToken: Boolean(this.accessToken),
            hasAppSecret: Boolean(process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET),
            hasVerifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
        };
    }

    /**
     * Ask Meta whether our credentials actually work.
     *
     * Reads the phone number record — the cheapest call that proves both the
     * token and the phone number id are valid.
     */
    async ping() {
        if (!this.configured) return { ok: false, error: 'not configured' };
        const res = await this.request(
            `${this.apiBase}/${this.apiVersion}/${this.phoneNumberId}?fields=verified_name,quality_rating`,
            null,
            { method: 'get', label: 'ping', maxAttempts: 1 }
        );
        if (!res.success) return { ok: false, error: res.error, code: res.code };
        return {
            ok: true,
            verifiedName: res.data?.verified_name || null,
            qualityRating: res.data?.quality_rating || null,
        };
    }
}

module.exports = new WhatsAppCloudClient();
module.exports.WhatsAppCloudClient = WhatsAppCloudClient;
module.exports.PERMANENT_ERROR_CODES = PERMANENT_ERROR_CODES;
module.exports.MAX_MEDIA_BYTES = MAX_MEDIA_BYTES;
