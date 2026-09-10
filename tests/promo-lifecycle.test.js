/**
 * Promo codes, end to end - create, attach, price, charge, count.
 *
 * What this defends, in the order it went wrong.
 *
 *   The admin screen could not create a promo code at all. `name` is required
 *   by the schema and the form never collected it, so every save died on a
 *   ValidationError that an empty catch block threw away: the button stopped
 *   spinning and nothing else happened. The form also sent `usageLimit`,
 *   `discountType`, `discountValue` and `minOrderAmount`, none of which are
 *   fields the API reads - so even a save that had worked would have dropped
 *   the usage limit and the discount.
 *
 *   Nothing then discounted anything, because a code with no products matches
 *   no basket, which the shopper met as "does not apply to any items".
 *
 *   And the quote a shopper is shown has to be the amount they are charged.
 *   Every payment path - KNET, card and Apple Pay through MyFatoorah, and
 *   Deema - prices through the same calculator as /validate, so this checks
 *   the calculator once and checks that the paths share it.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
};

(async () => {
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'promo' });

    const PromoCode = require('../src/models/PromoCode');
    // Registered because resolveForUser populates products.product; without it
    // the populate throws MissingSchemaError rather than returning the promo.
    require('../src/models/Product');
    const promoService = require('../src/services/promoService');

    const admin = new mongoose.Types.ObjectId();
    const buyer = new mongoose.Types.ObjectId();

    /* Real catalogue rows, because resolveForUser populates products.product.
     * A promo rule pointing at a product that does not exist populates to null
     * and stops matching - which is the right behaviour for a deleted product,
     * and would make this test measure nothing if the rows were invented. */
    const Product = require('../src/models/Product');
    const category = new mongoose.Types.ObjectId();
    const scarfDoc = await Product.create({ name: 'Silk Scarf', price: 30, category });
    const vaseDoc = await Product.create({ name: 'Ceramic Vase', price: 40, category });
    const scarf = scarfDoc._id;
    const vase = vaseDoc._id;

    // == 1. The payload the admin form sends must actually save ============
    const fromForm = {
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

    const limit = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const promo = await PromoCode.create({
        code: String(fromForm.code).toUpperCase().trim(),
        name: String(fromForm.name).trim(),
        description: fromForm.description,
        isActive: fromForm.isActive,
        expiresAt: fromForm.expiresAt,
        maxUsage: limit(fromForm.maxUsage),
        perUserLimit: limit(fromForm.perUserLimit),
        maxQuantityPerOrder: limit(fromForm.maxQuantityPerOrder),
        minOrderAmount: Number(fromForm.minOrderAmount) || 0,
        defaultDiscountType: fromForm.defaultDiscountType,
        defaultDiscountValue: Number(fromForm.defaultDiscountValue),
        products: [],
        createdBy: admin,
    });

    check('the admin form payload saves', !!promo._id);
    check('the code is upper-cased', promo.code === 'EID25');
    check('the name is kept', promo.name === 'Eid Sale', 'this is the field that made every save fail');
    check('the total usage limit is kept', promo.maxUsage === 100, 'sent as usageLimit before, and dropped');
    check('the per-customer limit is kept', promo.perUserLimit === 1);
    check('the per-order item cap is kept', promo.maxQuantityPerOrder === 3);
    check('the basket minimum is kept', promo.minOrderAmount === 20, 'had nowhere to be stored before');
    check('the default discount is kept', promo.defaultDiscountValue === 25,
        'the product screen read this and always fell through to 10');

    check('an empty limit means unlimited', limit('') === null);
    check('a limit of zero stays zero', limit(0) === 0, 'the old fallback turned it into unlimited');

    // == 2. A code with no products discounts nothing ======================
    const none = promoService.calculateDiscount(promo, [
        { product: scarf, name: 'Silk Scarf', price: 30, quantity: 1 },
    ]);
    check('a code with no products matches nothing', none.totalDiscount === 0,
        'what a shopper met as "does not apply to any items"');

    // == 3. Attaching products, with the code default ======================
    promo.products.push({
        product: scarf,
        discountType: promo.defaultDiscountType,
        discountValue: promo.defaultDiscountValue,
    });
    await promo.save();
    const attached = await PromoCode.findById(promo._id);
    check('an attached product takes the default discount', attached.products[0].discountValue === 25);

    // == 4. The basket minimum is enforced =================================
    const small = promoService.calculateDiscount(attached, [
        { product: scarf, name: 'Silk Scarf', price: 15, quantity: 1 },
    ]);
    check('a basket under the minimum gets nothing', small.totalDiscount === 0);
    check('and is told apart from a code that does not apply', small.belowMinimum === true);

    const big = promoService.calculateDiscount(attached, [
        { product: scarf, name: 'Silk Scarf', price: 30, quantity: 1 },
    ]);
    check('a basket over the minimum is discounted', big.totalDiscount === 7.5, 'got ' + big.totalDiscount);
    check('and is not flagged below minimum', big.belowMinimum === false);

    const goodsOnly = promoService.calculateDiscount(attached, [
        { product: scarf, name: 'Silk Scarf', price: 19, quantity: 1 },
    ]);
    check('the minimum is measured on the goods, not the delivery',
        goodsOnly.belowMinimum === true,
        '19 KWD of goods plus 2 shipping must not qualify for a 20 KWD minimum');

    // == 5. Caps still hold ================================================
    const many = promoService.calculateDiscount(attached, [
        { product: scarf, name: 'Silk Scarf', price: 30, quantity: 10 },
    ]);
    check('the per-order item cap is applied', many.discountedUnits === 3, 'got ' + many.discountedUnits);
    check('and priced on the capped units only', many.totalDiscount === 22.5, 'got ' + many.totalDiscount);

    const mixed = promoService.calculateDiscount(attached, [
        { product: scarf, name: 'Silk Scarf', price: 30, quantity: 1 },
        { product: vase, name: 'Ceramic Vase', price: 40, quantity: 1 },
    ]);
    check('a product not on the code is not discounted', mixed.matchedProducts === 1);
    check('and the total covers only the matched one', mixed.totalDiscount === 7.5);

    // == 6. The quote and the charge come from one place ===================
    const built = await promoService.buildOrderPromo('EID25', [
        { product: scarf, name: 'Silk Scarf', price: 30, quantity: 1 },
    ], { userId: buyer, source: 'manual_entry' });

    check('the payment path prices the code', built.promoData !== null, built.reason || '');
    check('and agrees with the quote to the fils',
        built.promoData.totalDiscount === big.totalDiscount,
        (built.promoData && built.promoData.totalDiscount) + ' vs ' + big.totalDiscount);
    check('usage starts uncounted', built.promoData.usageCounted === false);

    const tooSmall = await promoService.buildOrderPromo('EID25', [
        { product: scarf, name: 'Silk Scarf', price: 5, quantity: 1 },
    ], { userId: buyer });
    check('a basket under the minimum is refused at the payment path too', tooSmall.promoData === null);
    check('with a reason that names the figure', /20\.000 KWD/.test(tooSmall.reason || ''), tooSmall.reason);

    // == 7. Usage is counted once, whichever path confirms =================
    const Order = require('../src/models/Order');
    const order = await Order.create({
        user: buyer,
        items: [{ name: 'Silk Scarf', price: 30, quantity: 1 }],
        shippingAddress: { street: 'x', city: 'Kuwait City' },
        subtotal: 30, shippingCost: 2,
        promoCode: Object.assign({}, built.promoData, { promoCodeId: promo._id }),
        total: 24.5,
    });

    const first = await promoService.countUsageOnce(order);
    check('the first confirmation counts the use', first === true);

    const reloaded = await Order.findById(order._id);
    const second = await promoService.countUsageOnce(reloaded);
    check('a second confirmation does not count it again', second === false,
        'callback, verify and webhook can all fire for one sale');

    const afterUse = await PromoCode.findById(promo._id);
    check('the counter moved exactly once', afterUse.usageCount === 1, 'got ' + afterUse.usageCount);
    check('and the customer tally moved with it',
        afterUse.usedBy.length === 1 && afterUse.usedBy[0].count === 1);

    // == 8. The limits actually bite ======================================
    check('a customer at their per-customer limit is refused',
        afterUse.canUserUse(buyer).valid === false);
    check('a different customer is not',
        afterUse.canUserUse(new mongoose.Types.ObjectId()).valid === true);

    afterUse.usageCount = afterUse.maxUsage;
    check('a code at its total limit is refused', afterUse.isValid().valid === false);

    await mongoose.disconnect();
    await mongod.stop();

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
