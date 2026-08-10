/**
 * Meta integration tests.
 *
 * Covers the parts that are easy to get wrong and impossible to notice when
 * they are: webhook authenticity, the greeting cooldown surviving a restart,
 * and whether a notification can actually be delivered outside Meta's 24-hour
 * window (i.e. whether it has template parameters at all).
 *
 * Run: npm run test:meta
 */
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
    cond ? pass++ : fail++;
};

/** Minimal res double capturing what the handler decided. */
function mockRes() {
    const res = { statusCode: null, body: null, headers: {} };
    res.sendStatus = (c) => { res.statusCode = c; return res; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    res.set = (k, v) => { res.headers[k] = v; return res; };
    return res;
}

const sign = (secret, body) =>
    'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

(async () => {
    const mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.NODE_ENV = 'production';   // exercise the fail-closed path
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'meta' });

    const meta = require('../src/controllers/metaController');
    const WhatsAppQueue = require('../src/models/WhatsAppQueue');

    // ── Webhook verification handshake ──
    {
        const res = mockRes();
        meta.verifyWhatsAppWebhook({
            query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc123' },
        }, res);
        check('GET webhook with the right token echoes the challenge', res.body === 'abc123', `got ${res.body}`);
    }
    {
        const res = mockRes();
        meta.verifyWhatsAppWebhook({
            query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' },
        }, res);
        check('GET webhook with a wrong token -> 403', res.statusCode === 403, `got ${res.statusCode}`);
    }
    {
        // An unset verify token must not turn into "anything matches".
        const saved = process.env.WHATSAPP_VERIFY_TOKEN;
        delete process.env.WHATSAPP_VERIFY_TOKEN;
        const res = mockRes();
        meta.verifyWhatsAppWebhook({
            query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'anything', 'hub.challenge': 'x' },
        }, res);
        check('GET webhook with no token configured -> 403', res.statusCode === 403, `got ${res.statusCode}`);
        process.env.WHATSAPP_VERIFY_TOKEN = saved;
    }

    // ── Signature enforcement ──
    const payload = JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: '96599999999', type: 'text', text: { body: 'hello' } }] } }] }],
    });

    {
        delete process.env.META_APP_SECRET;
        const res = mockRes();
        meta.handleWhatsAppWebhook({
            get: () => undefined, rawBody: Buffer.from(payload), body: JSON.parse(payload),
        }, res);
        check('POST webhook in production with no app secret -> 403 (fails closed)',
            res.statusCode === 403, `got ${res.statusCode}`);
    }
    {
        process.env.META_APP_SECRET = 'top-secret';
        const res = mockRes();
        meta.handleWhatsAppWebhook({
            get: () => sign('the-wrong-secret', payload),
            rawBody: Buffer.from(payload), body: JSON.parse(payload),
        }, res);
        check('POST webhook with a forged signature -> 401', res.statusCode === 401, `got ${res.statusCode}`);
    }
    {
        const res = mockRes();
        meta.handleWhatsAppWebhook({
            get: () => sign('top-secret', payload),
            rawBody: Buffer.from(payload), body: JSON.parse(payload),
        }, res);
        check('POST webhook with a valid signature -> 200', res.statusCode === 200, `got ${res.statusCode}`);
    }

    // ── Greeting cooldown reads from the log, so it survives a restart ──
    {
        const wa = require('../src/services/whatsappService');
        // Cloud API deliberately unconfigured: sends no-op, so this exercises the
        // decision logic without contacting Meta.
        const phone = '96588887777';
        await WhatsAppQueue.create({ phone, message: 'greeted', type: 'contact_auto_reply', status: 'sent' });

        const recent = await WhatsAppQueue.exists({
            phone, type: 'contact_auto_reply', createdAt: { $gte: new Date(Date.now() - 2 * 3600000) },
        });
        check('a greeting logged now counts as within the cooldown', Boolean(recent));

        /* Backdated through the raw driver on purpose: `timestamps: true` marks
         * createdAt immutable, so a Mongoose updateOne silently drops this and
         * the fixture never actually ages. */
        await WhatsAppQueue.collection.updateOne(
            { phone }, { $set: { createdAt: new Date(Date.now() - 3 * 3600000) } }
        );
        const stale = await WhatsAppQueue.exists({
            phone, type: 'contact_auto_reply', createdAt: { $gte: new Date(Date.now() - 2 * 3600000) },
        });
        check('a greeting from 3h ago is outside a 2h cooldown', !stale);

        const res2 = await wa.handleInboundMessage('96566665555', 'hi there');
        check('handleInboundMessage resolves without throwing', res2?.success === true, JSON.stringify(res2));

        const owners = await wa.getOwnerPhones();
        const fromOwner = await wa.handleInboundMessage(owners[0], 'internal note');
        check('a message from an owner is not auto-replied to', fromOwner?.skipped === 'owner', JSON.stringify(fromOwner));
    }

    // ── inbound_forward must be a valid enum value or the row is never written ──
    {
        let ok = true, why = '';
        try {
            await WhatsAppQueue.create({
                phone: '96500000000', message: 'fwd', type: 'inbound_forward', status: 'sent',
            });
        } catch (e) { ok = false; why = e.message; }
        check('type "inbound_forward" passes model validation', ok, why);
    }

    // ── Every proactive notification needs template params ──
    {
        const wa = require('../src/services/whatsappService');
        const seen = {};
        const original = wa.sendMessage.bind(wa);
        wa.sendMessage = async (to, message, type, orderId, templateParams) => {
            seen[type] = templateParams;
            return { success: true };
        };

        const order = {
            _id: new mongoose.Types.ObjectId(), orderNumber: 'T-1', total: 10, currency: 'KWD',
            items: [{ name: 'x', quantity: 1, price: 10 }],
            shippingAddress: { street: 's', city: 'c', country: 'Kuwait', phone: '96511112222' },
            paymentMethod: 'knet', orderStatus: 'packed', paymentStatus: 'paid',
        };
        const user = { name: 'A', email: 'a@b.c', phone: '96511112222' };

        await wa.notifyCustomerOrderStatusChange(order, user, 'packed');
        await wa.notifyCustomerDelivery(order, user, '/proof.jpg');
        await wa.sendWelcomeMessage(user);
        await wa.sendRefundReturnNotification(order, user);
        await wa.notifyOwnerNewOrder(order, user);

        // Outside the 24-hour window these can ONLY be delivered as a template,
        // and templateFor() is consulted only when params are supplied.
        for (const t of ['status_update', 'delivery_proof', 'welcome', 'refund_return', 'owner_new_order']) {
            check(`${t} supplies template params`,
                Array.isArray(seen[t]) && seen[t].length > 0,
                `got ${JSON.stringify(seen[t])}`);
        }
        check('delivery_proof no longer shares the status_update type',
            seen.delivery_proof !== undefined);

        wa.sendMessage = original;
    }

    // ── templateFor reads env, and stays off until named ──
    {
        const wa = require('../src/services/whatsappService');
        delete process.env.WHATSAPP_TEMPLATE_STATUS_UPDATE;
        check('no template configured -> free-form (null)', wa.templateFor('status_update') === null);
        process.env.WHATSAPP_TEMPLATE_STATUS_UPDATE = 'order_status_v1';
        process.env.WHATSAPP_TEMPLATE_STATUS_UPDATE_LANG = 'ar';
        const tpl = wa.templateFor('status_update');
        check('configured template is picked up with its language',
            tpl?.name === 'order_status_v1' && tpl?.language === 'ar', JSON.stringify(tpl));
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
