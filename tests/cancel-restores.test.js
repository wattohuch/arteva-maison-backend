/**
 * Cancelling a sale puts back what it took.
 *
 * Two things were not coming back.
 *
 *   Stock. currentHoldings reads orderStatus to decide that a cancelled order
 *   holds nothing - which is what makes releasing twice a no-op. But all three
 *   cancel paths marked the order cancelled first and released second, so by
 *   the time holdings were computed the order already read as cancelled and
 *   came back holding zero. Orders written by the gateways are the ones this
 *   hurt: they carry no stockLedgerVersion, so their holdings are inferred from
 *   quantity, and the cancelled flag is exactly what zeroes that inference. The
 *   units stayed deducted for good - which is the symptom an earlier fix in
 *   adminController describes as "the shop slowly ran out of stock it actually
 *   had", still happening for every gateway order.
 *
 *   The promo use. Only order deletion gave it back, so a cancelled order spent
 *   a limited-run code on a sale that never happened, and a customer on a
 *   one-per-person code who cancelled was locked out of it for good.
 *
 * Run: npm run test:cancel-restores
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
    await mongoose.connect(mongod.getUri(), { dbName: 'cancelrestore' });

    const Order = require('../src/models/Order');
    const Product = require('../src/models/Product');
    const Category = require('../src/models/Category');
    const PromoCode = require('../src/models/PromoCode');
    const stockService = require('../src/services/stockService');
    const promoService = require('../src/services/promoService');

    const cat = await Category.create({ name: 'Decor', slug: 'decor-cancel' });
    const buyer = new mongoose.Types.ObjectId();
    let seq = 0;

    /** An order in the shape a gateway writes: no ledger version, no stockHeld. */
    const gatewayOrder = async (qty = 2, extra = {}) => {
        const product = await Product.create({
            name: 'Scarf ' + (++seq), price: 30, category: cat._id, stock: 10,
        });
        const order = await Order.createWithRetry({
            user: buyer,
            items: [{ product: product._id, name: 'Scarf', price: 30, quantity: qty, stockHeld: 0 }],
            shippingAddress: { street: 'x', city: 'Kuwait City' },
            subtotal: 30 * qty, shippingCost: 2, total: 30 * qty + 2,
            paymentStatus: 'paid', orderStatus: 'confirmed',
            ...extra,
        });
        // The gateway paths deduct with a raw $inc.
        await Product.findByIdAndUpdate(product._id, { $inc: { stock: -qty } });
        return { order, product };
    };

    /** What every cancel path now does: snapshot, then mark, then release. */
    const cancel = async (order) => {
        const heldBefore = stockService.snapshotItems(order);
        order.updateStatus('cancelled', 'test', buyer);
        order.cancelledAt = new Date();
        await stockService.releaseOrderStock(order, { holdings: heldBefore });
        await promoService.releaseUsage(order);
        await order.save();
    };

    // ══ 1. A gateway order gives its stock back ══════════════════════════
    {
        const { order, product } = await gatewayOrder(2);
        check('the sale deducted the stock', (await Product.findById(product._id)).stock === 8);
        await cancel(order);
        check('cancelling a gateway order restores it',
            (await Product.findById(product._id)).stock === 10,
            'these orders carry no stockLedgerVersion, and used to restore nothing');
    }

    // ══ 2. So does one written with a stock ledger ═══════════════════════
    {
        const product = await Product.create({
            name: 'Vase ' + (++seq), price: 40, category: cat._id, stock: 10,
        });
        const order = await Order.createWithRetry({
            user: buyer,
            items: [{ product: product._id, name: 'Vase', price: 40, quantity: 3, stockHeld: 3 }],
            shippingAddress: { street: 'x', city: 'Kuwait City' },
            subtotal: 120, shippingCost: 2, total: 122,
            paymentStatus: 'paid', orderStatus: 'confirmed',
            stockLedgerVersion: stockService.STOCK_LEDGER_VERSION,
        });
        await Product.findByIdAndUpdate(product._id, { $inc: { stock: -3 } });
        await cancel(order);
        check('cancelling a ledgered order restores it',
            (await Product.findById(product._id)).stock === 10);
    }

    // ══ 3. Releasing twice invents nothing ═══════════════════════════════
    {
        const { order, product } = await gatewayOrder(2);
        await cancel(order);
        const reloaded = await Order.findById(order._id);
        await stockService.releaseOrderStock(reloaded);
        check('a second release moves no stock',
            (await Product.findById(product._id)).stock === 10,
            'the idempotency the cancelled flag was there to provide must survive');
    }

    // ══ 4. A refunded line holds nothing, so it is not restored twice ════
    {
        const product = await Product.create({
            name: 'Candle ' + (++seq), price: 20, category: cat._id, stock: 10,
        });
        const order = await Order.createWithRetry({
            user: buyer,
            items: [{ product: product._id, name: 'Candle', price: 20, quantity: 2, isRefunded: true }],
            shippingAddress: { street: 'x', city: 'Kuwait City' },
            subtotal: 40, shippingCost: 2, total: 42,
            paymentStatus: 'paid', orderStatus: 'confirmed',
        });
        const before = (await Product.findById(product._id)).stock;
        await cancel(order);
        check('a refunded line is not restored again',
            (await Product.findById(product._id)).stock === before,
            'its units went back when it was refunded');
    }

    // ══ 5. The promo use comes back ══════════════════════════════════════
    {
        const promo = await PromoCode.create({
            code: 'CANCELME', name: 'Cancel test',
            expiresAt: new Date(Date.now() + 8.64e7),
            maxUsage: 5, perUserLimit: 1,
            usageCount: 1, usedBy: [{ user: buyer, count: 1 }],
        });
        const { order } = await gatewayOrder(1, {
            promoCode: {
                code: 'CANCELME', name: 'Cancel test', promoCodeId: promo._id,
                totalDiscount: 5, usageCounted: true, discounts: [],
            },
        });

        const before = await PromoCode.findById(promo._id);
        check('the code counts the use before cancelling', before.usageCount === 1);
        check('and the customer is at their limit', before.canUserUse(buyer).valid === false);

        await cancel(order);

        const after = await PromoCode.findById(promo._id);
        check('cancelling gives the use back', after.usageCount === 0,
            'a cancelled sale must not consume a limited-run code');
        check('and the per-customer tally with it',
            (after.usedBy.find(u => String(u.user) === String(buyer)) || {}).count === 0);
        check('so the customer can use it again', after.canUserUse(buyer).valid === true,
            'a one-per-person code used to lock them out for good');

        // Releasing twice must not hand out free slots.
        const reloaded = await Order.findById(order._id);
        await promoService.releaseUsage(reloaded);
        const twice = await PromoCode.findById(promo._id);
        check('a second release does not invent a use', twice.usageCount === 0,
            `usageCount went to ${twice.usageCount}`);
    }

    // ══ 6. An order with no promo cancels cleanly ════════════════════════
    {
        const { order, product } = await gatewayOrder(1);
        await cancel(order);
        check('an order with no promo still restores its stock',
            (await Product.findById(product._id)).stock === 10);
    }

    await mongoose.disconnect();
    await mongod.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
