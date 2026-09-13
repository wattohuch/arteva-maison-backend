/**
 * The stock ledger and the gateways must stay in step.
 *
 * Two ways of moving stock live in this codebase.
 *
 *   stockService reconciles against `stockHeld` on each line, and an order that
 *   uses it carries `stockLedgerVersion`. Refunds and cancellations read those
 *   holdings to know what to put back.
 *
 *   The gateway payment paths do not use it. They deduct with a raw
 *   `$inc: { stock: -quantity }`, so `stockHeld` stays 0 - and they also never
 *   stamp `stockLedgerVersion`, so currentHoldings treats those orders as
 *   legacy and infers holdings from `quantity` instead. That inference is
 *   exactly what the raw $inc removed, so the two agree.
 *
 * They agree by coincidence, not by design, and the coincidence is load
 * bearing. Stamping the version on a gateway order without also moving it to
 * stockService makes currentHoldings read the real `stockHeld` - which is 0 -
 * and every refund and cancellation on that order silently restores nothing.
 * Measured: a two-unit order refunds and the shelf stays at 8 of 10.
 *
 * That is not a hypothetical. The refund path carries a comment describing the
 * same failure as a bug that was reported and fixed once already.
 *
 * So this pins the coupling. If a future change stamps the version on a
 * gateway path, this fails and says what else has to change with it.
 *
 * Run: npm run test:stock-ledger
 */
const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
    cond ? pass++ : fail++;
};

const GATEWAY_CONTROLLERS = [
    'paymentControllerMyFatoorah.js',
    'paymentControllerDeema.js',
];

(async () => {
    // ══ 1. The structural half: the coupling itself ══════════════════════
    for (const file of GATEWAY_CONTROLLERS) {
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'controllers', file), 'utf8'
        );

        const rawDeduct = /\$inc:\s*\{\s*stock:\s*-/.test(src);
        const stamps = /stockLedgerVersion/.test(src);
        const usesService = /stockService\s*\./.test(src);

        check(`${file}: still deducts stock with a raw $inc`, rawDeduct,
            'if this moved to stockService, the rest of this test is obsolete - delete it');

        check(`${file}: does not stamp stockLedgerVersion`, !stamps,
            'stamping it while stockHeld stays 0 makes every refund and cancellation '
            + 'on a gateway order restore nothing. Move these paths to stockService '
            + 'in the same change, or leave the version unstamped.');

        check(`${file}: does not half-adopt stockService for stock moves`,
            !(usesService && stamps),
            'either both or neither - a half migration is what breaks refunds');
    }

    // ══ 2. The behavioural half: prove it still works either way ═════════
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'ledgercoupling' });

    const Order = require('../src/models/Order');
    const Product = require('../src/models/Product');
    const Category = require('../src/models/Category');
    const stockService = require('../src/services/stockService');

    const cat = await Category.create({ name: 'Decor', slug: 'decor-ledger' });
    const user = new mongoose.Types.ObjectId();
    let seq = 0;

    /** A full refund, in the sequence refundOrder actually uses. */
    const refundFully = async ({ stamped }) => {
        const product = await Product.create({
            name: 'Piece ' + (++seq), price: 30, category: cat._id, stock: 10,
        });
        const data = {
            user,
            items: [{ product: product._id, name: 'Piece', price: 30, quantity: 2, stockHeld: 0 }],
            shippingAddress: { street: 'x', city: 'Kuwait City' },
            subtotal: 60, shippingCost: 2, total: 62,
            paymentStatus: 'paid', orderStatus: 'confirmed',
        };
        if (stamped) data.stockLedgerVersion = stockService.STOCK_LEDGER_VERSION;

        const order = await Order.createWithRetry(data);
        // What the gateway paths do.
        await Product.findByIdAndUpdate(product._id, { $inc: { stock: -2 } });

        const previousItems = stockService.snapshotItems(order);
        order.items.forEach(i => { i.isRefunded = true; i.refundAmount = 60; });
        order.refundStatus = 'Full';
        order.paymentStatus = 'refunded';
        order.updateStatus('cancelled', 'Fully refunded', user);
        await stockService.syncOrderStock(order, { previousItems });
        await order.save();

        return (await Product.findById(product._id)).stock;
    };

    const asShipped = await refundFully({ stamped: false });
    check('a gateway order refunds its stock as things stand', asShipped === 10,
        `shelf ended at ${asShipped} of 10`);

    const ifStamped = await refundFully({ stamped: true });
    check('and stamping the version alone would break that', ifStamped === 8,
        `shelf ended at ${ifStamped} of 10 - if this restored correctly, the coupling `
        + 'is gone and the warnings above can be retired');

    await mongoose.disconnect();
    await mongod.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
