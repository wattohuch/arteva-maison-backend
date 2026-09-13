/**
 * One sale confirms once, however many ways it arrives.
 *
 * A paid order is reported from three directions at the same moment: the
 * browser returns to the callback, the success page calls verify, and the
 * gateway posts a webhook. Every one of them used to guard with a plain read -
 * `if (order.paymentStatus === 'paid') return` - and then deduct stock further
 * down, saving the order only at the end.
 *
 * Two arriving together both read "not paid", both passed the guard, and both
 * took the units off the shelf. One sale, stock down twice, and nothing on the
 * order to say it had happened. Promo usage had the same problem and was fixed
 * with an atomic claim; the stock deduction beside it never was.
 *
 * Run: npm run test:payment-idempotency
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
    await mongoose.connect(mongod.getUri(), { dbName: 'payidem' });

    const Order = require('../src/models/Order');
    const Product = require('../src/models/Product');
    const Category = require('../src/models/Category');
    const User = require('../src/models/User');

    const buyer = await User.create({
        name: 'Buyer', email: 'buyer@idem.com', password: 'password123',
    });
    const cat = await Category.create({ name: 'Decor', slug: 'decor-idem' });

    // Product slugs are unique, so each fixture needs its own name.
    let seq = 0;
    const newOrder = async (qty = 1) => {
        const product = await Product.create({
            name: 'Silk Scarf ' + (++seq), price: 30, category: cat._id, stock: 10,
        });
        const order = await Order.createWithRetry({
            user: buyer._id,
            items: [{ product: product._id, name: 'Silk Scarf', price: 30, quantity: qty }],
            shippingAddress: { street: 'x', city: 'Kuwait City' },
            subtotal: 30 * qty, shippingCost: 2, total: 30 * qty + 2,
            paymentStatus: 'awaiting_payment',
        });
        return { order, product };
    };

    /** What each confirmation path does once it has won the claim. */
    const confirmOnce = async (orderId, tx) => {
        const won = await Order.claimPaidOnce(orderId, { myfatoorahTransactionId: tx });
        if (!won) return false;
        const o = await Order.findById(orderId);
        for (const item of o.items) {
            await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
        }
        return true;
    };

    // ══ 1. The claim is won exactly once ═════════════════════════════════
    {
        const { order } = await newOrder();
        const first = await Order.claimPaidOnce(order._id, { myfatoorahTransactionId: 'tx-1' });
        const second = await Order.claimPaidOnce(order._id, { myfatoorahTransactionId: 'tx-2' });

        check('the first caller wins the claim', first === true);
        check('a later caller does not', second === false,
            'callback, verify and webhook all fire for one sale');

        const stored = await Order.findById(order._id);
        check('the order is marked paid', stored.paymentStatus === 'paid');
        check('and confirmed', stored.orderStatus === 'confirmed');
        check('the winner set the transaction id', stored.myfatoorahTransactionId === 'tx-1');
        check('the loser did not overwrite it', stored.myfatoorahTransactionId !== 'tx-2',
            'a second write would replace a real transaction reference with a duplicate');
        check('paidAt was stamped', stored.paidAt instanceof Date);
    }

    // ══ 2. Concurrent confirmations deduct stock once ════════════════════
    //
    // The shape that actually happened: the redirect and the webhook landing
    // together, both reading "not paid" before either had saved.
    {
        const { order, product } = await newOrder(2);
        const before = (await Product.findById(product._id)).stock;

        const [a, b, c] = await Promise.all([
            confirmOnce(order._id, 'tx-callback'),
            confirmOnce(order._id, 'tx-webhook'),
            confirmOnce(order._id, 'tx-verify'),
        ]);

        const winners = [a, b, c].filter(Boolean).length;
        check('exactly one of three concurrent confirmations proceeds', winners === 1,
            `${winners} of them ran the side effects`);

        const after = (await Product.findById(product._id)).stock;
        check('stock came off once, not three times', before - after === 2,
            `stock went ${before} -> ${after} for an order of 2`);
    }

    // ══ 3. A failed payment is never claimable as paid ═══════════════════
    {
        const { order } = await newOrder();
        await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'failed' } });
        const won = await Order.claimPaidOnce(order._id);
        check('a failed order can still be claimed if it later settles', won === true,
            'only an already-paid order is refused, so a retried payment can confirm');

        await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'paid' } });
        const again = await Order.claimPaidOnce(order._id);
        check('but a paid one cannot be claimed twice', again === false);
    }

    // ══ 4. Sequential retries stay safe ══════════════════════════════════
    {
        const { order, product } = await newOrder(3);
        const before = (await Product.findById(product._id)).stock;
        for (let i = 0; i < 5; i++) await confirmOnce(order._id, `tx-${i}`);
        const after = (await Product.findById(product._id)).stock;
        check('five retries still deduct once', before - after === 3,
            `stock went ${before} -> ${after} for an order of 3`);
    }

    // ══ 5. Separate orders are independent ═══════════════════════════════
    {
        const one = await newOrder(1);
        const two = await newOrder(1);
        const w1 = await confirmOnce(one.order._id, 'a');
        const w2 = await confirmOnce(two.order._id, 'b');
        check('one order being paid does not block another', w1 && w2);
    }

    await mongoose.disconnect();
    await mongod.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
