/**
 * ARTEVA Maison — WhatsApp message template definitions and provisioning
 *
 * Free-form WhatsApp text only reaches a customer within 24 hours of their own
 * last message. Every order notification this shop sends falls outside that
 * window, so each one needs a template Meta has approved. Without them a
 * first-time buyer's confirmation is refused with 131047 and never arrives.
 *
 * This module owns two things:
 *
 *   The contract for each notification — the template name, its wording in
 *   each language, and how many variables the code will supply. That count is
 *   the part worth guarding: a template approved with three variables and sent
 *   four is refused with 132000, and the only symptom is a customer saying
 *   nothing came.
 *
 *   Provisioning — filing those templates with Meta over the Graph API, so it
 *   does not depend on a browser signed into Business Manager.
 *
 * Keep the params arrays in step with the templateParams arrays in
 * whatsappService.
 */

const client = require('./whatsappCloudClient');

/**
 * Every notification type, keyed by the environment variable that names its
 * template. `params` describes what the code sends, in order; `examples`
 * supplies Meta one sample per placeholder, which it requires at submission.
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

/** The languages a template is submitted in when nothing says otherwise. */
const DEFAULT_TEMPLATE_LANGS = ['en', 'ar'];

/**
 * File the templates this shop needs with Meta.
 *
 * Idempotent by name and language: anything already on the account is skipped,
 * so re-running after a partial failure submits only what is missing rather
 * than queueing duplicates for review. That includes templates Meta has
 * *rejected* — a rejected name is deliberately not resubmitted, because the
 * wording is what it objected to and sending it again would just be refused
 * a second time. Delete it in the dashboard to try a new version.
 *
 * @param {object}   [opts]
 * @param {string[]} [opts.languages] default ['en','ar']
 * @param {string[]} [opts.only]      restrict to these env var names
 * @param {boolean}  [opts.dryRun]    report what would be filed, send nothing
 * @returns {Promise<object>} a report, or { ok: false, error } if Meta is unreachable
 */
async function provision(opts = {}) {
    const existing = await client.listTemplates();
    if (!existing.success) {
        return { ok: false, permanent: existing.permanent === true, error: existing.error };
    }

    const languages = Array.isArray(opts.languages) && opts.languages.length
        ? opts.languages.map(l => String(l).toLowerCase())
        : DEFAULT_TEMPLATE_LANGS;

    const only = Array.isArray(opts.only) && opts.only.length
        ? new Set(opts.only.map(String))
        : null;

    const dryRun = opts.dryRun === true;

    /* A template name is unique per account but holds one version per
     * language, so "already there" is a name-and-language question. */
    const present = new Map(existing.templates.map(t => [`${t.name}:${t.language}`, t.status]));

    const created = [];
    const skipped = [];
    const failed = [];

    for (const [envVar, contract] of Object.entries(TEMPLATE_CONTRACTS)) {
        if (only && !only.has(envVar)) continue;

        for (const language of languages) {
            const body = contract.body[language];
            const row = { envVar, name: contract.name, language };

            if (!body) {
                skipped.push({ ...row, reason: 'no wording written for this language' });
                continue;
            }

            const already = present.get(`${contract.name}:${language}`);
            if (already) {
                skipped.push({ ...row, reason: `already on the account (${already})`, status: already });
                continue;
            }

            if (dryRun) {
                created.push({ ...row, status: 'WOULD_SUBMIT', body });
                continue;
            }

            const result = await client.createTemplate({
                name: contract.name,
                language,
                category: contract.category,
                body,
                examples: contract.examples,
            });

            if (result.success) {
                created.push({ ...row, status: result.status, category: result.category });
            } else {
                /* Recorded, not thrown. One rejected language must not stop the
                 * other templates from being filed. */
                failed.push({ ...row, error: result.error, code: result.code });
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

    return {
        ok: failed.length === 0,
        businessAccountId: existing.businessAccountId,
        dryRun,
        languages,
        counts: { created: created.length, skipped: skipped.length, failed: failed.length },
        created,
        skipped,
        failed,
        envToSet,
    };
}

/**
 * Run provisioning at start-up when WHATSAPP_PROVISION_TEMPLATES is set.
 *
 * The alternative is an authenticated API call, which needs a signed-in admin
 * session — awkward when the person who can reach Meta and the person who can
 * reach the dashboard are not at the same machine. A configuration flag can be
 * set wherever the other WhatsApp variables already are.
 *
 * Never throws and never blocks the boot: the shop must start whether or not
 * Meta is reachable.
 */
async function provisionOnBoot() {
    if (process.env.WHATSAPP_PROVISION_TEMPLATES !== 'true') return;

    const dryRun = process.env.WHATSAPP_PROVISION_DRY_RUN === 'true';

    try {
        console.log(`[WA-TPL] WHATSAPP_PROVISION_TEMPLATES is on — ${dryRun ? 'checking' : 'filing'} templates with Meta…`);
        const report = await provision({ dryRun });

        if (!report.ok && report.error) {
            console.error(`[WA-TPL] Could not reach Meta: ${report.error}`);
            if (/permission|OAuth|token/i.test(report.error)) {
                console.error('[WA-TPL] The access token needs the whatsapp_business_management permission; whatsapp_business_messaging alone can send but cannot manage templates.');
            }
            return;
        }

        for (const t of report.created) {
            console.log(`[WA-TPL]   ${dryRun ? 'would file' : 'filed'} ${t.name} (${t.language}) → ${t.status}`);
        }
        for (const t of report.skipped) {
            console.log(`[WA-TPL]   skipped ${t.name} (${t.language}) — ${t.reason}`);
        }
        for (const t of report.failed) {
            console.error(`[WA-TPL]   FAILED ${t.name} (${t.language}) — ${t.error}`);
        }

        console.log(`[WA-TPL] ${report.counts.created} filed, ${report.counts.skipped} skipped, ${report.counts.failed} failed.`);

        if (!dryRun && report.counts.created > 0) {
            console.log('[WA-TPL] Meta reviews these, usually within minutes. Set these once they read APPROVED:');
            for (const [envVar, name] of Object.entries(report.envToSet)) {
                console.log(`[WA-TPL]   ${envVar}=${name}`);
            }
        }

        if (report.counts.failed === 0 && report.counts.created === 0) {
            console.log('[WA-TPL] Nothing left to file. WHATSAPP_PROVISION_TEMPLATES can be removed.');
        }
    } catch (err) {
        // Provisioning is a convenience. A shop that will not start because a
        // template could not be filed is a worse outcome than one with no
        // templates.
        console.error(`[WA-TPL] Provisioning failed unexpectedly: ${err.message}`);
    }
}

module.exports = {
    TEMPLATE_CONTRACTS,
    DEFAULT_TEMPLATE_LANGS,
    provision,
    provisionOnBoot,
};
