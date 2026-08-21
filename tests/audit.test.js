/**
 * End-to-end verification for the audit work.
 *
 * Boots the real Express app against an in-memory MongoDB and exercises the
 * actual HTTP surface — no mocks, no stubbing of the auth layer — because the
 * whole point of this round of fixes is that the API is the thing enforcing
 * the rules, not the UI in front of it.
 *
 * Covers, in order:
 *   1. Revenue password: access, refusal, session survival, lockout, recovery
 *   2. Cashier role: what it can and cannot reach by direct API call
 *   3. Refunds and stock restoration, including legacy orders and replays
 *   4. Ordering more than exists
 *   5. Access-token expiry, refresh, rotation and reuse detection
 *
 * Run: npm run test:audit
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0;
let fail = 0;
const failures = [];

const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
    if (cond) pass++; else { fail++; failures.push(name); }
};

const section = (title) => console.log(`\n── ${title} ──`);

(async () => {
    const mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.JWT_SECRET = 'audit-test-secret';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '5211';
    // Short enough to expire inside the test without sleeping for hours.
    process.env.JWT_ACCESS_EXPIRES_IN = '2h';

    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'audit' });

    const jwt = require('jsonwebtoken');
    const User = require('../src/models/User');
    const Product = require('../src/models/Product');
    const Order = require('../src/models/Order');
    const Category = require('../src/models/Category');
    const Cart = require('../src/models/Cart');
    const stockService = require('../src/services/stockService');

    // The module listens on PORT as a side effect of being required.
    const { server } = require('../src/server');
    const base = `http://127.0.0.1:${process.env.PORT}/api`;
    await new Promise(r => setTimeout(r, 2000));

    const req = async (path, opts = {}, token) => {
        const res = await fetch(`${base}${path}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(opts.headers || {}),
            },
        });
        let body = null;
        try { body = await res.json(); } catch { /* empty body */ }
        return { status: res.status, body };
    };

    // ── Fixtures ──
    const owner = await User.create({ name: 'Owner', email: 'owner@a.com', password: 'password123', role: 'owner' });
    const admin = await User.create({ name: 'Admin', email: 'admin@a.com', password: 'password123', role: 'admin' });
    const cashier = await User.create({ name: 'Counter', email: 'till@a.com', password: 'password123', role: 'cashier' });
    const shopper = await User.create({ name: 'Shopper', email: 'shop@a.com', password: 'password123', role: 'user' });

    const tok = (u) => jwt.sign({ id: u._id, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '2h' });
    const cat = await Category.create({ name: 'Decor', slug: 'decor' });

    const mkProduct = (name, stock, price = 10) =>
        Product.create({ name, price, category: cat._id, stock, sku: name.replace(/\s/g, '') });

    const stockOf = async (id) => (await Product.findById(id)).stock;

    // ═══════════════════════════════════════════════════════════
    section('1. Revenue password');
    // ═══════════════════════════════════════════════════════════

    await req('/admin/set-revenue-password', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'vault-secret-1' }),
    }, tok(owner));

    // Owner with the right password gets in.
    const unlock = await req('/admin/revenue-auth', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'vault-secret-1' }),
    }, tok(owner));
    check('owner unlocks revenue with the correct password', unlock.status === 200, JSON.stringify(unlock.body));

    const revTok = unlock.body?.revenueToken;
    const revRead = await req('/admin/revenue/total', { headers: { 'X-Revenue-Token': revTok } }, tok(owner));
    check('  and can then read revenue', revRead.status === 200, String(revRead.status));

    // Everyone else is refused, unlocked or not.
    for (const [label, user] of [['admin', admin], ['cashier', cashier], ['shopper', shopper]]) {
        const denied = await req('/admin/revenue/total', { headers: { 'X-Revenue-Token': revTok } }, tok(user));
        check(`  ${label} cannot read revenue`, denied.status === 403, String(denied.status));
    }

    const noUnlock = await req('/admin/revenue/total', {}, tok(owner));
    check('  owner without an unlock token is refused', noUnlock.status === 403, String(noUnlock.status));

    const jwtAsUnlock = await req('/admin/revenue/total', {
        headers: { 'X-Revenue-Token': tok(owner) },
    }, tok(owner));
    check('  a login JWT cannot be replayed as an unlock token', jwtAsUnlock.status === 403, String(jwtAsUnlock.status));

    /* The regression this whole audit turns on: a wrong revenue password used
       to answer 401, which made the client delete the login JWT and produce
       "Not Authorized" for everything afterwards. */
    const wrong = await req('/admin/revenue-auth', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'not-it' }),
    }, tok(owner));
    check('wrong revenue password answers 403, never 401', wrong.status === 403, String(wrong.status));
    check('  with a non-session code', wrong.body?.code === 'REVENUE_PASSWORD_INVALID', JSON.stringify(wrong.body));

    const survives = await req('/admin/stats', {}, tok(owner));
    check('  the admin session survives it', survives.status === 200, String(survives.status));

    // Lockout after repeated failures.
    let lockedOut = null;
    for (let i = 0; i < 6; i++) {
        lockedOut = await req('/admin/revenue-auth', {
            method: 'POST',
            body: JSON.stringify({ revenuePassword: `guess-${i}` }),
        }, tok(owner));
    }
    check('repeated wrong passwords lock revenue out', lockedOut.status === 429, String(lockedOut.status));
    check('  and still never returns 401', lockedOut.status !== 401, String(lockedOut.status));

    await User.updateOne({ _id: owner._id }, { $set: { revenueAttempts: 0, revenueLockedUntil: null } });

    // Overwriting the password needs proof, not just a session.
    const overwrite = await req('/admin/set-revenue-password', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'hijacked-1' }),
    }, tok(owner));
    check('an open session alone cannot overwrite the revenue password', overwrite.status === 403, String(overwrite.status));

    const withCurrent = await req('/admin/set-revenue-password', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'vault-secret-2', currentPassword: 'vault-secret-1' }),
    }, tok(owner));
    check('  but the current password authorises it', withCurrent.status === 200, JSON.stringify(withCurrent.body));

    /* OTP recovery, exercised as the OWNER experiences it: ask the real
     * endpoint for a code, read the code the server actually stored, then
     * verify it. Seeding revenueOTP by hand — which this used to do — skips
     * requestRevenueOTP entirely, so it could not have caught a request that
     * stored the code in a form verify would then reject. */
    const otpRequest = await req('/admin/revenue-otp/request', { method: 'POST' }, tok(owner));
    check('requesting a revenue OTP succeeds', otpRequest.status === 200, JSON.stringify(otpRequest.body));

    const stored = await User.findById(owner._id).select('revenueOTP revenueOTPExpiry');
    check('  the code is stored on the account', /^\d{6}$/.test(stored.revenueOTP || ''), String(stored.revenueOTP));
    check('  with an expiry in the future', stored.revenueOTPExpiry > new Date(), String(stored.revenueOTPExpiry));

    const wrongOtp = await req('/admin/revenue-otp/verify', {
        method: 'POST',
        body: JSON.stringify({ otp: '000000' }),
    }, tok(owner));
    check('  a wrong code is refused with 403, not 401', wrongOtp.status === 403, String(wrongOtp.status));

    // The code the owner actually receives, verified end to end.
    const otpOk = await req('/admin/revenue-otp/verify', {
        method: 'POST',
        body: JSON.stringify({ otp: stored.revenueOTP }),
    }, tok(owner));
    check('  the emailed code verifies', otpOk.status === 200, JSON.stringify(otpOk.body));
    check('a verified OTP returns a reset ticket', Boolean(otpOk.body?.resetToken), JSON.stringify(otpOk.body));

    const reset = await req('/admin/set-revenue-password', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'recovered-1', resetToken: otpOk.body.resetToken }),
    }, tok(owner));
    check('  and that ticket resets the password', reset.status === 200, JSON.stringify(reset.body));

    const afterReset = await req('/admin/revenue-auth', {
        method: 'POST',
        body: JSON.stringify({ revenuePassword: 'recovered-1' }),
    }, tok(owner));
    check('  the new password works', afterReset.status === 200, String(afterReset.status));

    // ═══════════════════════════════════════════════════════════
    section('2. Cashier role — enforced at the API');
    // ═══════════════════════════════════════════════════════════

    const till = tok(cashier);
    const cashProduct = await mkProduct('Bronze Bowl', 10, 25);

    // What a cashier MAY do.
    const listProducts = await req('/admin/products', {}, till);
    check('cashier can list products (to build an invoice)', listProducts.status === 200, String(listProducts.status));
    check('  and gets a narrowed projection',
        !Object.prototype.hasOwnProperty.call(listProducts.body?.data?.[0] || {}, 'costPrice'),
        JSON.stringify(Object.keys(listProducts.body?.data?.[0] || {})));

    const invoice = await req('/admin/orders', {
        method: 'POST',
        body: JSON.stringify({
            user: { name: 'Walk-in', email: 'walkin@a.com' },
            items: [{ product: String(cashProduct._id), name: 'Bronze Bowl', price: 25, quantity: 2 }],
            paymentStatus: 'paid',
        }),
    }, till);
    check('cashier CAN create an invoice', invoice.status === 201, JSON.stringify(invoice.body).slice(0, 160));
    check('  and it deducts stock', await stockOf(cashProduct._id) === 8, String(await stockOf(cashProduct._id)));

    const cashierOrderId = invoice.body?.data?._id;

    /* A counter sale has to land in the books as a counter sale.
     *
     * The Orders page filters on orderSource and the revenue reports break down
     * by it, so an invoice saved without it would either vanish from the manual
     * tab or be counted as a storefront checkout that never happened. And
     * createdByAdmin is what ties the sale to whoever rang it up — without it
     * there is no answer to "who took this money", and the cashier's own
     * scoping (they may only reopen their own invoices) has nothing to key on.
     *
     * Read back from the database rather than trusting the API response, since
     * it is the stored row the reports actually read. */
    const storedInvoice = await Order.findById(cashierOrderId).lean();
    check('  and it is stored as a MANUAL order',
        storedInvoice?.orderSource === 'manual', String(storedInvoice?.orderSource));
    check('  attributed to the cashier who rang it up',
        String(storedInvoice?.createdByAdmin) === String(cashier._id),
        String(storedInvoice?.createdByAdmin));
    check('  with the line items persisted',
        storedInvoice?.items?.length === 1 && storedInvoice.items[0].quantity === 2,
        JSON.stringify(storedInvoice?.items?.map(i => ({ q: i.quantity, p: i.price }))));
    check('  and stockHeld recorded, so a later refund can restore it',
        storedInvoice?.items?.[0]?.stockHeld === 2,
        String(storedInvoice?.items?.[0]?.stockHeld));

    // And it must actually surface under the manual filter the admin uses.
    const manualList = await req('/admin/orders?source=manual&limit=100', {}, tok(admin));
    check('  and appears in the manual-orders list the admin sees',
        (manualList.body?.data || []).some(o => String(o._id) === String(cashierOrderId)),
        `${(manualList.body?.data || []).length} manual order(s) returned`);

    const ownReceipt = await req(`/admin/receipt/${cashierOrderId}`, {}, till);
    check('cashier can print the invoice they just created', ownReceipt.status === 200, String(ownReceipt.status));

    // What a cashier MAY NOT do — every one by direct API call.
    const adminOrder = await Order.create({
        user: shopper._id, items: [], shippingAddress: { street: 'x', city: 'y' },
        subtotal: 0, total: 0, orderSource: 'manual', createdByAdmin: admin._id,
    });

    const forbidden = [
        ['list orders', () => req('/admin/orders', {}, till)],
        ['read dashboard stats', () => req('/admin/stats', {}, till)],
        ['read revenue', () => req('/admin/revenue/total', {}, till)],
        ['read revenue history', () => req('/admin/revenue-history', {}, till)],
        ['list users', () => req('/admin/users', {}, till)],
        ['list carts', () => req('/admin/carts', {}, till)],
        ['read visitor analytics', () => req('/admin/analytics/visitor-log', {}, till)],
        ['read product analytics', () => req('/admin/analytics/product-views', {}, till)],
        ['refund an order', () => req(`/admin/orders/${adminOrder._id}/refund`, {
            method: 'POST', body: JSON.stringify({ type: 'full' }),
        }, till)],
        ['edit a receipt', () => req(`/admin/orders/${adminOrder._id}/receipt`, {
            method: 'PUT', body: JSON.stringify({ notes: 'x' }),
        }, till)],
        ['change order status', () => req(`/admin/orders/${adminOrder._id}/status`, {
            method: 'PUT', body: JSON.stringify({ status: 'delivered' }),
        }, till)],
        ['delete an order', () => req(`/admin/orders/${adminOrder._id}`, { method: 'DELETE' }, till)],
        ['create a product', () => req('/admin/products', {
            method: 'POST', body: JSON.stringify({ name: 'x', price: 1 }),
        }, till)],
        ['change a role', () => req(`/admin/users/${shopper._id}`, {
            method: 'PUT', body: JSON.stringify({ role: 'admin' }),
        }, till)],
        ['read site settings write', () => req('/admin/site-settings', {
            method: 'PUT', body: JSON.stringify({ x: 1 }),
        }, till)],
    ];

    for (const [label, call] of forbidden) {
        const res = await call();
        check(`cashier CANNOT ${label}`, res.status === 403, `got ${res.status}`);
    }

    const othersReceipt = await req(`/admin/receipt/${adminOrder._id}`, {}, till);
    check("cashier CANNOT read another user's receipt", othersReceipt.status === 404, String(othersReceipt.status));

    // Owner and admin retain full access.
    check('admin still lists orders', (await req('/admin/orders', {}, tok(admin))).status === 200);
    check('admin still reads stats', (await req('/admin/stats', {}, tok(admin))).status === 200);
    check('owner still lists orders', (await req('/admin/orders', {}, tok(owner))).status === 200);

    // ═══════════════════════════════════════════════════════════
    section('3. Refunds restore stock');
    // ═══════════════════════════════════════════════════════════

    // 3a. Manual receipt, single line.
    const p1 = await mkProduct('Vase Single', 10);
    const r1 = await req('/admin/orders', {
        method: 'POST',
        body: JSON.stringify({
            user: { name: 'A', email: 'a1@a.com' },
            items: [{ product: String(p1._id), name: 'Vase Single', price: 10, quantity: 3 }],
        }),
    }, tok(admin));
    check('manual receipt deducts stock', await stockOf(p1._id) === 7, String(await stockOf(p1._id)));

    const fullRefund = await req(`/admin/orders/${r1.body.data._id}/refund`, {
        method: 'POST', body: JSON.stringify({ type: 'full' }),
    }, tok(admin));
    check('full refund succeeds', fullRefund.status === 200, String(fullRefund.status));
    check('  restores the exact quantity', await stockOf(p1._id) === 10, String(await stockOf(p1._id)));

    const replay = await req(`/admin/orders/${r1.body.data._id}/refund`, {
        method: 'POST', body: JSON.stringify({ type: 'full' }),
    }, tok(admin));
    check('replaying the same refund is refused', replay.status === 400, String(replay.status));
    check('  and stock is NOT restored twice', await stockOf(p1._id) === 10, String(await stockOf(p1._id)));

    // 3b. Multiple products, partial refund.
    const pA = await mkProduct('Multi A', 20);
    const pB = await mkProduct('Multi B', 20);
    const r2 = await req('/admin/orders', {
        method: 'POST',
        body: JSON.stringify({
            user: { name: 'B', email: 'b1@a.com' },
            items: [
                { product: String(pA._id), name: 'Multi A', price: 10, quantity: 4 },
                { product: String(pB._id), name: 'Multi B', price: 10, quantity: 6 },
            ],
        }),
    }, tok(admin));
    check('multi-line receipt deducts both', await stockOf(pA._id) === 16 && await stockOf(pB._id) === 14,
        `${await stockOf(pA._id)}/${await stockOf(pB._id)}`);

    const lineB = r2.body.data.items.find(i => i.name === 'Multi B');
    const partial = await req(`/admin/orders/${r2.body.data._id}/refund`, {
        method: 'POST', body: JSON.stringify({ type: 'item', itemId: lineB._id }),
    }, tok(admin));
    check('partial refund succeeds', partial.status === 200, String(partial.status));
    check('  restores only the refunded line', await stockOf(pB._id) === 20, String(await stockOf(pB._id)));
    check('  leaves the other line held', await stockOf(pA._id) === 16, String(await stockOf(pA._id)));
    check('  marks the order Partial', partial.body?.data?.refundStatus === 'Partial', partial.body?.data?.refundStatus);

    const replayItem = await req(`/admin/orders/${r2.body.data._id}/refund`, {
        method: 'POST', body: JSON.stringify({ type: 'item', itemId: lineB._id }),
    }, tok(admin));
    check('replaying an item refund is refused', replayItem.status === 400, String(replayItem.status));
    check('  stock unchanged', await stockOf(pB._id) === 20, String(await stockOf(pB._id)));

    // 3c. Removing a line while editing a receipt returns its stock.
    const editRes = await req(`/admin/orders/${r2.body.data._id}/receipt`, {
        method: 'PUT',
        body: JSON.stringify({
            items: [{ product: String(pA._id), name: 'Multi A', price: 10, quantity: 1 }],
        }),
    }, tok(admin));
    check('reducing a quantity while editing returns stock', editRes.status === 200 && await stockOf(pA._id) === 19,
        `${editRes.status} / ${await stockOf(pA._id)}`);

    // 3d. THE headline bug: an ONLINE order, written the legacy way.
    const pOnline = await mkProduct('Online Vase', 10);
    await Product.updateOne({ _id: pOnline._id }, { $set: { stock: 7 } });  // as if 3 were sold

    const legacyOrder = await Order.create({
        user: shopper._id,
        items: [{ product: pOnline._id, name: 'Online Vase', price: 10, quantity: 3 }],
        shippingAddress: { street: 'x', city: 'y' },
        subtotal: 30, total: 30, paymentStatus: 'paid', orderSource: 'online',
        // No stockLedgerVersion — exactly how every pre-fix online order looks.
    });
    const rawLegacy = await Order.collection.findOne({ _id: legacyOrder._id });
    check('legacy order really has no ledger version',
        !rawLegacy.stockLedgerVersion, String(rawLegacy.stockLedgerVersion));
    check('  and its lines record stockHeld 0 (the bug)',
        (rawLegacy.items[0].stockHeld || 0) === 0, String(rawLegacy.items[0].stockHeld));

    const legacyRefund = await req(`/admin/orders/${legacyOrder._id}/refund`, {
        method: 'POST', body: JSON.stringify({ type: 'full' }),
    }, tok(admin));
    check('refunding a LEGACY online order succeeds', legacyRefund.status === 200, String(legacyRefund.status));
    check('  and DOES restore its stock (7 -> 10)', await stockOf(pOnline._id) === 10, String(await stockOf(pOnline._id)));

    const legacyReplay = await req(`/admin/orders/${legacyOrder._id}/refund`, {
        method: 'POST', body: JSON.stringify({ type: 'full' }),
    }, tok(admin));
    check('  replaying it does not restore twice',
        legacyReplay.status === 400 && await stockOf(pOnline._id) === 10, String(await stockOf(pOnline._id)));

    // 3e. Cancelling from the admin Orders page restores stock.
    const pCancel = await mkProduct('Cancel Vase', 10);
    const cancelOrder = await req('/admin/orders', {
        method: 'POST',
        body: JSON.stringify({
            user: { name: 'C', email: 'c1@a.com' },
            items: [{ product: String(pCancel._id), name: 'Cancel Vase', price: 10, quantity: 4 }],
        }),
    }, tok(admin));
    check('receipt deducts before cancel', await stockOf(pCancel._id) === 6, String(await stockOf(pCancel._id)));

    await req(`/admin/orders/${cancelOrder.body.data._id}/status`, {
        method: 'PUT', body: JSON.stringify({ status: 'cancelled' }),
    }, tok(admin));
    check('cancelling from admin restores stock', await stockOf(pCancel._id) === 10, String(await stockOf(pCancel._id)));

    await req(`/admin/orders/${cancelOrder.body.data._id}/status`, {
        method: 'PUT', body: JSON.stringify({ status: 'cancelled' }),
    }, tok(admin));
    check('  cancelling twice does NOT restore twice', await stockOf(pCancel._id) === 10, String(await stockOf(pCancel._id)));

    await req(`/admin/orders/${cancelOrder.body.data._id}/status`, {
        method: 'PUT', body: JSON.stringify({ status: 'confirmed' }),
    }, tok(admin));
    check('un-cancelling takes the stock back out', await stockOf(pCancel._id) === 6, String(await stockOf(pCancel._id)));

    // ═══════════════════════════════════════════════════════════
    section('4. Ordering more than exists');
    // ═══════════════════════════════════════════════════════════

    const scarce = await mkProduct('Bronze Serving Bowl', 2, 30);

    const oversell = await req('/admin/orders', {
        method: 'POST',
        body: JSON.stringify({
            user: { name: 'D', email: 'd1@a.com' },
            items: [{ product: String(scarce._id), name: 'Bronze Serving Bowl', price: 30, quantity: 3 }],
        }),
    }, tok(admin));
    check('a receipt for 3 when 2 remain is refused', oversell.status === 409, String(oversell.status));
    check('  the message names what is available',
        /only 2 left/i.test(oversell.body?.message || ''), oversell.body?.message);
    check('  and no stock moved', await stockOf(scarce._id) === 2, String(await stockOf(scarce._id)));

    // Cart: the resulting quantity is what must be checked, not the increment.
    const shopTok = tok(shopper);
    await Cart.deleteMany({ user: shopper._id });

    const add2 = await req('/cart', {
        method: 'POST', body: JSON.stringify({ productId: String(scarce._id), quantity: 2 }),
    }, shopTok);
    check('adding 2 of 2 to the cart is allowed', add2.status === 200, String(add2.status));

    const add1More = await req('/cart', {
        method: 'POST', body: JSON.stringify({ productId: String(scarce._id), quantity: 1 }),
    }, shopTok);
    check('adding a 3rd is refused (resulting qty, not the increment)', add1More.status === 400, String(add1More.status));
    check('  reports how many are available', add1More.body?.details?.available === 2, JSON.stringify(add1More.body?.details));

    const cartNow = await Cart.findOne({ user: shopper._id });
    check('  and the cart still holds only 2', cartNow.items[0].quantity === 2, String(cartNow.items[0].quantity));

    // Checkout deducts atomically and records the holdings.
    const checkout = await req('/orders', {
        method: 'POST',
        body: JSON.stringify({
            shippingAddress: { street: 's', city: 'c', phone: '96500000000' },
            paymentMethod: 'cod',
        }),
    }, shopTok);
    check('checkout succeeds for the 2 in stock', checkout.status === 201, JSON.stringify(checkout.body).slice(0, 140));
    check('  stock reaches 0', await stockOf(scarce._id) === 0, String(await stockOf(scarce._id)));

    const placed = await Order.findById(checkout.body.data._id);
    check('  the new order records its stock holdings', placed.items[0].stockHeld === 2, String(placed.items[0].stockHeld));
    check('  and is stamped at the current ledger version',
        placed.stockLedgerVersion === stockService.STOCK_LEDGER_VERSION, String(placed.stockLedgerVersion));

    const refundNew = await req(`/admin/orders/${placed._id}/refund`, {
        method: 'POST', body: JSON.stringify({ type: 'full' }),
    }, tok(admin));
    check('refunding a NEW online order restores stock',
        refundNew.status === 200 && await stockOf(scarce._id) === 2, String(await stockOf(scarce._id)));

    // ── Bulk product lookup, used by the basket to re-read stock ──
    const bulkA = await mkProduct('Bulk One', 4);
    const bulkB = await mkProduct('Bulk Two', 9);

    const byIds = await req(`/products?ids=${bulkA._id},${bulkB._id}&limit=2`);
    check('GET /products?ids= returns just those products',
        byIds.status === 200 && byIds.body?.data?.length === 2, JSON.stringify(byIds.body?.data?.length));
    check('  and carries current stock',
        byIds.body.data.every(p => typeof p.stock === 'number'),
        JSON.stringify(byIds.body.data.map(p => p.stock)));

    const badIds = await req('/products?ids=not-an-id');
    check('  an unusable id list returns nothing, NOT the whole catalogue',
        badIds.body?.data?.length === 0, String(badIds.body?.data?.length));

    const mixedIds = await req(`/products?ids=not-an-id,${bulkA._id}`);
    check('  a partly-valid list returns only the valid ones',
        mixedIds.body?.data?.length === 1, String(mixedIds.body?.data?.length));

    // ═══════════════════════════════════════════════════════════
    section('5. Visitors page — product clicks');
    // ═══════════════════════════════════════════════════════════

    const ProductView = require('../src/models/ProductView');
    const SiteVisit = require('../src/models/SiteVisit');

    const viewedA = await mkProduct('Viewed Lamp', 5);
    const viewedB = await mkProduct('Viewed Rug', 5);
    const today = new Date().toISOString().split('T')[0];

    await SiteVisit.create([
        { ip: '1.1.1.1', date: today, page: '/', userAgent: 'Mozilla/5.0' },
        { ip: '2.2.2.2', date: today, page: '/products', userAgent: 'Mozilla/5.0' },
    ]);

    // Two people, three product opens between them.
    await ProductView.create([
        { product: viewedA._id, ip: '1.1.1.1', date: today },
        { product: viewedB._id, ip: '1.1.1.1', date: today },
        { product: viewedA._id, ip: '2.2.2.2', date: today },
    ]);

    const visits = await req('/admin/analytics/site-visits', {}, tok(admin));
    check('site-visit stats load', visits.status === 200, String(visits.status));

    const day = (visits.body?.data?.dailyBreakdown || []).find(d => d.date === today);
    check('  today has a row', Boolean(day), JSON.stringify(visits.body?.data?.dailyBreakdown));
    check('  carries the third total: product clicks', day?.productClicks === 3, String(day?.productClicks));
    check('  and how many people made them', day?.productVisitors === 2, String(day?.productVisitors));
    check('  names which products were clicked', (day?.products || []).length === 2,
        JSON.stringify((day?.products || []).map(p => p.name)));

    const ranked = (day?.products || []).map(p => `${p.name}:${p.clicks}`).sort();
    check('  with per-product click counts',
        ranked.join(',') === 'Viewed Lamp:2,Viewed Rug:1', ranked.join(','));
    check('  most-clicked first', day?.products?.[0]?.name === 'Viewed Lamp', day?.products?.[0]?.name);
    check('  each product carries its photo field',
        Object.prototype.hasOwnProperty.call(day?.products?.[0] || {}, 'image'),
        JSON.stringify(Object.keys(day?.products?.[0] || {})));

    check('  headline total is summed from the same rows',
        visits.body?.data?.totalProductClicks === 3, String(visits.body?.data?.totalProductClicks));
    check('  and the today figure agrees with the row',
        visits.body?.data?.todayProductClicks === day?.productClicks,
        `${visits.body?.data?.todayProductClicks} vs ${day?.productClicks}`);

    // A repeat open by the same IP on the same day must not create a second row.
    await ProductView.findOneAndUpdate(
        { product: viewedA._id, ip: '1.1.1.1', date: today },
        { $setOnInsert: { product: viewedA._id, ip: '1.1.1.1', date: today } },
        { upsert: true }
    );
    const after = await req('/admin/analytics/site-visits', {}, tok(admin));
    const dayAfter = (after.body?.data?.dailyBreakdown || []).find(d => d.date === today);
    check('  a repeat view by the same IP is not double-counted',
        dayAfter?.productClicks === 3, String(dayAfter?.productClicks));

    // ═══════════════════════════════════════════════════════════
    section('6. Sessions: expiry, refresh, rotation');
    // ═══════════════════════════════════════════════════════════

    const login = await req('/auth/login', {
        method: 'POST', body: JSON.stringify({ email: 'admin@a.com', password: 'password123' }),
    });
    check('login returns an access token', Boolean(login.body?.data?.token), JSON.stringify(login.body).slice(0, 120));
    check('  and a refresh token', Boolean(login.body?.data?.refreshToken));

    const { token: access1, refreshToken: refresh1 } = login.body.data;

    check('the access token works', (await req('/admin/stats', {}, access1)).status === 200);

    // An expired access token is reported as such, distinctly.
    const expired = jwt.sign({ id: admin._id, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const expiredRes = await req('/admin/stats', {}, expired);
    check('an expired token answers 401 SESSION_EXPIRED',
        expiredRes.status === 401 && expiredRes.body?.code === 'SESSION_EXPIRED', JSON.stringify(expiredRes.body));

    const noTok = await req('/admin/stats', {});
    check('no token answers SESSION_NO_TOKEN', noTok.body?.code === 'SESSION_NO_TOKEN', JSON.stringify(noTok.body));

    const garbage = await req('/admin/stats', {}, 'not-a-jwt');
    check('a malformed token answers SESSION_INVALID', garbage.body?.code === 'SESSION_INVALID', JSON.stringify(garbage.body));

    // A refresh token cannot masquerade as an access token.
    const asAccess = await req('/admin/stats', {}, refresh1);
    check('a refresh token is refused as an access token',
        asAccess.status === 401 && asAccess.body?.code === 'SESSION_INVALID', JSON.stringify(asAccess.body));

    // Refresh works, and rotates.
    const refreshed = await req('/auth/refresh', {
        method: 'POST', body: JSON.stringify({ refreshToken: refresh1 }),
    });
    check('refresh returns a new access token', Boolean(refreshed.body?.data?.token), JSON.stringify(refreshed.body).slice(0, 120));
    check('  and a NEW refresh token (rotation)',
        refreshed.body?.data?.refreshToken && refreshed.body.data.refreshToken !== refresh1);
    check('  the new access token works', (await req('/admin/stats', {}, refreshed.body.data.token)).status === 200);

    // Reuse detection: the spent token is dead, and its reuse kills the family.
    const reuse = await req('/auth/refresh', {
        method: 'POST', body: JSON.stringify({ refreshToken: refresh1 }),
    });
    check('a spent refresh token is refused', reuse.status === 401, String(reuse.status));

    const afterReuse = await req('/auth/refresh', {
        method: 'POST', body: JSON.stringify({ refreshToken: refreshed.body.data.refreshToken }),
    });
    check('  and reuse revokes the whole family', afterReuse.status === 401, String(afterReuse.status));

    // Logout revokes server-side.
    const login2 = await req('/auth/login', {
        method: 'POST', body: JSON.stringify({ email: 'admin@a.com', password: 'password123' }),
    });
    const refresh2 = login2.body.data.refreshToken;
    check('logout succeeds', (await req('/auth/logout', {
        method: 'POST', body: JSON.stringify({ refreshToken: refresh2 }),
    })).status === 200);
    check('  the refresh token is dead afterwards', (await req('/auth/refresh', {
        method: 'POST', body: JSON.stringify({ refreshToken: refresh2 }),
    })).status === 401);

    // Concurrent requests on a live token must all succeed.
    const login3 = await req('/auth/login', {
        method: 'POST', body: JSON.stringify({ email: 'admin@a.com', password: 'password123' }),
    });
    const parallel = await Promise.all(
        Array.from({ length: 8 }, () => req('/admin/stats', {}, login3.body.data.token))
    );
    check('8 simultaneous requests all authenticate',
        parallel.every(r => r.status === 200), parallel.map(r => r.status).join(','));

    // Signing in twice keeps both sessions alive.
    const loginA = await req('/auth/login', {
        method: 'POST', body: JSON.stringify({ email: 'owner@a.com', password: 'password123' }),
    });
    const loginB = await req('/auth/login', {
        method: 'POST', body: JSON.stringify({ email: 'owner@a.com', password: 'password123' }),
    });
    check('a second sign-in does not end the first',
        (await req('/auth/refresh', {
            method: 'POST', body: JSON.stringify({ refreshToken: loginA.body.data.refreshToken }),
        })).status === 200 &&
        (await req('/auth/refresh', {
            method: 'POST', body: JSON.stringify({ refreshToken: loginB.body.data.refreshToken }),
        })).status === 200);

    // Password change ends every session.
    const loginC = await req('/auth/login', {
        method: 'POST', body: JSON.stringify({ email: 'shop@a.com', password: 'password123' }),
    });
    const shopUser = await User.findById(shopper._id);
    shopUser.password = 'brand-new-pass';
    await shopUser.save();
    check('changing the password revokes existing sessions',
        (await req('/auth/refresh', {
            method: 'POST', body: JSON.stringify({ refreshToken: loginC.body.data.refreshToken }),
        })).status === 401);

    // -- Print queue health --
    section('Print queue health');

    // Nothing waiting -> healthy, whatever else is true.
    await Order.updateMany({}, { $set: { printedAt: new Date() } });
    const idle = await req('/admin/print-queue/health');
    check('an empty queue reports ok', idle.status === 200 && idle.body.status === 'ok',
        JSON.stringify(idle.body));

    // A receipt waiting, but only just -- the agent has 15 minutes to collect it.
    const freshOrd = await Order.findOne({});
    await Order.updateOne({ _id: freshOrd._id },
        { $unset: { printedAt: 1 }, $set: { paymentStatus: 'paid', orderStatus: 'confirmed', createdAt: new Date() } });
    const recent = await req('/admin/print-queue/health');
    check('a just-placed order is not yet a stall', recent.status === 200 && recent.body.status === 'ok',
        JSON.stringify(recent.body));
    check('  and it is counted as waiting', recent.body.queueDepth === 1, String(recent.body.queueDepth));

    /* The same receipt, two hours old -- the agent has plainly not collected it.
     * Written through the raw driver on purpose: `timestamps: true` makes
     * createdAt immutable, so a Mongoose updateOne drops the $set silently and
     * the order stays new. */
    await Order.collection.updateOne({ _id: freshOrd._id },
        { $set: { createdAt: new Date(Date.now() - 120 * 60000) } });
    const stalledRes = await req('/admin/print-queue/health');
    check('a queue that has stopped draining reports stalled',
        stalledRes.body.status === 'stalled', JSON.stringify(stalledRes.body));
    check('  and answers 503, so a plain HTTP monitor catches it too',
        stalledRes.status === 503, String(stalledRes.status));
    check('  and says how long it has been waiting',
        stalledRes.body.oldestWaitingMinutes >= 119, String(stalledRes.body.oldestWaitingMinutes));

    /* The whole reason this endpoint is unauthenticated. /print-queue/poll
     * leaked names, emails, phones and addresses to anyone holding a key that
     * was committed to the repository; this one is public, so it must carry
     * nothing worth stealing. Asserted against the serialised body so a future
     * .populate() or an extra field cannot reintroduce it unnoticed. */
    const exposed = JSON.stringify(stalledRes.body).toLowerCase();
    for (const leak of ['email', 'phone', 'address', 'name', 'ordernumber', 'total', '@']) {
        check('  leaks no ' + leak, !exposed.includes(leak), exposed.slice(0, 160));
    }


    // ── Report ──
    console.log(`\n${pass} passed, ${fail} failed`);
    if (failures.length) console.log(`Failing: ${failures.join(' | ')}`);

    server.close();
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(fail ? 1 : 0);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
