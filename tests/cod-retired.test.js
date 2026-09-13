/**
 * Cash on delivery stays retired.
 *
 * It was switched off deliberately, and /payments/cod refuses in so many
 * words. But there was a second door: POST /api/orders passes paymentMethod
 * straight from the request into the order, and Order.paymentMethod defaults
 * to 'cod' - so a request that simply omitted it produced a confirmed cash
 * order for the one method the shop no longer takes, which then reached the
 * driver app as cash to collect.
 *
 * This pins both doors shut over real HTTP, and pins the refusal itself, so
 * that turning COD back on is a deliberate act rather than an omission.
 *
 * Run: npm run test:cod-retired
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
    process.env.JWT_SECRET = 'test-secret-cod-only';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '5207';

    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'codretired' });

    const jwt = require('jsonwebtoken');
    const User = require('../src/models/User');
    const Product = require('../src/models/Product');
    const Category = require('../src/models/Category');
    const Cart = require('../src/models/Cart');
    const Order = require('../src/models/Order');

    const buyer = await User.create({
        name: 'Buyer', email: 'buyer@cod.com', password: 'password123', phone: '+96550000000',
    });
    const token = jwt.sign({ id: buyer._id }, process.env.JWT_SECRET);

    const cat = await Category.create({ name: 'Decor', slug: 'decor-cod' });
    const product = await Product.create({
        name: 'Silk Scarf', price: 30, category: cat._id, stock: 10, sku: 'SC-COD',
    });
    await Cart.create({ user: buyer._id, items: [{ product: product._id, quantity: 1 }] });

    require('../src/server');
    const base = 'http://127.0.0.1:5207/api';
    await new Promise(r => setTimeout(r, 2000));

    const req = async (path, opts = {}, tok) => {
        const res = await fetch(base + path, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
                ...opts.headers,
            },
        });
        let body = null;
        try { body = await res.json(); } catch { /* non-JSON */ }
        return { status: res.status, body };
    };

    const address = {
        fullName: 'Buyer', street: 'Block 1, Street 2', city: 'Kuwait City',
        country: 'Kuwait', phone: '+96550000000',
    };

    // ══ 1. /payments/cod refuses ═════════════════════════════════════════
    const viaPayments = await req('/payments/cod', {
        method: 'POST', body: JSON.stringify({ shippingAddress: address }),
    }, token);
    check('POST /payments/cod is refused', viaPayments.status === 400, JSON.stringify(viaPayments.body));
    check('  with the retirement message',
        /no longer available/i.test(viaPayments.body?.message || ''), viaPayments.body?.message);

    // ══ 2. POST /orders asking for cod is refused ════════════════════════
    const explicit = await req('/orders', {
        method: 'POST',
        body: JSON.stringify({ shippingAddress: address, paymentMethod: 'cod' }),
    }, token);
    check('POST /orders with paymentMethod cod is refused', explicit.status === 400,
        JSON.stringify(explicit.body));
    check('  with the same message',
        /no longer available/i.test(explicit.body?.message || ''), explicit.body?.message);

    // ══ 3. And omitting it entirely is refused, not defaulted to cod ═════
    //
    // This is the door that was open: no paymentMethod meant the schema default
    // applied, and the schema default is 'cod'.
    const omitted = await req('/orders', {
        method: 'POST', body: JSON.stringify({ shippingAddress: address }),
    }, token);
    check('POST /orders with no paymentMethod is refused', omitted.status === 400,
        JSON.stringify(omitted.body));

    // ══ 4. Nothing was written ═══════════════════════════════════════════
    const codOrders = await Order.countDocuments({ paymentMethod: 'cod' });
    check('no cash order reached the database', codOrders === 0, `${codOrders} found`);

    const stock = (await Product.findById(product._id)).stock;
    check('and no stock was moved by the refusals', stock === 10, `stock is ${stock}`);

    // ══ 5. The schema still accepts cod for records that already use it ══
    //
    // Retiring the checkout must not make historical orders, or a cashier's
    // walk-in receipt, unreadable or unsavable.
    const historical = await Order.create({
        user: buyer._id,
        items: [{ name: 'Old sale', price: 10, quantity: 1 }],
        shippingAddress: { street: 'x', city: 'Kuwait City' },
        subtotal: 10, shippingCost: 2, total: 12,
        paymentMethod: 'cod', orderSource: 'manual',
    });
    check('a manual receipt may still record a cash sale', historical.paymentMethod === 'cod',
        'the driver app and old orders both read this field');

    await mongoose.disconnect();
    await mongod.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
