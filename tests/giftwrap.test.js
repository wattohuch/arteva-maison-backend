/**
 * Gift wrapping, and the custom receipt line that made it possible.
 *
 * Two things are being defended here.
 *
 *   The price is the server's. A checkout that accepts a fee from the browser
 *   is a checkout where anyone can wrap an order for nothing, so every path
 *   into an order derives the charge from config/pricing and takes only the
 *   customer's intent from the request.
 *
 *   A line without a catalogue product is legitimate. The order item schema
 *   demanded one, which is why adding a custom item to a manual receipt failed
 *   with "Path `product` is required" — while stockService had already been
 *   written to treat such a line as untracked.
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
    process.env.MONGODB_URI = mongod.getUri();
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'giftwrap' });

    const { resolveGiftWrap, giftWrapFee } = require('../src/config/pricing');
    const Order = require('../src/models/Order');
    const Cart = require('../src/models/Cart');
    const User = require('../src/models/User');
    const stockService = require('../src/services/stockService');

    delete process.env.GIFT_WRAP_FEE;

    // ══ 1. The fee is ours, not the client's ═══════════════════════════════
    check('a client-supplied fee of zero is ignored',
        resolveGiftWrap({ enabled: true, fee: 0 }).fee === 3);
    check('a negative fee cannot credit the order',
        resolveGiftWrap({ enabled: true, fee: -50 }).fee === 3);
    check('an inflated fee is not honoured either',
        resolveGiftWrap({ enabled: true, fee: 9999 }).fee === 3);
    check('declining wrapping costs nothing',
        resolveGiftWrap({ enabled: false, fee: 3 }).fee === 0);
    check('no gift wrap field at all is free', resolveGiftWrap(undefined).fee === 0);
    check('null is free', resolveGiftWrap(null).fee === 0);

    // ══ 2. Intent arrives in several shapes ════════════════════════════════
    check('the string "true" counts as asking for it',
        resolveGiftWrap({ enabled: 'true' }).enabled === true);
    check('the string "false" does not',
        resolveGiftWrap({ enabled: 'false' }).enabled === false);
    check('a truthy non-boolean does not sneak through',
        resolveGiftWrap({ enabled: 1 }).enabled === false);

    // ══ 3. The card message ════════════════════════════════════════════════
    check('the message is trimmed',
        resolveGiftWrap({ enabled: true, message: '  Happy birthday  ' }).message === 'Happy birthday');
    check('an overlong message is cut to 300',
        resolveGiftWrap({ enabled: true, message: 'x'.repeat(500) }).message.length === 300);
    check('no message is kept when wrapping is declined',
        resolveGiftWrap({ enabled: false, message: 'keep me' }).message === '');
    check('a message is optional',
        resolveGiftWrap({ enabled: true }).message === '');

    // ══ 4. The price is configuration, not code ════════════════════════════
    process.env.GIFT_WRAP_FEE = '5';
    check('the fee can be changed without a deploy',
        resolveGiftWrap({ enabled: true }).fee === 5);
    process.env.GIFT_WRAP_FEE = '0';
    check('free wrapping is expressible — it is a real promotion',
        giftWrapFee() === 0);
    process.env.GIFT_WRAP_FEE = 'nonsense';
    check('a nonsense value falls back to the default', giftWrapFee() === 3);
    delete process.env.GIFT_WRAP_FEE;
    check('the default is 3 KWD', giftWrapFee() === 3);

    // ══ 5. A line with no catalogue product ════════════════════════════════
    const staff = await User.create({ name: 'Staff', email: 'staff@x.com', password: 'xxxxxxxx' });

    let saved = null;
    let saveError = null;
    try {
        saved = await Order.create({
            user: staff._id,
            items: [
                { name: 'One-off charge', price: 5, quantity: 1 },
                { name: 'Hand-written card', price: 1.5, quantity: 2, product: null },
            ],
            shippingAddress: { street: 'Block 4', city: 'Kuwait' },
            subtotal: 8, total: 8, currency: 'KWD',
        });
    } catch (err) {
        saveError = err.message;
    }

    check('a receipt line with no product saves', saved !== null, saveError);
    check('the product is stored as null, not dropped',
        saved && saved.items[0].product === null);
    check('the line keeps its name and price',
        saved && saved.items[0].name === 'One-off charge' && saved.items[0].price === 5);

    // The schema and the stock service have to agree about what such a line is.
    check('stock treats a product-less line as untracked',
        stockService.isTrackedLine({ name: 'x', quantity: 1 }) === false);
    check('a real product line is still tracked',
        stockService.isTrackedLine({ product: new mongoose.Types.ObjectId(), quantity: 1 }) === true);

    // ══ 6. What an order stores ════════════════════════════════════════════
    const wrapped = await Order.create({
        user: staff._id,
        items: [{ name: 'Vase', price: 26, quantity: 1 }],
        shippingAddress: { street: 'Block 4', city: 'Kuwait' },
        subtotal: 26,
        shippingCost: 2,
        giftWrap: resolveGiftWrap({ enabled: true, message: 'For Noura' }),
        total: 31,
        currency: 'KWD',
    });
    check('the order records that it is wrapped', wrapped.giftWrap.enabled === true);
    check('the order records the fee charged', wrapped.giftWrap.fee === 3);
    check('the order records the card message', wrapped.giftWrap.message === 'For Noura');
    check('subtotal + shipping + wrap is the total',
        wrapped.subtotal + wrapped.shippingCost + wrapped.giftWrap.fee === wrapped.total);

    /* The stored fee, not a live lookup: an old order has to keep totalling to
     * what the customer actually paid after the price changes. */
    process.env.GIFT_WRAP_FEE = '7';
    const reread = await Order.findById(wrapped._id).lean();
    check('a price change does not rewrite an old order', reread.giftWrap.fee === 3);
    delete process.env.GIFT_WRAP_FEE;

    const plain = await Order.create({
        user: staff._id,
        items: [{ name: 'Bowl', price: 26, quantity: 1 }],
        shippingAddress: { street: 'Block 4', city: 'Kuwait' },
        subtotal: 26, shippingCost: 2, total: 28, currency: 'KWD',
    });
    check('an unwrapped order defaults to off and free',
        plain.giftWrap.enabled === false && plain.giftWrap.fee === 0);

    // ══ 7. The cart carries the choice across the gateway ══════════════════
    const cart = await Cart.create({
        user: staff._id,
        items: [],
        giftWrap: { enabled: true, message: 'For Noura' },
    });
    check('the cart remembers the request', cart.giftWrap.enabled === true);
    check('the cart never stores a price',
        cart.giftWrap.fee === undefined,
        'a fee on the cart is a fee a client could reach');

    const fromCart = resolveGiftWrap(cart.giftWrap);
    check('an order built from the cart is priced by the server', fromCart.fee === 3);
    check('and carries the message through', fromCart.message === 'For Noura');

    // == 8. Per-item wrapping ==============================================
    //
    // Wrapping is chosen line by line and charged once per wrapped line - not
    // per unit, because two of the same candle ticked is one gift.
    const { summariseGiftWrap, applyGiftWrapChoices } = require('../src/config/pricing');

    const twoOfThree = summariseGiftWrap(
        [{ giftWrap: true }, { giftWrap: false }, { giftWrap: true }],
        'For Noura'
    );
    check('each wrapped line is charged', twoOfThree.fee === 6, `got ${twoOfThree.fee}`);
    check('the wrapped lines are counted', twoOfThree.count === 2);
    check('wrapping is on when any line is wrapped', twoOfThree.enabled === true);
    check('the card message survives', twoOfThree.message === 'For Noura');

    check('quantity is not a multiplier - one line, one fee',
        summariseGiftWrap([{ giftWrap: true, quantity: 4 }]).fee === 3,
        'four candles in one line is one gift');

    check('nothing ticked is nothing charged',
        summariseGiftWrap([{ giftWrap: false }, {}]).fee === 0);
    check('and carries no message',
        summariseGiftWrap([{ giftWrap: false }], 'orphan').message === '');

    check('a refunded line is not charged for its wrapping',
        summariseGiftWrap([{ giftWrap: true }, { giftWrap: true, isRefunded: true }]).fee === 3,
        'a returned item was not wrapped for the customer to keep');

    check('a message that is not a string is refused, not stringified',
        summariseGiftWrap([{ giftWrap: true }], { evil: 1 }).message === '',
        'this used to print [object Object] on the receipt');

    const applied = applyGiftWrapChoices(
        [{ product: 'aaa' }, { product: 'bbb' }],
        [{ productId: 'aaa', giftWrap: true }, { productId: 'zzz', giftWrap: true }]
    );
    check('a named line is wrapped', applied[0].giftWrap === true);
    check('an unmentioned line is not', applied[1].giftWrap === false);
    check('a line the client invented cannot be added', applied.length === 2);

    // == 9. An empty GIFT_WRAP_FEE is a misconfiguration, not free wrapping ==
    process.env.GIFT_WRAP_FEE = '';
    check('a blank fee falls back rather than making wrapping free',
        giftWrapFee() === 3,
        'Number("") is 0, which would have silently zeroed the charge');
    process.env.GIFT_WRAP_FEE = '0';
    check('an explicit zero is still honoured - free wrapping is a real promotion',
        giftWrapFee() === 0);
    delete process.env.GIFT_WRAP_FEE;

    // == 10. The gift-wrap route is reachable ==============================
    //
    // It was not. PUT /cart/:productId was registered first, so
    // PUT /cart/gift-wrap matched it as a product called "gift-wrap" and was
    // rejected by isMongoId with 400 - the endpoint could never be reached,
    // no wrapping choice ever reached the server, and the storefront rolled
    // the failed request back so the tick appeared to untick itself.
    const cartRouter = require('../src/routes/cart');
    const putPaths = cartRouter.stack
        .filter(layer => layer.route && layer.route.methods.put)
        .map(layer => layer.route.path);
    check('a literal PUT path is matched before the parameterised one',
        putPaths.indexOf('/gift-wrap') < putPaths.indexOf('/:productId'),
        `order was ${JSON.stringify(putPaths)}`);
    check('the whole-bag replace is also matched before it',
        putPaths.indexOf('/') < putPaths.indexOf('/:productId'),
        `order was ${JSON.stringify(putPaths)}`);

    // == 11. An order records which lines were wrapped =====================
    const perItem = await Order.create({
        user: staff._id,
        items: [
            { name: 'Silk Scarf', price: 12, quantity: 1, giftWrap: true },
            { name: 'Ceramic Vase', price: 15, quantity: 1, giftWrap: false },
        ],
        shippingAddress: { street: 'x', city: 'Kuwait City' },
        subtotal: 27,
        shippingCost: 2,
        giftWrap: summariseGiftWrap([{ giftWrap: true }, { giftWrap: false }], 'Happy birthday'),
        total: 32,
    });
    check('the wrapped line is marked', perItem.items[0].giftWrap === true);
    check('the unwrapped line is not', perItem.items[1].giftWrap === false);
    check('the order totals to one wrapping fee', perItem.giftWrap.fee === 3);
    check('subtotal + shipping + one wrap is the total',
        perItem.subtotal + perItem.shippingCost + perItem.giftWrap.fee === perItem.total);


    await mongoose.disconnect();
    await mongod.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
