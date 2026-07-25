const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  → got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
};

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'promotest' });

  const PromoCode = require('../src/models/PromoCode');
  const Order = require('../src/models/Order');
  const User = require('../src/models/User');
  const promoService = require('../src/services/promoService');

  const user = await User.create({ name: 'T', email: 't@x.com', password: 'x'.repeat(12) });

  const promo = await PromoCode.create({
    code: 'SAVE20', name: 'Save 20', expiresAt: new Date(Date.now() + 8.64e7),
    products: [], maxUsage: 5,
  });

  const mkOrder = async () => Order.createWithRetry({
    user: user._id,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'X', price: 10, quantity: 1 }],
    shippingAddress: { street: 's', city: 'c' },
    subtotal: 10, total: 10,
    promoCode: { code: 'SAVE20', name: 'Save 20', promoCodeId: promo._id, totalDiscount: 2, usageCounted: false },
  });

  // Payment confirmation arrives three ways for one order (redirect callback,
  // /verify poll, gateway webhook). Only one may count.
  const order = await mkOrder();
  const results = await Promise.all([
    promoService.countUsageOnce(order),
    promoService.countUsageOnce(order),
    promoService.countUsageOnce(order),
  ]);
  check('concurrent triple-confirm: exactly one counts', results.filter(Boolean).length, 1);
  check('usageCount incremented once', (await PromoCode.findById(promo._id)).usageCount, 1);
  check('per-user tally is 1', (await PromoCode.findById(promo._id)).usedBy[0].count, 1);

  // A later sequential retry must also be refused.
  const again = await promoService.countUsageOnce(await Order.findById(order._id));
  check('sequential retry refused', again, false);
  check('usageCount still 1', (await PromoCode.findById(promo._id)).usageCount, 1);

  // A second, genuine order does count.
  const order2 = await mkOrder();
  await promoService.countUsageOnce(order2);
  const after = await PromoCode.findById(promo._id);
  check('second real order counts', after.usageCount, 2);
  check('per-user tally now 2', after.usedBy[0].count, 2);

  // Owner deletes an order → the use is released, not permanently burned.
  await promoService.releaseUsage(await Order.findById(order2._id));
  const released = await PromoCode.findById(promo._id);
  check('delete releases usage', released.usageCount, 1);
  check('delete releases per-user tally', released.usedBy[0].count, 1);

  await mongoose.disconnect();
  await mongod.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
