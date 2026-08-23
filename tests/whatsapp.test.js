/**
 * WhatsApp Cloud API integration tests.
 *
 * Covers the parts that are cheap to get wrong and expensive to notice:
 * webhook authenticity, duplicate-delivery protection, status ordering, retry
 * classification, and the send surface's error handling.
 *
 * Meta is never called. `axios` is stubbed at the module level, so every send
 * path is exercised end to end — payload shape included — without a network or
 * a real token. Tests that need a database use mongodb-memory-server, matching
 * the other suites here.
 *
 * Run: npm run test:whatsapp
 */
const crypto = require('crypto');
const Module = require('module');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
    cond ? pass++ : fail++;
};

/* ── axios stub ───────────────────────────────────────────────────────────
 * Installed before any module that requires axios is loaded. `queue` holds
 * the responses the next calls should get; `calls` records what was sent so a
 * test can assert on the payload Meta would have received. */
const axiosState = { calls: [], queue: [] };

function makeAxiosStub() {
    const handler = (config) => {
        const cfg = typeof config === 'string' ? { url: config, method: 'get' } : config;
        axiosState.calls.push(cfg);
        const next = axiosState.queue.shift();
        if (!next) return Promise.resolve({ status: 200, data: {}, headers: {} });
        if (next.error) return Promise.reject(next.error);
        return Promise.resolve({ status: next.status || 200, data: next.data || {}, headers: next.headers || {} });
    };
    handler.get = (url, opts = {}) => handler({ ...opts, url, method: 'get' });
    handler.post = (url, data, opts = {}) => handler({ ...opts, url, data, method: 'post' });
    return handler;
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'axios') return makeAxiosStub();
    return originalLoad.apply(this, arguments);
};

/** A Meta API error shaped the way axios surfaces it. */
const metaError = (code, message, status = 400) => ({
    response: { status, data: { error: { code, message } } },
});

const sign = (secret, body) =>
    'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

function mockRes() {
    const res = { statusCode: null, body: null };
    res.sendStatus = (c) => { res.statusCode = c; return res; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    res.set = () => res;
    return res;
}

/** Let the fire-and-forget work the webhook kicks off actually run. */
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));

(async () => {
    const mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
    process.env.WHATSAPP_APP_SECRET = 'app-secret';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '111222333';
    // Keep the inbound path narrow: these are exercised separately.
    process.env.WHATSAPP_AUTO_GREET = 'false';
    process.env.WHATSAPP_FORWARD_INBOUND = 'false';
    process.env.WHATSAPP_AI_REPLIES = 'false';

    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'whatsapp' });

    const client = require('../src/services/whatsappCloudClient');
    const meta = require('../src/controllers/metaController');
    const inbound = require('../src/services/whatsappInbound');
    const WhatsAppMessage = require('../src/models/WhatsAppMessage');
    const WhatsAppContact = require('../src/models/WhatsAppContact');
    const WhatsAppWebhookEvent = require('../src/models/WhatsAppWebhookEvent');
    const { checkWhatsAppConfig } = require('../src/config/whatsappConfig');

    /* Deduplication is enforced by the unique index on eventKey, not by the
     * application — so these assertions are only meaningful once that index
     * actually exists. Mongoose builds indexes in the background after connect,
     * and this suite races it: the dedup checks passed on most runs and failed
     * on the ones where the first duplicate insert landed before the index was
     * ready. Waiting for the build makes the outcome depend on the code under
     * test rather than on timing. */
    await Promise.all([
        WhatsAppWebhookEvent.init(),
        WhatsAppMessage.init(),
        WhatsAppContact.init(),
    ]);

    client.refresh();

    const reset = () => { axiosState.calls = []; axiosState.queue = []; };

    // ══ 1. Webhook verification ═════════════════════════════════════════════
    {
        const res = mockRes();
        meta.verifyWhatsAppWebhook({
            query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'chal-1' },
        }, res);
        check('verification with the right token echoes the challenge', res.body === 'chal-1', `got ${res.body}`);
    }
    {
        const res = mockRes();
        meta.verifyWhatsAppWebhook({
            query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'chal-2' },
        }, res);
        check('verification with a wrong token -> 403', res.statusCode === 403, `got ${res.statusCode}`);
        check('verification with a wrong token does not echo the challenge', res.body !== 'chal-2');
    }
    {
        const res = mockRes();
        meta.verifyWhatsAppWebhook({ query: { 'hub.mode': 'subscribe', 'hub.challenge': 'c' } }, res);
        check('verification with no token at all -> 403', res.statusCode === 403, `got ${res.statusCode}`);
    }

    // ══ 2. Webhook signature ════════════════════════════════════════════════
    {
        const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
        const res = mockRes();
        meta.handleWhatsAppWebhook({
            get: () => sign('the-wrong-secret', body),
            rawBody: Buffer.from(body),
            body: JSON.parse(body),
        }, res);
        check('forged signature -> 401', res.statusCode === 401, `got ${res.statusCode}`);
    }
    {
        const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
        const res = mockRes();
        meta.handleWhatsAppWebhook({
            get: () => sign('app-secret', body),
            rawBody: Buffer.from(body),
            body: JSON.parse(body),
        }, res);
        check('valid signature -> 200', res.statusCode === 200, `got ${res.statusCode}`);
    }
    {
        // Signature absent entirely.
        const body = JSON.stringify({ entry: [] });
        const res = mockRes();
        meta.handleWhatsAppWebhook({
            get: () => undefined,
            rawBody: Buffer.from(body),
            body: JSON.parse(body),
        }, res);
        check('missing signature header -> 401', res.statusCode === 401, `got ${res.statusCode}`);
    }
    {
        // No secret configured at all, in production.
        const saved = process.env.WHATSAPP_APP_SECRET;
        const savedMeta = process.env.META_APP_SECRET;
        delete process.env.WHATSAPP_APP_SECRET;
        delete process.env.META_APP_SECRET;
        const res = mockRes();
        meta.handleWhatsAppWebhook({ get: () => 'x', rawBody: Buffer.from('{}'), body: {} }, res);
        check('no app secret in production -> 403 (fails closed)', res.statusCode === 403, `got ${res.statusCode}`);
        process.env.WHATSAPP_APP_SECRET = saved;
        if (savedMeta) process.env.META_APP_SECRET = savedMeta;
    }

    // ══ 3. Malformed payloads must not throw ════════════════════════════════
    {
        const shapes = [
            {}, { entry: null }, { entry: [{}] }, { entry: [{ changes: null }] },
            { entry: [{ changes: [{}] }] }, { entry: [{ changes: [{ value: {} }] }] },
            { entry: [{ changes: [{ value: { messages: 'not-an-array' } }] }] },
            { entry: [{ changes: [{ value: { messages: [{}] } }] }] },
        ];
        let threw = null;
        for (const shape of shapes) {
            try {
                await inbound.processWebhook(shape);
            } catch (err) { threw = `${JSON.stringify(shape)} -> ${err.message}`; break; }
        }
        check('every malformed payload shape is survived', threw === null, threw || '');
    }

    // ══ 4. Idempotency ══════════════════════════════════════════════════════
    {
        reset();
        const payload = {
            object: 'whatsapp_business_account',
            entry: [{
                changes: [{
                    field: 'messages',
                    value: {
                        contacts: [{ profile: { name: 'Test Buyer' }, wa_id: '96599887766' }],
                        messages: [{
                            id: 'wamid.DUPE1', from: '96599887766', type: 'text',
                            timestamp: String(Math.floor(Date.now() / 1000)),
                            text: { body: 'hello there' },
                        }],
                    },
                }],
            }],
        };

        const first = await inbound.processWebhook(payload);
        const second = await inbound.processWebhook(payload);
        const third = await inbound.processWebhook(payload);

        check('first delivery is processed', first.processed === 1, JSON.stringify(first));
        check('a retry of the same message is skipped', second.skipped === 1 && second.processed === 0, JSON.stringify(second));
        check('a third retry is still skipped', third.skipped === 1, JSON.stringify(third));

        const stored = await WhatsAppMessage.countDocuments({ messageId: 'wamid.DUPE1' });
        check('the duplicated message is stored exactly once', stored === 1, `found ${stored}`);

        const contact = await WhatsAppContact.findOne({ waId: '96599887766' });
        check('the contact was created from the webhook', Boolean(contact), 'no contact');
        check('the profile name was captured', contact?.profileName === 'Test Buyer', contact?.profileName);
        check('lastInboundAt was set, opening the service window',
            Boolean(contact?.lastInboundAt) && contact.isWithinServiceWindow());
    }

    // ══ 5. Status tracking ══════════════════════════════════════════════════
    {
        await WhatsAppMessage.create({
            messageId: 'wamid.OUT1', direction: 'outbound', type: 'text',
            to: '96599887766', body: 'your order is confirmed', status: 'sent',
        });

        const statusEvent = (status) => ({
            entry: [{ changes: [{ field: 'messages', value: { statuses: [{
                id: 'wamid.OUT1', status, recipient_id: '96599887766',
                timestamp: String(Math.floor(Date.now() / 1000)),
            }] } }] }],
        });

        await inbound.processWebhook(statusEvent('delivered'));
        let m = await WhatsAppMessage.findOne({ messageId: 'wamid.OUT1' });
        check('a delivered receipt advances the message', m.status === 'delivered', m.status);
        check('deliveredAt is stamped', Boolean(m.deliveredAt));

        await inbound.processWebhook(statusEvent('read'));
        m = await WhatsAppMessage.findOne({ messageId: 'wamid.OUT1' });
        check('a read receipt advances it further', m.status === 'read', m.status);

        // Out-of-order: Meta makes no ordering guarantee.
        await inbound.processWebhook(statusEvent('sent'));
        m = await WhatsAppMessage.findOne({ messageId: 'wamid.OUT1' });
        check('a late "sent" receipt does not regress a read message', m.status === 'read', m.status);
    }
    {
        await WhatsAppMessage.create({
            messageId: 'wamid.OUT2', direction: 'outbound', type: 'text',
            to: '96599887766', status: 'sent',
        });
        await inbound.processWebhook({
            entry: [{ changes: [{ field: 'messages', value: { statuses: [{
                id: 'wamid.OUT2', status: 'failed', recipient_id: '96599887766',
                timestamp: String(Math.floor(Date.now() / 1000)),
                errors: [{ code: 131047, title: 'Re-engagement message' }],
            }] } }] }],
        });
        const m = await WhatsAppMessage.findOne({ messageId: 'wamid.OUT2' });
        check('a failure receipt is recorded with its code', m.status === 'failed' && m.errorCode === 131047,
            `${m.status}/${m.errorCode}`);
        check('the failure reason is kept', /Re-engagement/.test(m.errorMessage || ''), m.errorMessage);
    }

    // ══ 6. Retry classification ═════════════════════════════════════════════
    {
        const cases = [
            ['invalid token (190)', metaError(190, 'bad token'), false],
            ['invalid recipient (131026)', metaError(131026, 'undeliverable'), false],
            ['outside 24h window (131047)', metaError(131047, 're-engagement'), false],
            ['template missing (132001)', metaError(132001, 'no template'), false],
            ['rate limited (130429)', metaError(130429, 'rate limit', 429), true],
            ['server error (500)', { response: { status: 500, data: {} } }, true],
            ['gateway timeout (504)', { response: { status: 504, data: {} } }, true],
            ['socket timeout', { code: 'ETIMEDOUT', message: 'timeout' }, true],
            ['connection reset', { code: 'ECONNRESET', message: 'reset' }, true],
        ];
        let bad = [];
        for (const [name, err, wantRetry] of cases) {
            const got = client.classifyError(err).retryable;
            if (got !== wantRetry) bad.push(`${name}: got ${got}`);
        }
        check('every error is classified retryable or not, correctly', bad.length === 0, bad.join('; '));
    }

    // ══ 7. Retry behaviour ══════════════════════════════════════════════════
    {
        reset();
        process.env.WHATSAPP_BACKOFF_MS = '1';   // keep the suite fast
        axiosState.queue = [
            { error: { response: { status: 503, data: {} } } },
            { error: { response: { status: 503, data: {} } } },
            { data: { messages: [{ id: 'wamid.RETRY_OK' }] } },
        ];
        const res = await client.sendText('96599887766', 'eventually works');
        check('a transient failure is retried until it succeeds', res.success === true, JSON.stringify(res));
        check('it took exactly three attempts', axiosState.calls.length === 3, `${axiosState.calls.length} calls`);
        check('the message id from the successful attempt is returned', res.messageId === 'wamid.RETRY_OK', res.messageId);
    }
    {
        reset();
        axiosState.queue = [{ error: metaError(131026, 'not on WhatsApp') }];
        const res = await client.sendText('96599887766', 'nope');
        check('a permanent failure is not retried', axiosState.calls.length === 1, `${axiosState.calls.length} calls`);
        check('a permanent failure is reported as permanent', res.success === false && res.permanent === true, JSON.stringify(res));
        check('the Meta error code is surfaced', res.code === 131026, String(res.code));
    }
    {
        reset();
        axiosState.queue = [
            { error: { code: 'ETIMEDOUT', message: 't' } },
            { error: { code: 'ETIMEDOUT', message: 't' } },
            { error: { code: 'ETIMEDOUT', message: 't' } },
        ];
        const res = await client.sendText('96599887766', 'never works');
        check('retries stop at the configured ceiling', axiosState.calls.length === 3, `${axiosState.calls.length} calls`);
        check('exhausted retries are not marked permanent', res.success === false && res.permanent === false, JSON.stringify(res));
    }

    // ══ 8. Payload shape per message type ═══════════════════════════════════
    {
        reset();
        axiosState.queue = [{ data: { messages: [{ id: 'wamid.T' }] } }];
        await client.sendText('96599887766', 'hi', { previewUrl: true });
        const body = axiosState.calls[0].data;
        check('text send targets the messages endpoint',
            /\/v\d+\.\d+\/111222333\/messages$/.test(axiosState.calls[0].url), axiosState.calls[0].url);
        check('text payload is well formed',
            body.messaging_product === 'whatsapp' && body.type === 'text' && body.text.body === 'hi',
            JSON.stringify(body));
        check('preview_url is honoured', body.text.preview_url === true);
        check('the bearer token is attached',
            /^Bearer /.test(axiosState.calls[0].headers.Authorization));
    }
    {
        reset();
        axiosState.queue = [{ data: { messages: [{ id: 'wamid.TPL' }] } }];
        await client.sendTemplate('96599887766', 'order_confirmed', 'ar', ['Sara', 'ORD-1', '12.500 KWD']);
        const body = axiosState.calls[0].data;
        check('template payload names the template and language',
            body.type === 'template' && body.template.name === 'order_confirmed' && body.template.language.code === 'ar',
            JSON.stringify(body.template));
        check('template body params are positional and stringified',
            body.template.components[0].parameters.map(p => p.text).join('|') === 'Sara|ORD-1|12.500 KWD',
            JSON.stringify(body.template.components));
    }
    {
        reset();
        axiosState.queue = [{ data: { messages: [{ id: 'wamid.IMG' }] } }];
        await client.sendImage('96599887766', 'https://cdn.example.com/vase.jpg', { caption: 'Autumn vase' });
        const img = axiosState.calls[0].data.image;
        check('an http source is sent as a link', img.link === 'https://cdn.example.com/vase.jpg', JSON.stringify(img));
        check('the caption is carried', img.caption === 'Autumn vase');
    }
    {
        reset();
        axiosState.queue = [{ data: { messages: [{ id: 'wamid.DOC' }] } }];
        await client.sendDocument('96599887766', '1234567890', { filename: 'receipt.pdf' });
        const doc = axiosState.calls[0].data.document;
        check('a non-URL source is sent as a media id', doc.id === '1234567890', JSON.stringify(doc));
        check('the filename is carried', doc.filename === 'receipt.pdf');
    }
    {
        reset();
        axiosState.queue = [{ data: { messages: [{ id: 'wamid.AUD' }] } }];
        await client.sendAudio('96599887766', 'https://cdn.example.com/a.ogg');
        check('audio carries no caption field (Meta rejects it)',
            axiosState.calls[0].data.audio.caption === undefined,
            JSON.stringify(axiosState.calls[0].data.audio));
    }
    {
        reset();
        axiosState.queue = [{ data: { messages: [{ id: 'wamid.LOC' }] } }];
        await client.sendLocation('96599887766', { latitude: 29.37, longitude: 47.98, name: 'Shop' });
        const loc = axiosState.calls[0].data.location;
        check('location coordinates are numbers, not strings',
            typeof loc.latitude === 'number' && typeof loc.longitude === 'number', JSON.stringify(loc));
    }
    {
        reset();
        axiosState.queue = [{ data: { messages: [{ id: 'wamid.BTN' }] } }];
        await client.sendButtons('96599887766', 'Track your order?', [
            { id: 'yes', title: 'Yes please' },
            { id: 'no', title: 'No thanks' },
            { id: 'c', title: 'Call me' },
            { id: 'd', title: 'Too many' },
        ]);
        const action = axiosState.calls[0].data.interactive.action;
        check('interactive buttons are capped at three', action.buttons.length === 3, `${action.buttons.length}`);
        check('button titles are within Meta\'s 20-char limit',
            action.buttons.every(b => b.reply.title.length <= 20));
    }
    {
        reset();
        axiosState.queue = [{ data: {} }];
        await client.markAsRead('wamid.INBOUND');
        const body = axiosState.calls[0].data;
        check('markAsRead posts the read status for the message',
            body.status === 'read' && body.message_id === 'wamid.INBOUND', JSON.stringify(body));
    }
    {
        reset();
        axiosState.queue = [{ error: metaError(500, 'boom', 500) }];
        const res = await client.markAsRead('wamid.X');
        check('markAsRead does not retry — a read receipt is not worth a storm',
            axiosState.calls.length === 1, `${axiosState.calls.length} calls`);
        check('markAsRead reports failure rather than throwing', res.success === false);
    }

    // ══ 9. Guard rails ══════════════════════════════════════════════════════
    {
        reset();
        const res = await client.sendText('', 'nobody');
        check('a send with no recipient fails without calling Meta',
            res.success === false && axiosState.calls.length === 0, JSON.stringify(res));
    }
    {
        reset();
        const saved = process.env.WHATSAPP_ACCESS_TOKEN;
        delete process.env.WHATSAPP_ACCESS_TOKEN;
        client.refresh();
        const res = await client.sendText('96599887766', 'no creds');
        check('an unconfigured client refuses to call Meta',
            res.success === false && axiosState.calls.length === 0, JSON.stringify(res));
        check('an unconfigured client says so permanently', res.permanent === true);
        process.env.WHATSAPP_ACCESS_TOKEN = saved;
        client.refresh();
    }
    {
        reset();
        const res = await client.uploadMedia('not a buffer', 'image/jpeg');
        check('uploadMedia rejects a non-Buffer without calling Meta',
            res.success === false && axiosState.calls.length === 0, JSON.stringify(res));
    }
    {
        reset();
        const { MAX_MEDIA_BYTES } = require('../src/services/whatsappCloudClient');
        const tooBig = Buffer.alloc(MAX_MEDIA_BYTES + 1);
        const res = await client.uploadMedia(tooBig, 'image/jpeg', 'huge.jpg');
        check('uploadMedia refuses anything over Meta\'s 16MB ceiling',
            res.success === false && res.permanent === true && axiosState.calls.length === 0,
            JSON.stringify(res));
    }

    // ══ 10. Secrets never leak ══════════════════════════════════════════════
    {
        const described = JSON.stringify(client.describe());
        check('describe() never returns the access token', !described.includes('test-token'), described);
        check('describe() never returns the app secret', !described.includes('app-secret'), described);
        check('describe() still reports that they are set',
            client.describe().hasAccessToken === true && client.describe().hasAppSecret === true);
    }

    // ══ 11. Config validation ═══════════════════════════════════════════════
    {
        const r = checkWhatsAppConfig();
        check('a fully configured environment validates clean', r.ok === true && r.enabled === true,
            JSON.stringify(r.missing));
    }
    {
        const saved = process.env.WHATSAPP_PHONE_NUMBER_ID;
        delete process.env.WHATSAPP_PHONE_NUMBER_ID;
        const r = checkWhatsAppConfig();
        check('a missing phone number id is reported', r.ok === false, JSON.stringify(r.missing));
        check('the report names the variable and explains it',
            r.missing.some(m => m.startsWith('WHATSAPP_PHONE_NUMBER_ID is missing —')), JSON.stringify(r.missing));
        check('the report never contains a secret value',
            !JSON.stringify(r).includes('test-token') && !JSON.stringify(r).includes('app-secret'));
        process.env.WHATSAPP_PHONE_NUMBER_ID = saved;
    }

    // ══ 12. Webhook event ledger ════════════════════════════════════════════
    {
        const claimed = await WhatsAppWebhookEvent.claim('msg:LEDGER_TEST', 'message', 'hash');
        const again = await WhatsAppWebhookEvent.claim('msg:LEDGER_TEST', 'message', 'hash');
        check('an event can be claimed once', claimed === true);
        check('the same event cannot be claimed twice', again === false);

        await WhatsAppWebhookEvent.settle('msg:LEDGER_TEST');
        const row = await WhatsAppWebhookEvent.findOne({ eventKey: 'msg:LEDGER_TEST' });
        check('a settled event is marked processed', row.status === 'processed', row.status);
    }

    // ══ 13. Template status events ══════════════════════════════════════════
    {
        const res = await inbound.processWebhook({
            entry: [{ changes: [{
                field: 'message_template_status_update',
                value: { message_template_id: '99', message_template_name: 'order_confirmed', event: 'APPROVED' },
            }] }],
        });
        check('a template status update is processed', res.processed === 1, JSON.stringify(res));
    }

    // ══ 14. End-to-end lifecycle ════════════════════════════════════════════
    /* The whole chain in one pass, because every link above is tested in
     * isolation and that is exactly how a pipeline ends up with two working
     * halves that are not joined to each other:
     *
     *   inbound webhook -> contact -> stored message -> auto-reply sent
     *   -> outbound stored -> delivery receipt -> status updated
     */
    {
        reset();
        process.env.WHATSAPP_AUTO_GREET = 'true';
        process.env.WHATSAPP_FORWARD_INBOUND = 'false';

        const buyer = '96555512345';

        // The greeting the service will send, then the read receipt call.
        axiosState.queue = [
            { data: {} },                                              // markAsRead
            { data: { messages: [{ id: 'wamid.E2E_REPLY' }] } },       // auto-reply
        ];

        const body = JSON.stringify({
            object: 'whatsapp_business_account',
            entry: [{ changes: [{ field: 'messages', value: {
                contacts: [{ profile: { name: 'Layla' }, wa_id: buyer }],
                messages: [{
                    id: 'wamid.E2E_IN', from: buyer, type: 'text',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: 'Is the autumn vase in stock?' },
                }],
            } }] }],
        });

        // 1. A signed webhook is accepted.
        const res = mockRes();
        meta.handleWhatsAppWebhook({
            get: () => sign('app-secret', body),
            rawBody: Buffer.from(body),
            body: JSON.parse(body),
        }, res);
        check('E2E: signed inbound webhook is acknowledged', res.statusCode === 200, `got ${res.statusCode}`);

        await settle(300);

        // 2. The customer exists and the message was stored.
        const contact = await WhatsAppContact.findOne({ waId: buyer });
        check('E2E: the contact was created', Boolean(contact));
        check('E2E: their profile name was captured', contact?.profileName === 'Layla', contact?.profileName);

        const stored = await WhatsAppMessage.findOne({ messageId: 'wamid.E2E_IN' });
        check('E2E: the inbound message was stored', Boolean(stored));
        check('E2E: with its text', stored?.body === 'Is the autumn vase in stock?', stored?.body);
        check('E2E: marked inbound', stored?.direction === 'inbound', stored?.direction);

        // 3. An auto-reply actually went out to Meta.
        const replyCall = axiosState.calls.find(c => c.data && c.data.type === 'text');
        check('E2E: an auto-reply was sent to Meta', Boolean(replyCall));
        check('E2E: addressed to the customer', replyCall?.data?.to === buyer, replyCall?.data?.to);

        // 4. The outbound reply was recorded.
        const outbound = await WhatsAppMessage.findOne({ messageId: 'wamid.E2E_REPLY', direction: 'outbound' });
        check('E2E: the outbound reply was recorded', Boolean(outbound));
        check('E2E: recorded as sent', outbound?.status === 'sent', outbound?.status);

        // 5. Meta reports delivery, then the customer reads it.
        for (const status of ['delivered', 'read']) {
            const sb = JSON.stringify({
                entry: [{ changes: [{ field: 'messages', value: { statuses: [{
                    id: 'wamid.E2E_REPLY', status, recipient_id: buyer,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                }] } }] }],
            });
            const r = mockRes();
            meta.handleWhatsAppWebhook({
                get: () => sign('app-secret', sb),
                rawBody: Buffer.from(sb),
                body: JSON.parse(sb),
            }, r);
            await settle(120);
        }

        const finalState = await WhatsAppMessage.findOne({ messageId: 'wamid.E2E_REPLY' });
        check('E2E: the reply reached "read" through the webhook chain',
            finalState?.status === 'read', finalState?.status);
        check('E2E: both timestamps were stamped along the way',
            Boolean(finalState?.deliveredAt) && Boolean(finalState?.readAt));

        // 6. The conversation is now readable as a whole.
        const thread = await WhatsAppMessage.find({ $or: [{ from: buyer }, { to: buyer }] });
        check('E2E: the conversation holds both sides', thread.length >= 2, `${thread.length} messages`);

        process.env.WHATSAPP_AUTO_GREET = 'false';
    }

    // ══ 15. Template discovery ══════════════════════════════════════════════
    // The placeholder count is the thing worth checking: a template approved
    // with three variables and sent four is refused with 132000, and that only
    // surfaces as a customer who never received their confirmation.
    {
        reset();
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'WABA_TEST';
        client.refresh();

        axiosState.queue = [{ data: { data: [
            { name: 'order_confirmed', status: 'APPROVED', language: 'en', category: 'UTILITY',
              components: [{ type: 'BODY', text: 'Hello {{1}}, order {{2}} confirmed. Total {{3}}. Track: {{4}}' }] },
            { name: 'order_status', status: 'APPROVED', language: 'ar', category: 'UTILITY',
              components: [{ type: 'BODY', text: 'Hi {{1}}, order {{2}} is now {{3}}.' }] },
            { name: 'still_waiting', status: 'PENDING', language: 'en', category: 'UTILITY',
              components: [{ type: 'BODY', text: 'Hi {{1}}' }] },
            { name: 'button_link', status: 'APPROVED', language: 'en', category: 'UTILITY',
              components: [
                  { type: 'BODY', text: 'Hello {{1}}, order {{2}} delivered. {{3}}' },
                  { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://x/{{1}}' }] },
              ] },
        ] } }];

        const r = await client.listTemplates();
        check('templates are listed', r.success === true, JSON.stringify(r).slice(0, 120));

        const byName = Object.fromEntries((r.templates || []).map(t => [t.name, t]));
        check('body placeholders are counted', byName.order_confirmed?.bodyParams === 4,
            String(byName.order_confirmed?.bodyParams));
        check('a repeated placeholder is not double counted', byName.order_status?.bodyParams === 3,
            String(byName.order_status?.bodyParams));
        check('a variable inside a button URL is flagged',
            byName.button_link?.hasButtonVariable === true);
        check('a template still in review is reported, not hidden',
            byName.still_waiting?.status === 'PENDING');
        check('language is carried through', byName.order_status?.language === 'ar');

        delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        client.refresh();
    }
    {
        // No WABA id configured: derive it from the phone number rather than fail.
        reset();
        client.refresh();
        axiosState.queue = [
            { data: { whatsapp_business_account: { id: 'WABA_DERIVED', name: 'ARTEVA' } } },
            { data: { data: [] } },
        ];
        const r = await client.listTemplates();
        check('the business account is resolved from the phone number when unset',
            r.success === true && r.businessAccountId === 'WABA_DERIVED', JSON.stringify(r).slice(0, 120));
    }

    // ══ 16. Template provisioning ═════════════════════════════════
    // Filing templates over the API is what lets this be done without a
    // browser signed into Business Manager. Two things must hold: Meta gets a
    // sample for every placeholder (it rejects the submission otherwise), and
    // re-running never files a second copy of a template already on record.
    {
        reset();
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'WABA_TEST';
        client.refresh();

        const bad = await client.createTemplate({
            name: 'two_vars_one_sample', language: 'en', category: 'UTILITY',
            body: 'Hi {{1}}, order {{2}} is on its way.', examples: ['Sara'],
        });
        check('a missing example is refused before Meta sees it',
            bad.success === false && /2 placeholder/.test(bad.error || ''), bad.error);
        check('nothing was sent for the refused template', axiosState.calls.length === 0);

        const badName = await client.createTemplate({
            name: 'Not A Valid Name', language: 'en', body: 'hello', examples: [],
        });
        check('an invalid template name is refused', badName.success === false);

        axiosState.queue = [{ data: { id: '1', status: 'PENDING', category: 'UTILITY' } }];
        const ok = await client.createTemplate({
            name: 'arteva_order_status', language: 'ar', category: 'UTILITY',
            body: 'a {{1}} b {{2}} c {{3}} d {{4}} e', examples: ['a', 'b', 'c', 'd'],
        });
        check('a well formed template is submitted', ok.success === true, ok.error);

        const sent = axiosState.calls[axiosState.calls.length - 1];
        const body = sent.data.components.find(c => c.type === 'BODY');
        check('Meta receives one sample row per placeholder',
            Array.isArray(body.example?.body_text?.[0]) && body.example.body_text[0].length === 4);
        check('the language is submitted as asked', sent.data.language === 'ar');
        check('the request targets the business account, not the phone number',
            /WABA_TEST\/message_templates/.test(sent.url), sent.url);

        delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        client.refresh();
    }

    // == 17. Boot-time provisioning ==========================================
    // The flag exists because the person who can reach Meta and the person
    // holding an admin session are not always at the same machine. It must be
    // inert unless asked, must not duplicate on restart, and must never stop
    // the shop booting.
    {
        reset();
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'WABA_TEST';
        client.refresh();
        const tpl = require('../src/services/whatsappTemplates');

        delete process.env.WHATSAPP_PROVISION_TEMPLATES;
        await tpl.provisionOnBoot();
        check('boot provisioning is off unless asked', axiosState.calls.length === 0);

        // Dry run reaches Meta to read the list, but files nothing.
        process.env.WHATSAPP_PROVISION_TEMPLATES = 'true';
        process.env.WHATSAPP_PROVISION_DRY_RUN = 'true';
        axiosState.queue = [{ data: { data: [] } }];
        await tpl.provisionOnBoot();
        check('a dry run submits nothing',
            axiosState.calls.filter(c => c.method === 'post').length === 0);

        // A restart with everything already filed must not resubmit.
        reset();
        process.env.WHATSAPP_PROVISION_DRY_RUN = 'false';
        const all = [];
        for (const c of Object.values(tpl.TEMPLATE_CONTRACTS)) {
            for (const lang of tpl.DEFAULT_TEMPLATE_LANGS) {
                all.push({ name: c.name, language: lang, status: 'APPROVED', category: 'UTILITY',
                    components: [{ type: 'BODY', text: c.body[lang] }] });
            }
        }
        axiosState.queue = [{ data: { data: all } }];
        await tpl.provisionOnBoot();
        check('a restart does not resubmit what is already filed',
            axiosState.calls.filter(c => c.method === 'post').length === 0);

        // Meta unreachable: reported, never thrown.
        reset();
        axiosState.queue = [{ error: { response: { status: 401, data: { error: { code: 190, message: 'Bad token' } } } } }];
        let threw = false;
        try { await tpl.provisionOnBoot(); } catch (e) { threw = true; }
        check('a Meta failure does not stop the boot', threw === false);

        // Every contract's example count matches its placeholders, in every
        // language. A mismatch here is a template Meta refuses to accept.
        let contractsOk = true;
        let badContract = '';
        for (const [envVar, c] of Object.entries(tpl.TEMPLATE_CONTRACTS)) {
            for (const [lang, body] of Object.entries(c.body)) {
                const vars = new Set((body.match(/\{\{\s*\d+\s*\}\}/g) || []).map(v => v.replace(/\D/g, '')));
                if (vars.size !== c.examples.length || vars.size !== c.params.length) {
                    contractsOk = false;
                    badContract = envVar + ':' + lang + ' has ' + vars.size + ' vars, '
                        + c.examples.length + ' examples, ' + c.params.length + ' params';
                }
            }
        }
        check('every contract agrees on its variable count in every language',
            contractsOk, badContract);

        delete process.env.WHATSAPP_PROVISION_TEMPLATES;
        delete process.env.WHATSAPP_PROVISION_DRY_RUN;
        delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        client.refresh();
    }
    // == 18. Template body shape ============================================
    // Meta refuses a body that ends with a variable, and one with two
    // variables side by side. Both come back as a generic parameter error, so
    // five of seven templates were silently refused in production before this
    // was understood — the two that survived were the two ending in text.
    {
        reset();
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'WABA_TEST';
        client.refresh();
        const tpl = require('../src/services/whatsappTemplates');

        const endsVar = await client.createTemplate({
            name: 'ends_with_var', language: 'en', category: 'UTILITY',
            body: 'Your order is ready. Track it: {{1}}', examples: ['https://x'],
        });
        check('a body ending in a variable is refused before Meta sees it',
            endsVar.success === false && /ends with a variable/.test(endsVar.error || ''),
            endsVar.error);

        const adjacent = await client.createTemplate({
            name: 'adjacent_vars', language: 'en', category: 'UTILITY',
            body: 'Hello {{1}} {{2}}, welcome.', examples: ['a', 'b'],
        });
        check('two variables with nothing between them are refused',
            adjacent.success === false && /nothing between them/.test(adjacent.error || ''),
            adjacent.error);

        check('neither refusal reached the network', axiosState.calls.length === 0);

        // Every shipped contract has to satisfy both rules, in both languages.
        let bad = '';
        for (const [envVar, c] of Object.entries(tpl.TEMPLATE_CONTRACTS)) {
            for (const [lang, body] of Object.entries(c.body)) {
                if (/\{\{\s*\d+\s*\}\}\s*$/.test(body)) bad += envVar + ':' + lang + ' ends with a variable. ';
                if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) bad += envVar + ':' + lang + ' has adjacent variables. ';
            }
        }
        check('no shipped template body ends with, or doubles up, a variable', bad === '', bad);

        delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        client.refresh();
    }
    await mongoose.disconnect();
    await mongod.stop();
    Module._load = originalLoad;

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
