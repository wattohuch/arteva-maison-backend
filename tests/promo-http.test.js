/**
 * Promo codes over real HTTP - the admin journey, end to end.
 *
 * The sibling promo-lifecycle test calls the service and the model directly.
 * That proves the arithmetic but not the thing that was actually broken: the
 * admin could not save a promo code at all, and the failure arrived through
 * routing, auth, validation and the controller before it ever reached a model.
 *
 * So this boots the real Express app and drives the same requests the admin
 * screen makes, with a real token:
 *
 *   1. create a code with the payload the form sends
 *   2. attach a product to it
 *   3. price it for a shopper, including the basket minimum
 *
 * Run: npm run test:promo-http
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
    cond ? pass++ : fail++;
};

(async () => {
    const mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.JWT_SECRET = 'test-secret-for-promo-http-only';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '5203';

    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'promohttp' });

    const jwt = require('jsonwebtoken');
    const User = require('../src/models/User');
    const Product = require('../src/models/Product');
    const Category = require('../src/models/Category');

    const admin = await User.create({
        name: 'Admin', email: 'admin@promo.com', password: 'password123', role: 'admin',
    });
    const shopper = await User.create({
        name: 'Shopper', email: 'shopper@promo.com', password: 'password123', role: 'user',
    });
    const tok = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET);
    const adminToken = tok(admin);
    const shopperToken = tok(shopper);

    const cat = await Category.create({ name: 'Decor', slug: 'decor-http' });
    const scarf = await Product.create({ name: 'Silk Scarf', price: 30, category: cat._id, stock: 25, sku: 'SS-HTTP' });
    const vase = await Product.create({ name: 'Ceramic Vase', price: 40, category: cat._id, stock: 25, sku: 'CV-HTTP' });

    require('../src/server');
    const base = 'http://127.0.0.1:5203/api';
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

    // ══ Step 1: create a promo code, exactly as the admin form does ═══════
    //
    // Field for field, what PromoCodesSection.handleSubmit posts.
    const formPayload = {
        code: 'eid25',
        name: 'Eid Sale',
        description: '25% off selected pieces',
        expiresAt: '2099-12-31',
        defaultDiscountType: 'percentage',
        defaultDiscountValue: 25,
        minOrderAmount: 20,
        maxUsage: 100,
        perUserLimit: 1,
        maxQuantityPerOrder: 3,
        isActive: true,
    };

    const created = await req('/admin/promo-codes', {
        method: 'POST', body: JSON.stringify(formPayload),
    }, adminToken);

    check('POST /admin/promo-codes -> 201', created.status === 201, JSON.stringify(created.body));
    const promoId = created.body?.data?._id;
    check('  the code comes back saved', !!promoId, JSON.stringify(created.body));
    check('  name survived the round trip', created.body?.data?.name === 'Eid Sale');
    check('  code was upper-cased', created.body?.data?.code === 'EID25');
    check('  the usage limit was kept', created.body?.data?.maxUsage === 100,
        'sent as usageLimit before, and silently dropped');
    check('  the per-customer limit was kept', created.body?.data?.perUserLimit === 1);
    check('  the basket minimum was kept', created.body?.data?.minOrderAmount === 20);
    check('  the default discount was kept', created.body?.data?.defaultDiscountValue === 25);

    // The failure that produced the ghosting: a missing name used to die as a
    // schema ValidationError with no useful message.
    const noName = await req('/admin/promo-codes', {
        method: 'POST', body: JSON.stringify({ code: 'NONAME', expiresAt: '2099-12-31' }),
    }, adminToken);
    check('a code with no name -> 400, not 500', noName.status === 400, JSON.stringify(noName.body));
    check('  and the message names the field', /Name/i.test(noName.body?.message || ''), noName.body?.message);

    // A request with no code at all used to throw TypeError on toUpperCase().
    const noCode = await req('/admin/promo-codes', {
        method: 'POST', body: JSON.stringify({ name: 'Nameless' }),
    }, adminToken);
    check('a request with no code -> 400, not a 500 TypeError', noCode.status === 400, JSON.stringify(noCode.body));

    const dupe = await req('/admin/promo-codes', {
        method: 'POST', body: JSON.stringify(formPayload),
    }, adminToken);
    check('a duplicate code -> 400', dupe.status === 400, JSON.stringify(dupe.body));

    // Admin-only, and it must actually be enforced.
    const asShopper = await req('/admin/promo-codes', {
        method: 'POST', body: JSON.stringify(formPayload),
    }, shopperToken);
    check('a shopper cannot create a promo code', asShopper.status === 403 || asShopper.status === 401,
        `got ${asShopper.status}`);

    // ══ Step 2: attach a product ═════════════════════════════════════════
    //
    // The step that was invisible before: a code with no products validates
    // for a shopper and then discounts nothing.
    const attached = await req(`/admin/promo-codes/${promoId}/products`, {
        method: 'POST',
        // No discount given, so the code's own default must fill it in.
        body: JSON.stringify({ products: [{ product: String(scarf._id) }] }),
    }, adminToken);

    check('POST /admin/promo-codes/:id/products -> 200', attached.status === 200, JSON.stringify(attached.body));
    const rules = attached.body?.data?.products || [];
    check('  the product is attached', rules.length === 1, JSON.stringify(rules));
    check('  and took the code default of 25%', rules[0]?.discountValue === 25,
        'this read a field the document never had, and always fell through to 10');

    // ══ Step 3: price it for a shopper ═══════════════════════════════════
    const basket = [{ product: String(scarf._id), name: 'Silk Scarf', price: 30, quantity: 1 }];

    const quoted = await req('/promo-codes/validate', {
        method: 'POST', body: JSON.stringify({ code: 'EID25', cartItems: basket }),
    }, shopperToken);

    check('POST /promo-codes/validate -> 200', quoted.status === 200, JSON.stringify(quoted.body));
    check('  the discount is 7.500 on a 30 KWD scarf', quoted.body?.data?.totalDiscount === 7.5,
        String(quoted.body?.data?.totalDiscount));
    check('  and it matched exactly one product', quoted.body?.data?.matchedProducts === 1);

    // Under the minimum: refused, and the reason names the figure.
    const tooSmall = await req('/promo-codes/validate', {
        method: 'POST',
        body: JSON.stringify({
            code: 'EID25',
            cartItems: [{ product: String(scarf._id), name: 'Silk Scarf', price: 5, quantity: 1 }],
        }),
    }, shopperToken);
    check('a basket under the minimum -> 400', tooSmall.status === 400, JSON.stringify(tooSmall.body));
    check('  and says how much is needed', /20\.000 KWD/.test(tooSmall.body?.message || ''),
        tooSmall.body?.message);

    // A product the code does not cover earns nothing.
    const unmatched = await req('/promo-codes/validate', {
        method: 'POST',
        body: JSON.stringify({
            code: 'EID25',
            cartItems: [{ product: String(vase._id), name: 'Ceramic Vase', price: 40, quantity: 1 }],
        }),
    }, shopperToken);
    check('a basket of uncovered products earns nothing', unmatched.body?.data?.totalDiscount === 0,
        JSON.stringify(unmatched.body?.data));

    const unknown = await req('/promo-codes/validate', {
        method: 'POST', body: JSON.stringify({ code: 'NOPE', cartItems: basket }),
    }, shopperToken);
    check('an unknown code -> 404', unknown.status === 404, JSON.stringify(unknown.body));

    // ══ Step 4: editing keeps what the form sends ════════════════════════
    const edited = await req(`/admin/promo-codes/${promoId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...formPayload, minOrderAmount: 50, maxUsage: 5 }),
    }, adminToken);
    check('PUT /admin/promo-codes/:id -> 200', edited.status === 200, JSON.stringify(edited.body));
    check('  the new minimum stuck', edited.body?.data?.minOrderAmount === 50);
    check('  the new usage limit stuck', edited.body?.data?.maxUsage === 5,
        'editing dropped this before, same as creating did');

    // And the raised minimum is enforced on the very next quote.
    const nowTooSmall = await req('/promo-codes/validate', {
        method: 'POST', body: JSON.stringify({ code: 'EID25', cartItems: basket }),
    }, shopperToken);
    check('the raised minimum bites immediately', nowTooSmall.status === 400,
        JSON.stringify(nowTooSmall.body));

    // ══ The listing the admin table renders ══════════════════════════════
    const listed = await req('/admin/promo-codes', {}, adminToken);
    check('GET /admin/promo-codes -> 200', listed.status === 200);
    const row = (listed.body?.data || []).find(p => p.code === 'EID25');
    check('  the row carries the fields the table reads',
        row && row.usageCount === 0 && row.maxUsage === 5 && row.defaultDiscountValue === 25,
        JSON.stringify(row && {
            usageCount: row.usageCount, maxUsage: row.maxUsage,
            defaultDiscountValue: row.defaultDiscountValue,
        }));
    check('  and its attached products, so the table can warn when there are none',
        Array.isArray(row?.products) && row.products.length === 1);

    await mongoose.disconnect();
    await mongod.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
