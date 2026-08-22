/**
 * Twilio WhatsApp transport and inbound webhook.
 *
 * The webhook is public and its signature is the ONLY thing separating a real
 * customer from anyone who learned the URL, so most of this file is about that
 * boundary rather than the happy path.
 */

const assert = require('assert');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`PASS  ${label}`);
    } else {
        failed++;
        failures.push(label);
        console.log(`FAIL  ${label}${detail ? `  -> ${detail}` : ''}`);
    }
}

function section(title) {
    console.log(`\n── ${title} ──`);
}

// Configure before requiring, since the client reads env lazily but the
// service logs at construction.
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
process.env.TWILIO_WHATSAPP_FROM = '+14155238886';

const twilio = require('../src/services/twilioWhatsAppClient');
const { verifyTwilioSignature } = require('../src/controllers/twilioWebhookController');

(async () => {
    section('Address handling');

    check('sender is normalised to whatsapp:+E164',
        twilio.from === 'whatsapp:+14155238886', twilio.from);

    process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
    check('  an already-prefixed sender is not double-prefixed',
        twilio.from === 'whatsapp:+14155238886', twilio.from);

    process.env.TWILIO_WHATSAPP_FROM = '14155238886';
    check('  a bare sender gains the + and the prefix',
        twilio.from === 'whatsapp:+14155238886', twilio.from);
    process.env.TWILIO_WHATSAPP_FROM = '+14155238886';

    check('recipients are converted from plain digits',
        twilio.toAddress('96550683207') === 'whatsapp:+96550683207', twilio.toAddress('96550683207'));
    check('  spaces and punctuation are stripped',
        twilio.toAddress('+965 5068-3207') === 'whatsapp:+96550683207', twilio.toAddress('+965 5068-3207'));
    check('  an empty number yields no address rather than a broken one',
        twilio.toAddress('') === '', JSON.stringify(twilio.toAddress('')));

    section('Configuration reporting');

    check('a fully configured client reports ready', twilio.isConfigured === true);

    const savedSid = process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_ACCOUNT_SID;
    check('  a missing account sid makes it not ready', twilio.isConfigured === false);
    check('  and it names the variable to set',
        twilio.missingConfig().some(m => m.includes('TWILIO_ACCOUNT_SID')),
        JSON.stringify(twilio.missingConfig()));
    process.env.TWILIO_ACCOUNT_SID = savedSid;

    section('Sending guards');

    const noRecipient = await twilio.sendText('', 'hello');
    check('sending with no recipient fails permanently, not by retrying',
        noRecipient.success === false && noRecipient.permanent === true,
        JSON.stringify(noRecipient));

    /* Twilio identifies templates by Content SID. A Meta-style NAME cannot be
     * resolved, and silently sending nothing would surface only as a customer
     * never receiving their order confirmation — so it must fail loudly. */
    const badTemplate = await twilio.sendTemplate('96550683207', 'order_confirmed', 'en', ['a']);
    check('a Meta-style template NAME is refused with an actionable message',
        badTemplate.success === false
        && badTemplate.permanent === true
        && /Content SID/i.test(badTemplate.error),
        JSON.stringify(badTemplate).slice(0, 160));

    section('Webhook signature — the only authentication this endpoint has');

    const url = 'https://example.com/api/whatsapp/twilio';
    const token = 'test-auth-token';
    const params = { From: 'whatsapp:+96550683207', Body: 'Hello', MessageSid: 'SM123' };

    // Twilio's scheme: URL, then each param as key+value in sorted key order.
    const sign = (u, p, t) => {
        const payload = Object.keys(p).sort().reduce((acc, k) => acc + k + p[k], u);
        return crypto.createHmac('sha1', t).update(Buffer.from(payload, 'utf-8')).digest('base64');
    };

    check('a correctly signed request is accepted',
        verifyTwilioSignature(url, params, token, sign(url, params, token)) === true);

    check('a request signed with the wrong token is rejected',
        verifyTwilioSignature(url, params, token, sign(url, params, 'not-the-token')) === false);

    check('a tampered body is rejected',
        verifyTwilioSignature(url, { ...params, Body: 'Transfer money' }, token, sign(url, params, token)) === false,
        'body changed after signing');

    check('a signature for a different URL is rejected',
        verifyTwilioSignature(url, params, token, sign('https://evil.example/hook', params, token)) === false,
        'guards against replay against another endpoint');

    check('a missing signature header is rejected',
        verifyTwilioSignature(url, params, token, undefined) === false);

    check('no configured token means nothing can be verified',
        verifyTwilioSignature(url, params, '', sign(url, params, token)) === false);

    /* Parameter ORDER must not matter: Twilio sorts keys before signing, and an
     * implementation that depended on object insertion order would verify in
     * testing and fail intermittently in production. */
    const reordered = { MessageSid: 'SM123', Body: 'Hello', From: 'whatsapp:+96550683207' };
    check('parameter order does not affect verification',
        verifyTwilioSignature(url, reordered, token, sign(url, params, token)) === true);

    section('Provider switching');

    const whatsapp = require('../src/services/whatsappService');
    check('the service reports enabled on Twilio credentials alone',
        whatsapp.isOfficialEnabled === true,
        'must not require Meta credentials when provider is twilio');

    process.env.WHATSAPP_PROVIDER = 'meta';
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    check('  and disabled when switched to Meta with no Meta credentials',
        whatsapp.isOfficialEnabled === false);
    process.env.WHATSAPP_PROVIDER = 'twilio';

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failures.length) console.log(`Failing: ${failures.join(' | ')}`);
    process.exit(failed ? 1 : 0);
})().catch(err => {
    console.error('Test run crashed:', err);
    process.exit(1);
});
