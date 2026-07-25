/**
 * End-to-end smoke test.
 *
 * Boots the real Express app against an in-memory MongoDB and exercises the
 * flows this feature set added: promo visit tracking, manual receipts and
 * their stock movements, source filtering, refunds, owner-only deletion, and
 * the revenue endpoint.
 *
 * Run: npm run test:api
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
    cond ? pass++ : fail++;
};

(async () => {
    const mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.JWT_SECRET = 'test-secret-for-smoke-only';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '5199';

    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'smoke' });

    const jwt = require('jsonwebtoken');
    const User = require('../src/models/User');
    const Product = require('../src/models/Product');
    const Order = require('../src/models/Order');
    const PromoCode = require('../src/models/PromoCode');
    const PromoVisit = require('../src/models/PromoVisit');
    const Category = require('../src/models/Category');

    const owner = await User.create({ name: 'Owner', email: 'owner@x.com', password: 'password123', role: 'owner' });
    const admin = await User.create({ name: 'Admin', email: 'admin@x.com', password: 'password123', role: 'admin' });
    const tok = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET);

    const cat = await Category.create({ name: 'Decor', slug: 'decor' });
    const product = await Product.create({
        name: 'Smoke Vase', price: 12.5, category: cat._id, stock: 20, sku: 'SV1',
    });

    await PromoCode.create({
        code: 'SMOKE10',
        name: 'Smoke 10%',
        expiresAt: new Date(Date.now() + 8.64e7),
        products: [{ product: product._id, discountType: 'percentage', discountValue: 10 }],
    });

    // Boot the real app with all its routes and middleware.
    require('../src/server');
    const base = 'http://127.0.0.1:5199/api';
    await new Promise(r => setTimeout(r, 2000));

    const req = async (path, opts = {}, token) => {
        const res = await fetch(base + path, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...opts.headers,
            },
        });
        let body = null;
        try { body = await res.json(); } catch { /* non-JSON */ }
        return { status: res.status, body };
    };

    // ── 1. Promo visit tracking (public, logged-out) ──
    const visit = await req('/promo-codes/track-visit', {
        method: 'POST',
        body: JSON.stringify({ code: 'SMOKE10', visitorId: 'visitor-abc', landingPage: '/', source: 'link' }),
    });
    check('POST /promo-codes/track-visit -> 200', visit.status === 200, JSON.stringify(visit.body));
    check('  returns a visitId', !!visit.body?.data?.visitId, JSON.stringify(visit.body));

    await req('/promo-codes/track-visit', {
        method: 'POST',
        body: JSON.stringify({ code: 'SMOKE10', visitorId: 'visitor-abc', landingPage: '/x' }),
    });
    check('  same visitor same day deduplicated', (await PromoVisit.countDocuments()) === 1);

    const bogus = await req('/promo-codes/track-visit', {
        method: 'POST',
        body: JSON.stringify({ code: 'NOPE', visitorId: 'v2' }),
    });
    check('  unknown code accepted but not stored', bogus.status === 200 && bogus.body.data === null);

    // ── 2. Validation uses the shared calculator ──
    const val = await req('/promo-codes/validate', {
        method: 'POST',
        body: JSON.stringify({ code: 'SMOKE10', cartItems: [{ product: product._id, price: 12.5, quantity: 2 }] }),
    }, tok(admin));
    check('POST /promo-codes/validate -> 200', val.status === 200, JSON.stringify(val.body));
    check('  10% of 25.000 = 2.500', val.body?.data?.totalDiscount === 2.5, JSON.stringify(val.body?.data));

    // ── 3. Manual receipt creation deducts stock and prices the promo ──
    const created = await req('/admin/orders', {
        method: 'POST',
        body: JSON.stringify({
            user: { name: 'Walk-in', email: 'walkin@x.com', phone: '+96550000000' },
            shippingAddress: { street: 'Shop', city: 'Kuwait City' },
            items: [{ product: product._id, name: 'Smoke Vase', sku: 'SV1', price: 12.5, quantity: 3 }],
            shippingCost: 2,
            paymentStatus: 'paid',
            promoCode: 'SMOKE10',
        }),
    }, tok(admin));
    check('POST /admin/orders -> 201', created.status === 201, JSON.stringify(created.body));
    const orderId = created.body?.data?._id;
    check('  tagged orderSource=manual', created.body?.data?.orderSource === 'manual');
    check('  stock 20 -> 17', (await Product.findById(product._id)).stock === 17);
    check('  promo priced server-side (3.750)', created.body?.data?.discount === 3.75, String(created.body?.data?.discount));
    check('  total 37.5 + 2 - 3.75 = 35.750', created.body?.data?.total === 35.75, String(created.body?.data?.total));

    // ── 4. Overselling is refused, with nothing written ──
    const over = await req('/admin/orders', {
        method: 'POST',
        body: JSON.stringify({
            user: { name: 'X', email: 'x@x.com' },
            shippingAddress: { street: 's', city: 'c' },
            items: [{ product: product._id, name: 'Smoke Vase', price: 12.5, quantity: 999 }],
        }),
    }, tok(admin));
    check('oversell receipt -> 409', over.status === 409, `${over.status} ${JSON.stringify(over.body)}`);
    check('  stock unchanged at 17', (await Product.findById(product._id)).stock === 17);

    // ── 5. Editing a receipt moves only the delta ──
    const edited = await req(`/admin/orders/${orderId}/receipt`, {
        method: 'PUT',
        body: JSON.stringify({
            items: [{ product: product._id, name: 'Smoke Vase', price: 12.5, quantity: 5 }],
            shippingCost: 2,
        }),
    }, tok(admin));
    check('PUT receipt qty 3 -> 5 -> 200', edited.status === 200, JSON.stringify(edited.body).slice(0, 200));
    check('  stock 17 -> 15 (delta only)', (await Product.findById(product._id)).stock === 15);

    // ── 6. Source filters ──
    const manual = await req('/admin/orders?source=manual', {}, tok(admin));
    const online = await req('/admin/orders?source=online', {}, tok(admin));
    check('GET /admin/orders?source=manual -> 1', manual.body?.data?.length === 1, String(manual.body?.data?.length));
    check('GET /admin/orders?source=online -> 0', online.body?.data?.length === 0, String(online.body?.data?.length));
    check('  tab counts returned', manual.body?.counts?.manual === 1);

    // ── 7. Refunding an item restores its stock ──
    const ord = await Order.findById(orderId);
    const refund = await req(`/admin/orders/${orderId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ type: 'item', itemId: ord.items[0]._id }),
    }, tok(admin));
    check('POST refund item -> 200', refund.status === 200, JSON.stringify(refund.body).slice(0, 200));
    check('  stock 15 -> 20 restored', (await Product.findById(product._id)).stock === 20);

    // ── 8. Deletion is owner-only ──
    const adminDelete = await req(`/admin/orders/${orderId}`, { method: 'DELETE' }, tok(admin));
    check('DELETE as admin -> 403', adminDelete.status === 403, String(adminDelete.status));
    check('  order still present', (await Order.countDocuments()) === 1);

    const ownerDelete = await req(`/admin/orders/${orderId}`, { method: 'DELETE' }, tok(owner));
    check('DELETE as owner -> 200', ownerDelete.status === 200, JSON.stringify(ownerDelete.body));
    check('  order removed', (await Order.countDocuments()) === 0);

    // ── 9. Revenue is owner-only ──
    const revAdmin = await req('/admin/revenue/overview', {}, tok(admin));
    check('GET revenue as admin -> 403', revAdmin.status === 403, String(revAdmin.status));

    const revOwner = await req('/admin/revenue/overview?preset=month', {}, tok(owner));
    check('GET revenue as owner -> 200', revOwner.status === 200, JSON.stringify(revOwner.body).slice(0, 200));
    check('  reports net total', typeof revOwner.body?.data?.totals?.net === 'number');
    check('  splits by source', !!revOwner.body?.data?.bySource?.manual);

    // ── 10. Promo analytics answer on the prefix the admin UI calls ──
    const analytics = await req('/admin/promo-codes/analytics', {}, tok(admin));
    check('GET /admin/promo-codes/analytics -> 200', analytics.status === 200, String(analytics.status));
    check('  lists codes with visit data', Array.isArray(analytics.body?.data?.codes));

    await mongoose.disconnect();
    await mongod.stop();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
