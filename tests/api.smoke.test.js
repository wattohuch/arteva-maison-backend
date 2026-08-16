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

    // ── 9. Revenue is owner-only AND password-gated ──
    const revAdmin = await req('/admin/revenue/overview', {}, tok(admin));
    check('GET revenue as admin -> 403', revAdmin.status === 403, String(revAdmin.status));

    // superuser is the developer account and is deliberately shut out of the
    // takings, unlike everywhere else where it inherits owner's powers.
    const superuser = await User.create({ name: 'Dev', email: 'dev@x.com', password: 'password123', role: 'superuser' });
    const revSuper = await req('/admin/revenue/overview', {}, tok(superuser));
    check('GET revenue as superuser -> 403', revSuper.status === 403, String(revSuper.status));

    // Being the owner is not enough on its own: the revenue password has to be
    // exchanged for an unlock token first.
    const revLocked = await req('/admin/revenue/overview?preset=month', {}, tok(owner));
    check('GET revenue as owner without unlock -> 403', revLocked.status === 403, String(revLocked.status));
    check('  reports REVENUE_LOCKED', revLocked.body?.code === 'REVENUE_LOCKED', JSON.stringify(revLocked.body));

    const setPw = await req('/admin/set-revenue-password', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'vault-secret-1' }),
    }, tok(owner));
    check('POST set-revenue-password as owner -> 200', setPw.status === 200, JSON.stringify(setPw.body));

    const badPw = await req('/admin/revenue-auth', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'wrong-password' }),
    }, tok(owner));
    check('POST revenue-auth with wrong password -> 401', badPw.status === 401, String(badPw.status));

    const unlock = await req('/admin/revenue-auth', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'vault-secret-1' }),
    }, tok(owner));
    check('POST revenue-auth -> 200', unlock.status === 200, JSON.stringify(unlock.body).slice(0, 200));
    check('  returns an unlock token', typeof unlock.body?.revenueToken === 'string');

    // A login JWT must not be accepted in place of a scoped unlock token.
    const wrongScope = await req('/admin/revenue/overview?preset=month', {
        headers: { 'X-Revenue-Token': tok(owner) },
    }, tok(owner));
    check('GET revenue with login JWT as unlock -> 403', wrongScope.status === 403, String(wrongScope.status));

    const revOwner = await req('/admin/revenue/overview?preset=month', {
        headers: { 'X-Revenue-Token': unlock.body.revenueToken },
    }, tok(owner));
    check('GET revenue as unlocked owner -> 200', revOwner.status === 200, JSON.stringify(revOwner.body).slice(0, 200));

    // ── 9b. The dashboard tile's figure is gated the same way ──
    // The tile is blurred client-side, but blur is only styling: what actually
    // protects the number is that it is never in the /admin/stats payload and
    // /revenue/total refuses anyone without an unlock.
    const statsAdmin = await req('/admin/stats', {}, tok(admin));
    check('GET /admin/stats -> 200', statsAdmin.status === 200, String(statsAdmin.status));
    check('  carries no revenue for admin', statsAdmin.body?.data?.totalRevenue === undefined);
    check('  canSeeRevenue false for admin', statsAdmin.body?.data?.canSeeRevenue === false);

    const statsOwner = await req('/admin/stats', {}, tok(owner));
    check('  carries no revenue for owner either', statsOwner.body?.data?.totalRevenue === undefined);
    check('  canSeeRevenue true for owner', statsOwner.body?.data?.canSeeRevenue === true);

    const totalAdmin = await req('/admin/revenue/total', {}, tok(admin));
    check('GET revenue/total as admin -> 403', totalAdmin.status === 403, String(totalAdmin.status));

    const totalLocked = await req('/admin/revenue/total', {}, tok(owner));
    check('GET revenue/total as locked owner -> 403', totalLocked.status === 403, String(totalLocked.status));

    const totalOwner = await req('/admin/revenue/total', {
        headers: { 'X-Revenue-Token': unlock.body.revenueToken },
    }, tok(owner));
    check('GET revenue/total as unlocked owner -> 200', totalOwner.status === 200, String(totalOwner.status));
    check('  returns a number', typeof totalOwner.body?.data?.totalRevenue === 'number');
    check('  reports net total', typeof revOwner.body?.data?.totals?.net === 'number');
    check('  splits by source', !!revOwner.body?.data?.bySource?.manual);

    // ── 10. Promo analytics answer on the prefix the admin UI calls ──
    const analytics = await req('/admin/promo-codes/analytics', {}, tok(admin));
    check('GET /admin/promo-codes/analytics -> 200', analytics.status === 200, String(analytics.status));
    check('  lists codes with visit data', Array.isArray(analytics.body?.data?.codes));

    // ── 11. Delivery endpoints are staff-only ──
    // Both move an order along the workflow and `delivered` marks a COD order
    // PAID, so a customer reaching either is a way to get goods without paying.
    const customer = await User.create({ name: 'Cust', email: 'cust@x.com', password: 'password123', role: 'user' });
    const victim = await Order.create({
        user: customer._id, orderNumber: 'VICTIM01', items: [], paymentMethod: 'cod',
        subtotal: 0, total: 0, shippingAddress: { street: 'a', city: 'b', phone: '1' },
    });

    const anonLoc = await req(`/delivery/location/${victim._id}`, {
        method: 'PUT', body: JSON.stringify({ lat: 29.3, lng: 47.9 }),
    });
    check('PUT /delivery/location unauthenticated -> 401', anonLoc.status === 401, String(anonLoc.status));

    const custLoc = await req(`/delivery/location/${victim._id}`, {
        method: 'PUT', body: JSON.stringify({ lat: 29.3, lng: 47.9 }),
    }, tok(customer));
    check('PUT /delivery/location as customer -> 403', custLoc.status === 403, String(custLoc.status));

    const custStatus = await req(`/delivery/status/${victim._id}`, {
        method: 'PUT', body: JSON.stringify({ status: 'delivered' }),
    }, tok(customer));
    check('PUT /delivery/status as customer -> 403', custStatus.status === 403, String(custStatus.status));
    check('  COD order not marked paid',
        (await Order.findById(victim._id)).paymentStatus !== 'paid');

    const adminStatus = await req(`/delivery/status/${victim._id}`, {
        method: 'PUT', body: JSON.stringify({ status: 'confirmed' }),
    }, tok(admin));
    check('PUT /delivery/status as admin -> 200', adminStatus.status === 200, JSON.stringify(adminStatus.body).slice(0, 160));

    // ── 12. Validation layer rejects bad input with a typed error ──
    const badLogin = await req('/auth/login', {
        method: 'POST', body: JSON.stringify({ email: 'not-an-email' }),
    });
    check('POST /auth/login invalid -> 400', badLogin.status === 400, String(badLogin.status));
    check('  code is VALIDATION_ERROR', badLogin.body?.code === 'VALIDATION_ERROR', JSON.stringify(badLogin.body));
    check('  names the offending fields',
        Array.isArray(badLogin.body?.details) && badLogin.body.details.some(d => d.field === 'password'),
        JSON.stringify(badLogin.body?.details));

    // A negative quantity used to pass the stock check (it is always < stock).
    const badQty = await req('/cart', {
        method: 'POST', body: JSON.stringify({ productId: String(product._id), quantity: -5 }),
    }, tok(customer));
    check('POST /cart negative quantity -> 400', badQty.status === 400, String(badQty.status));

    const badId = await req('/orders/not-a-real-id', {}, tok(customer));
    check('GET /orders/:id malformed id -> 400', badId.status === 400, String(badId.status));

    const badStatus = await req(`/delivery/status/${victim._id}`, {
        method: 'PUT', body: JSON.stringify({ status: 'teleported' }),
    }, tok(admin));
    check('PUT /delivery/status bad enum -> 400', badStatus.status === 400, String(badStatus.status));

    // ── 13. Pagination is bounded ──
    const huge = await req('/orders?limit=99999999', {}, tok(customer));
    check('GET /orders?limit=99999999 -> 400', huge.status === 400, String(huge.status));

    // ── 14. Visitor log carries the products each IP looked at ──
    // The page shows them as thumbnails, so the photo has to come back with
    // the row — a count alone does not answer "what were they looking at".
    const SiteVisit = require('../src/models/SiteVisit');
    const ProductView = require('../src/models/ProductView');
    const visitDay = new Date().toISOString().split('T')[0];

    await Product.updateOne(
        { _id: product._id },
        { $set: { images: [{ url: '/img/vase-a.png', isPrimary: true }, { url: '/img/vase-b.png' }] } },
    );
    const secondProduct = await Product.create({
        name: 'Smoke Lamp', price: 30, category: cat._id, stock: 5, sku: 'SL1',
        images: [{ url: '/img/lamp.png', isPrimary: true }],
    });

    await SiteVisit.create({ ip: '203.0.113.9', date: visitDay, page: '/', userAgent: 'Mozilla/5.0' });
    await ProductView.create({ product: product._id, ip: '203.0.113.9', date: visitDay });
    await ProductView.create({ product: secondProduct._id, ip: '203.0.113.9', date: visitDay });

    const vlog = await req('/admin/analytics/visitor-log', {}, tok(admin));
    check('GET /admin/analytics/visitor-log -> 200', vlog.status === 200, String(vlog.status));

    const ipRow = (vlog.body?.data?.byIp || []).find(r => r.ip === '203.0.113.9');
    check('  rolls the IP up', !!ipRow, JSON.stringify(vlog.body?.data?.byIp));
    check('  lists both products viewed', ipRow?.products?.length === 2 && ipRow.productCount === 2,
        JSON.stringify(ipRow?.products));
    check('  each product carries its primary photo',
        (ipRow?.products || []).every(p => p.image && p.name),
        JSON.stringify(ipRow?.products));

    const logRow = (vlog.body?.data?.log || []).find(r => r.ip === '203.0.113.9');
    check('  the day entry carries them too', logRow?.products?.length === 2, JSON.stringify(logRow?.products));

    // ── 15. Role changes cannot orphan the shop ──
    // `owner` is the only role that opens revenue, and this is the screen that
    // hands it over, so both directions of the handover have to work.
    // An admin cannot touch the owner at all — that guard comes first.
    const adminTouchesOwner = await req(`/admin/users/${owner._id}`, {
        method: 'PUT', body: JSON.stringify({ role: 'admin' }),
    }, tok(admin));
    check('PUT /admin/users owner row, as admin -> 403', adminTouchesOwner.status === 403, String(adminTouchesOwner.status));

    // The owner may, but not while they are the only one.
    const soleOwner = await req(`/admin/users/${owner._id}`, {
        method: 'PUT', body: JSON.stringify({ role: 'admin' }),
    }, tok(owner));
    check('PUT /admin/users demoting the only owner -> 400', soleOwner.status === 400, String(soleOwner.status));

    const selfLockout = await req(`/admin/users/${admin._id}`, {
        method: 'PUT', body: JSON.stringify({ role: 'user' }),
    }, tok(admin));
    check('PUT /admin/users removing your own access -> 400', selfLockout.status === 400, String(selfLockout.status));

    const bogusRole = await req(`/admin/users/${customer._id}`, {
        method: 'PUT', body: JSON.stringify({ role: 'ceo' }),
    }, tok(admin));
    check('PUT /admin/users unknown role -> 400', bogusRole.status === 400, String(bogusRole.status));

    // With a second owner appointed, the first can step down — the handover
    // the Users screen exists to perform.
    const newOwner = await User.create({ name: 'Real Owner', email: 'real@x.com', password: 'password123', role: 'admin' });
    const appoint = await req(`/admin/users/${newOwner._id}`, {
        method: 'PUT', body: JSON.stringify({ role: 'owner' }),
    }, tok(owner));
    check('PUT /admin/users appointing a second owner -> 200', appoint.status === 200, String(appoint.status));

    const stepDown = await req(`/admin/users/${owner._id}`, {
        method: 'PUT', body: JSON.stringify({ role: 'admin' }),
    }, tok(owner));
    check('  the outgoing owner can then step down', stepDown.status === 200, JSON.stringify(stepDown.body).slice(0, 160));
    check('  and no longer holds owner', (await User.findById(owner._id)).role === 'admin');

    await mongoose.disconnect();
    await mongod.stop();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
