/**
 * ARTEVA Maison — WhatsApp REST API
 *
 * The internal surface the dashboard and other services use to send WhatsApp
 * messages and read conversation history. Everything here goes through
 * whatsappCloudClient; nothing in this file talks to Meta directly.
 *
 * All routes except /health are admin-only. Sending from the business number
 * is not something an ordinary signed-in shopper may do, and a messaging
 * endpoint left open is a spam relay with the shop's reputation attached.
 */

const { asyncHandler } = require('../middleware/error');
const client = require('../services/whatsappCloudClient');
const whatsappService = require('../services/whatsappService');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppContact = require('../models/WhatsAppContact');

/** Meta wants E.164 digits with no plus; accept whatever the caller sends. */
function normalise(phone) {
    return whatsappService.formatPhone(phone);
}

/**
 * Turn a client result into an HTTP response.
 *
 * A permanent failure is the caller's fault (bad number, bad template) and is
 * a 422; a transient one is Meta's and is a 502, because retrying that is
 * meaningful and retrying the first is not. Meta's raw error text is not
 * echoed to the client — it can carry internal identifiers — but the code is,
 * because it is what someone will search for.
 */
function respond(res, result, extra = {}) {
    if (result.success) {
        return res.json({ success: true, data: { messageId: result.messageId, ...extra } });
    }
    return res.status(result.permanent ? 422 : 502).json({
        success: false,
        code: result.code ?? null,
        message: result.permanent
            ? 'WhatsApp rejected this message.'
            : 'WhatsApp is temporarily unavailable. Please try again.',
    });
}

/** Persist an outbound send made through this API so it shows in history. */
async function record(result, { to, body, type, templateName, context }) {
    try {
        await WhatsAppMessage.create({
            messageId: result.messageId || undefined,
            direction: 'outbound',
            type,
            from: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
            to,
            body: body ? String(body).slice(0, 4096) : undefined,
            templateName: templateName || undefined,
            context: context || 'api',
            status: result.success ? 'sent' : 'failed',
            sentAt: result.success ? new Date() : undefined,
            failedAt: result.success ? undefined : new Date(),
            errorCode: result.code ?? undefined,
            errorMessage: result.success ? undefined : result.error,
        });
    } catch (err) {
        console.error(`[WA-API] Could not record message: ${err.message}`);
    }
}

// @desc    Send a free-form text message
// @route   POST /api/whatsapp/messages/text
// @access  Private/Admin
//
// Free-form text only reaches a customer inside Meta's 24-hour service window,
// which opens when they message us. Outside it Meta rejects the send with
// 131047 and the caller is told so rather than left thinking it went out.
const sendText = asyncHandler(async (req, res) => {
    const { to, text, previewUrl, replyTo } = req.body;
    if (!to || !text) {
        return res.status(400).json({ success: false, message: 'Both "to" and "text" are required.' });
    }

    const phone = normalise(to);
    if (!phone) return res.status(400).json({ success: false, message: 'That phone number is not valid.' });

    const result = await client.sendText(phone, text, { previewUrl, replyTo });
    await record(result, { to: phone, body: text, type: 'text', context: 'api:text' });
    return respond(res, result);
});

// @desc    Send an approved template
// @route   POST /api/whatsapp/messages/template
// @access  Private/Admin
const sendTemplate = asyncHandler(async (req, res) => {
    const { to, name, language, bodyParams, headerParams, buttonParams } = req.body;
    if (!to || !name) {
        return res.status(400).json({ success: false, message: 'Both "to" and "name" are required.' });
    }

    const phone = normalise(to);
    if (!phone) return res.status(400).json({ success: false, message: 'That phone number is not valid.' });

    const result = await client.sendTemplate(
        phone, name, language || 'en',
        Array.isArray(bodyParams) ? bodyParams : [],
        { headerParams, buttonParams }
    );
    await record(result, { to: phone, body: `[template ${name}]`, type: 'template', templateName: name, context: 'api:template' });
    return respond(res, result);
});

// @desc    Send media — image, document, audio or video
// @route   POST /api/whatsapp/messages/media
// @access  Private/Admin
//
// `source` is either a publicly reachable URL or a Meta media id. A URL behind
// authentication will not work: Meta fetches it from its own network, so
// upload it first (POST /messages/media/upload) and send the id instead.
const sendMedia = asyncHandler(async (req, res) => {
    const { to, kind, source, caption, filename } = req.body;
    const senders = {
        image: (p, s) => client.sendImage(p, s, { caption }),
        document: (p, s) => client.sendDocument(p, s, { caption, filename }),
        audio: (p, s) => client.sendAudio(p, s),
        video: (p, s) => client.sendVideo(p, s, { caption }),
        sticker: (p, s) => client.sendSticker(p, s),
    };

    if (!to || !source || !senders[kind]) {
        return res.status(400).json({
            success: false,
            message: `"to", "source" and a "kind" of ${Object.keys(senders).join(', ')} are required.`,
        });
    }

    const phone = normalise(to);
    if (!phone) return res.status(400).json({ success: false, message: 'That phone number is not valid.' });

    const result = await senders[kind](phone, source);
    await record(result, { to: phone, body: caption || `[${kind}]`, type: kind, context: 'api:media' });
    return respond(res, result);
});

// @desc    Upload a file to Meta and get a media id back
// @route   POST /api/whatsapp/messages/media/upload
// @access  Private/Admin
const uploadMedia = asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file was uploaded.' });
    }
    const result = await client.uploadMedia(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname || 'file'
    );
    if (!result.success) return respond(res, result);
    return res.json({ success: true, data: { mediaId: result.mediaId } });
});

// @desc    Send a location pin
// @route   POST /api/whatsapp/messages/location
// @access  Private/Admin
const sendLocation = asyncHandler(async (req, res) => {
    const { to, latitude, longitude, name, address } = req.body;
    if (!to || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ success: false, message: '"to", "latitude" and "longitude" are required.' });
    }

    const phone = normalise(to);
    if (!phone) return res.status(400).json({ success: false, message: 'That phone number is not valid.' });

    const result = await client.sendLocation(phone, { latitude, longitude, name, address });
    await record(result, { to: phone, body: `[location ${latitude},${longitude}]`, type: 'location', context: 'api:location' });
    return respond(res, result);
});

// @desc    Send reply buttons
// @route   POST /api/whatsapp/messages/interactive
// @access  Private/Admin
const sendInteractive = asyncHandler(async (req, res) => {
    const { to, body, buttons, header, footer, interactive } = req.body;
    if (!to) return res.status(400).json({ success: false, message: '"to" is required.' });

    const phone = normalise(to);
    if (!phone) return res.status(400).json({ success: false, message: 'That phone number is not valid.' });

    // Either hand us buttons and we build the payload, or pass Meta's own
    // `interactive` object through untouched for list messages and the like.
    const result = interactive
        ? await client.sendInteractive(phone, interactive)
        : await client.sendButtons(phone, body || '', Array.isArray(buttons) ? buttons : [], { header, footer });

    await record(result, { to: phone, body: body || '[interactive]', type: 'interactive', context: 'api:interactive' });
    return respond(res, result);
});

// @desc    Mark an inbound message read
// @route   POST /api/whatsapp/messages/:id/read
// @access  Private/Admin
const markRead = asyncHandler(async (req, res) => {
    const result = await client.markAsRead(req.params.id);
    if (!result.success) return respond(res, result);
    return res.json({ success: true });
});

// @desc    List conversations, most recently active first
// @route   GET /api/whatsapp/conversations
// @access  Private/Admin
const listConversations = asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    // One row per counterparty with its latest message. Grouping in the
    // database rather than pulling every message and reducing in Node — the
    // message collection is the largest thing here and grows without bound
    // between TTL sweeps.
    const rows = await WhatsAppMessage.aggregate([
        { $sort: { createdAt: -1 } },
        {
            $group: {
                _id: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$from', '$to'] },
                lastMessage: { $first: '$body' },
                lastMessageAt: { $first: '$createdAt' },
                lastDirection: { $first: '$direction' },
                lastStatus: { $first: '$status' },
                messageCount: { $sum: 1 },
                unread: {
                    $sum: {
                        $cond: [
                            { $and: [{ $eq: ['$direction', 'inbound'] }, { $ne: ['$status', 'read'] }] },
                            1, 0,
                        ],
                    },
                },
            },
        },
        { $sort: { lastMessageAt: -1 } },
        { $limit: limit },
    ]);

    const waIds = rows.map(r => r._id).filter(Boolean);
    const contacts = await WhatsAppContact.find({ waId: { $in: waIds } })
        .select('waId phone profileName optedOut')
        .lean();
    const byId = new Map(contacts.map(c => [c.waId, c]));

    res.json({
        success: true,
        data: rows.map(r => ({
            waId: r._id,
            phone: byId.get(r._id)?.phone || (r._id ? `+${r._id}` : null),
            profileName: byId.get(r._id)?.profileName || null,
            optedOut: byId.get(r._id)?.optedOut || false,
            lastMessage: r.lastMessage,
            lastMessageAt: r.lastMessageAt,
            lastDirection: r.lastDirection,
            lastStatus: r.lastStatus,
            messageCount: r.messageCount,
            unread: r.unread,
        })),
    });
});

// @desc    One conversation's messages, oldest first
// @route   GET /api/whatsapp/conversations/:waId
// @access  Private/Admin
const getConversation = asyncHandler(async (req, res) => {
    const waId = normalise(req.params.waId);
    if (!waId) return res.status(400).json({ success: false, message: 'That phone number is not valid.' });

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const [contact, messages] = await Promise.all([
        WhatsAppContact.findOne({ waId }).lean(),
        WhatsAppMessage.find({ $or: [{ from: waId }, { to: waId }] })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean(),
    ]);

    res.json({
        success: true,
        data: {
            contact: contact
                ? {
                    waId: contact.waId,
                    phone: contact.phone,
                    profileName: contact.profileName,
                    optedOut: contact.optedOut,
                    lastInboundAt: contact.lastInboundAt,
                    // Whether a free-form reply will actually be delivered, or
                    // whether this now needs an approved template.
                    withinServiceWindow: contact.lastInboundAt
                        ? (Date.now() - new Date(contact.lastInboundAt).getTime()) < 24 * 60 * 60 * 1000
                        : false,
                }
                : { waId, phone: `+${waId}`, withinServiceWindow: false },
            // Reversed so the client renders oldest-first without re-sorting.
            messages: messages.reverse(),
        },
    });
});

// @desc    A single message and its delivery state
// @route   GET /api/whatsapp/messages/:id
// @access  Private/Admin
const getMessage = asyncHandler(async (req, res) => {
    const message = await WhatsAppMessage.findOne({
        $or: [{ messageId: req.params.id }, { _id: req.params.id.match(/^[0-9a-f]{24}$/i) ? req.params.id : null }],
    }).lean();

    if (!message) return res.status(404).json({ success: false, message: 'No such message.' });
    res.json({ success: true, data: message });
});

/**
 * What each notification type sends, so an approved template can be checked
 * against it before it is put into production.
 *
 * A template approved with three variables and sent four is rejected with
 * 132000, and nothing surfaces that until a customer says their confirmation
 * never arrived. Comparing the counts here turns a silent production failure
 * into a line on a screen.
 *
 * Keep in step with the templateParams arrays in whatsappService.
 */
const TEMPLATE_CONTRACTS = {
    WHATSAPP_TEMPLATE_CUSTOMER_NEW_ORDER: {
        type: 'customer_new_order',
        name: 'arteva_order_confirmed',
        category: 'UTILITY',
        params: ['customer name', 'order number', 'total with currency', 'tracking URL'],
        examples: ['Sara', 'A7K2M9P4', '45.500 KWD', 'https://www.artevamaisonkw.com/track/A7K2M9P4'],
        body: {
            en: 'Hello {{1}}, your ARTÉVA Maison order {{2}} is confirmed. Total: {{3}}. Track it here: {{4}}',
            ar: 'مرحباً {{1}}، تم تأكيد طلبك {{2}} من ARTÉVA Maison. الإجمالي: {{3}}. تتبع طلبك هنا: {{4}}',
        },
    },
    WHATSAPP_TEMPLATE_STATUS_UPDATE: {
        type: 'status_update',
        name: 'arteva_order_status',
        category: 'UTILITY',
        params: ['customer name', 'order number', 'status', 'tracking URL'],
        examples: ['Sara', 'A7K2M9P4', 'shipped', 'https://www.artevamaisonkw.com/track/A7K2M9P4'],
        body: {
            en: 'Hello {{1}}, your ARTÉVA Maison order {{2}} is now {{3}}. Track it here: {{4}}',
            ar: 'مرحباً {{1}}، حالة طلبك {{2}} من ARTÉVA Maison الآن: {{3}}. تتبع طلبك هنا: {{4}}',
        },
    },
    WHATSAPP_TEMPLATE_DELIVERY_PROOF: {
        type: 'delivery_proof',
        name: 'arteva_order_delivered',
        category: 'UTILITY',
        params: ['customer name', 'order number', 'proof or tracking URL'],
        examples: ['Sara', 'A7K2M9P4', 'https://www.artevamaisonkw.com/track/A7K2M9P4'],
        body: {
            en: 'Hello {{1}}, your ARTÉVA Maison order {{2}} has been delivered. Details: {{3}}',
            ar: 'مرحباً {{1}}، تم تسليم طلبك {{2}} من ARTÉVA Maison. التفاصيل: {{3}}',
        },
    },
    WHATSAPP_TEMPLATE_OWNER_NEW_ORDER: {
        type: 'owner_new_order',
        name: 'arteva_owner_new_order',
        category: 'UTILITY',
        params: ['order number', 'customer', 'total', 'item count'],
        examples: ['A7K2M9P4', 'Sara', '45.500 KWD', '3'],
        body: {
            en: 'New order {{1}} from {{2}}. Total {{3}}, {{4}} item(s).',
            ar: 'طلب جديد {{1}} من {{2}}. الإجمالي {{3}}، عدد القطع {{4}}.',
        },
    },
    WHATSAPP_TEMPLATE_INBOUND_FORWARD: {
        type: 'inbound_forward',
        name: 'arteva_customer_message',
        category: 'UTILITY',
        params: ['customer phone', 'their message'],
        examples: ['+96599887766', 'Do you have this vase in white?'],
        body: {
            en: 'Message from {{1}}: {{2}}',
            ar: 'رسالة من {{1}}: {{2}}',
        },
    },
    WHATSAPP_TEMPLATE_WELCOME: {
        type: 'welcome',
        name: 'arteva_welcome',
        category: 'UTILITY',
        params: ['customer name'],
        examples: ['Sara'],
        body: {
            en: 'Welcome to ARTÉVA Maison, {{1}}. We are delighted to have you with us.',
            ar: 'أهلاً بك في ARTÉVA Maison، {{1}}. يسعدنا انضمامك إلينا.',
        },
    },
    WHATSAPP_TEMPLATE_REFUND_RETURN: {
        type: 'refund_return',
        name: 'arteva_return_received',
        category: 'UTILITY',
        params: ['customer name', 'order number'],
        examples: ['Sara', 'A7K2M9P4'],
        body: {
            en: 'Hello {{1}}, we have received your return request for order {{2}}. Our team will contact you shortly.',
            ar: 'مرحباً {{1}}، استلمنا طلب الإرجاع الخاص بطلبك {{2}}. سيتواصل معك فريقنا قريباً.',
        },
    },
};

/** The language a template is submitted in when nothing says otherwise. */
const DEFAULT_TEMPLATE_LANGS = ['en', 'ar'];

// @desc    Submit the templates this shop needs to Meta for review
// @route   POST /api/whatsapp/templates/provision
// @access  Private/Admin
//
// Without approved templates the shop cannot message a customer who has not
// written to it in the last 24 hours, which is most of them — an order
// confirmation for a first-time buyer simply never arrives. Creating them
// over the Graph API means this does not depend on having a browser signed
// into Business Manager.
//
// Idempotent: anything already on the account is left alone, so re-running
// after a partial failure submits only what is missing rather than filing
// duplicates for review.
//
// Body (all optional):
//   languages  string[]  default ['en','ar']
//   only       string[]  restrict to these env var names
//   dryRun     boolean   report what would be submitted, send nothing
const provisionTemplates = asyncHandler(async (req, res) => {
    const existing = await client.listTemplates();
    if (!existing.success) {
        return res.status(existing.permanent ? 422 : 502).json({
            success: false,
            message: existing.error,
            hint: 'Needs WHATSAPP_ACCESS_TOKEN with whatsapp_business_management.',
        });
    }

    const requested = Array.isArray(req.body?.languages) && req.body.languages.length
        ? req.body.languages.map(l => String(l).toLowerCase())
        : DEFAULT_TEMPLATE_LANGS;

    const only = Array.isArray(req.body?.only) && req.body.only.length
        ? new Set(req.body.only.map(String))
        : null;

    const dryRun = req.body?.dryRun === true;

    /* A template name is unique per account but holds one version per
     * language, so "already there" is a name-and-language question. */
    const present = new Set(existing.templates.map(t => `${t.name}:${t.language}`));

    const created = [];
    const skipped = [];
    const failed = [];

    for (const [envVar, contract] of Object.entries(TEMPLATE_CONTRACTS)) {
        if (only && !only.has(envVar)) continue;

        for (const lang of requested) {
            const body = contract.body[lang];
            if (!body) {
                skipped.push({ envVar, name: contract.name, language: lang, reason: 'no wording written for this language' });
                continue;
            }

            if (present.has(`${contract.name}:${lang}`)) {
                skipped.push({ envVar, name: contract.name, language: lang, reason: 'already on the account' });
                continue;
            }

            if (dryRun) {
                created.push({ envVar, name: contract.name, language: lang, status: 'WOULD_SUBMIT', body });
                continue;
            }

            const result = await client.createTemplate({
                name: contract.name,
                language: lang,
                category: contract.category,
                body,
                examples: contract.examples,
            });

            if (result.success) {
                created.push({
                    envVar,
                    name: result.name,
                    language: result.language,
                    status: result.status,
                    category: result.category,
                });
            } else {
                /* Reported, not thrown. One rejected language must not stop
                 * the other six templates from being filed. */
                failed.push({ envVar, name: contract.name, language: lang, error: result.error, code: result.code });
            }
        }
    }

    // What to set once Meta approves them. The name is the same in every
    // language; the language is a separate variable.
    const envToSet = {};
    for (const [envVar, contract] of Object.entries(TEMPLATE_CONTRACTS)) {
        if (only && !only.has(envVar)) continue;
        envToSet[envVar] = contract.name;
    }

    res.json({
        success: failed.length === 0,
        data: {
            businessAccountId: existing.businessAccountId,
            dryRun,
            languages: requested,
            counts: { created: created.length, skipped: skipped.length, failed: failed.length },
            created,
            skipped,
            failed,
            envToSet,
            nextStep: dryRun
                ? 'Nothing was submitted. Re-send without dryRun to file these for review.'
                : 'Meta reviews these, usually within minutes to a few hours. Set the environment variables above once they read APPROVED in GET /api/whatsapp/templates.',
        },
    });
});

// @desc    Approved WhatsApp templates, checked against what the code sends
// @route   GET /api/whatsapp/templates
// @access  Private/Admin
//
// Exists so nobody has to read template names out of the Meta dashboard and
// retype them. It reports the exact value each environment variable should
// take, and refuses to recommend a template whose placeholder count does not
// match the parameters the code will supply.
const listTemplates = asyncHandler(async (req, res) => {
    const result = await client.listTemplates();

    if (!result.success) {
        return res.status(result.permanent ? 422 : 502).json({
            success: false,
            message: result.error,
            hint: 'Needs WHATSAPP_ACCESS_TOKEN with whatsapp_business_management, and either WHATSAPP_BUSINESS_ACCOUNT_ID or a phone number Meta can resolve to one.',
        });
    }

    const approved = result.templates.filter(t => t.status === 'APPROVED');

    /* Match each contract to an approved template. Name matching is a
     * convenience — the point is the parameter check, which is what actually
     * decides whether a send will work. */
    const suggestions = Object.entries(TEMPLATE_CONTRACTS).map(([envVar, contract]) => {
        const expected = contract.params.length;
        const candidates = approved
            .map(t => ({
                ...t,
                matchesParams: t.bodyParams === expected,
                // A variable in a button URL is a different payload shape and
                // is not something the notification paths currently send.
                needsButtonWiring: t.hasButtonVariable,
            }))
            .sort((a, b) => Number(b.matchesParams) - Number(a.matchesParams));

        const usable = candidates.filter(c => c.matchesParams && !c.needsButtonWiring);
        const current = process.env[envVar] || null;

        let verdict;
        if (current) {
            const inUse = approved.find(t => t.name === current);
            if (!inUse) {
                verdict = `SET BUT NOT APPROVED — "${current}" is not an approved template on this account. Every send of this type will fail with 132001.`;
            } else if (inUse.bodyParams !== expected) {
                verdict = `SET BUT MISMATCHED — "${current}" takes ${inUse.bodyParams} variable(s); the code sends ${expected}. Every send will fail with 132000.`;
            } else {
                verdict = 'OK';
            }
        } else {
            verdict = usable.length
                ? `Not set. ${usable.map(u => `"${u.name}" (${u.language})`).join(' or ')} would fit.`
                : 'Not set, and no approved template takes the right number of variables. Free-form text is used, which only reaches a customer within 24h of their own message.';
        }

        return {
            envVar,
            notificationType: contract.type,
            expectedParams: expected,
            paramMeaning: contract.params,
            suggestedBody: contract.body.en,
            currentValue: current,
            verdict,
            fits: usable.map(u => ({ name: u.name, language: u.language, bodyParams: u.bodyParams })),
        };
    });

    res.json({
        success: true,
        data: {
            businessAccountId: result.businessAccountId,
            counts: {
                total: result.templates.length,
                approved: approved.length,
                pending: result.templates.filter(t => t.status === 'PENDING').length,
                rejected: result.templates.filter(t => t.status === 'REJECTED').length,
            },
            templates: result.templates.map(t => ({
                name: t.name,
                status: t.status,
                language: t.language,
                category: t.category,
                bodyParams: t.bodyParams,
                hasButtonVariable: t.hasButtonVariable,
            })),
            suggestions,
        },
    });
});

// @desc    Is the WhatsApp integration configured and working?
// @route   GET /api/whatsapp/health
// @access  Public — reports configuration state only, never a credential
//
// Deliberately public so an uptime monitor can watch it without holding an
// admin session. `describe()` returns booleans and last-four fragments; the
// live check against Meta is opt-in via ?probe=1 because it costs a round trip
// and monitors poll often.
const health = asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const config = client.describe();

    const dbState = mongoose.connection?.readyState;
    const database = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';

    const missing = [];
    if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!process.env.WHATSAPP_VERIFY_TOKEN) missing.push('WHATSAPP_VERIFY_TOKEN');
    if (!process.env.WHATSAPP_APP_SECRET && !process.env.META_APP_SECRET) missing.push('WHATSAPP_APP_SECRET');

    let probe;
    if (req.query.probe === '1' && config.configured) {
        probe = await client.ping();
    }

    const healthy = config.configured && missing.length === 0 && database === 'connected'
        && (probe ? probe.ok : true);

    res.status(healthy ? 200 : 503).json({
        success: healthy,
        status: healthy ? 'healthy' : 'degraded',
        whatsapp: config.configured ? 'configured' : 'not configured',
        database,
        missing,
        config,
        ...(probe ? { probe } : {}),
    });
});

module.exports = {
    listTemplates,
    provisionTemplates,
    sendText,
    sendTemplate,
    sendMedia,
    uploadMedia,
    sendLocation,
    sendInteractive,
    markRead,
    listConversations,
    getConversation,
    getMessage,
    health,
};
