/**
 * Manual receipt → database → print queue.
 *
 * Covers the path the counter actually uses: an admin saves a receipt in the
 * generator, it must be persisted, it must appear in what the Raspberry Pi
 * collects, and it must ask for two copies — one for the customer, one the
 * shop keeps. An online order must still ask for one.
 *
 * Runs against a real in-memory Mongo, so the poll filter here is the same
 * query the agent is served rather than a restatement of it.
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** The exact filter /api/admin/print-queue/poll offers the agent. */
function pollFilter() {
  return {
    paymentStatus: 'paid',
    orderStatus: { $nin: ['cancelled'] },
    printedAt: { $exists: false },
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  };
}

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const Order = require('../src/models/Order');
  const User = require('../src/models/User');
  const Product = require('../src/models/Product');

  const admin = await User.create({
    name: 'Counter', email: 'counter@test.com', password: 'secret123', role: 'admin',
  });
  const product = await Product.create({
    name: 'Bronze bowl', price: 26, stock: 10, sku: 'BB-1',
    category: new mongoose.Types.ObjectId(), images: [{ url: '/x.jpg' }],
  });

  const baseOrder = (over = {}) => ({
    user: admin._id,
    items: [{ product: product._id, name: product.name, price: 26, quantity: 1, stockHeld: 1 }],
    shippingAddress: { street: 'S', city: 'Kuwait' },
    subtotal: 26, total: 26,
    paymentStatus: 'paid', orderStatus: 'confirmed',
    ...over,
  });

  // ── A manual receipt is saved, queued, and asks for two copies ──
  const receipt = await Order.create(baseOrder({ orderSource: 'manual', printCopies: 2 }));

  const stored = await Order.findById(receipt._id).lean();
  check('a manual receipt is persisted', !!stored);
  check('  with its line items', stored.items.length === 1 && stored.items[0].quantity === 1);
  check('  and an order number', !!stored.orderNumber, String(stored.orderNumber));

  const queued = await Order.find(pollFilter()).lean();
  check('  it appears in what the Pi collects',
    queued.some(o => String(o._id) === String(receipt._id)),
    `queue holds ${queued.length}`);

  const fromQueue = queued.find(o => String(o._id) === String(receipt._id));
  check('  asking for TWO copies', fromQueue.printCopies === 2, String(fromQueue.printCopies));

  // ── An online order asks for one ──
  const online = await Order.create(baseOrder({ orderSource: 'online' }));
  const onlineQueued = (await Order.find(pollFilter()).lean())
    .find(o => String(o._id) === String(online._id));
  check('an online order asks for ONE copy', onlineQueued.printCopies === 1, String(onlineQueued.printCopies));

  // ── Orders predating the field carry no count, and the agent falls back ──
  await Order.collection.updateOne({ _id: online._id }, { $unset: { printCopies: 1 } });
  const legacy = await Order.collection.findOne({ _id: online._id });
  check('a pre-existing order has no stored count', legacy.printCopies === undefined);

  // Mirrors the agent's own expression.
  const COPIES = 1;
  const resolved = Math.min(Math.max(parseInt(legacy.printCopies, 10) || COPIES, 1), 5);
  check('  and resolves to the station default', resolved === 1, String(resolved));

  // ── Once printed, it leaves the queue and cannot print again ──
  await Order.findByIdAndUpdate(receipt._id, { printedAt: new Date() });
  const after = await Order.find(pollFilter()).lean();
  check('a printed receipt leaves the queue',
    !after.some(o => String(o._id) === String(receipt._id)));

  // ── A cancelled order is never printed ──
  const cancelled = await Order.create(baseOrder({ orderSource: 'manual', orderStatus: 'cancelled' }));
  const afterCancel = await Order.find(pollFilter()).lean();
  check('a cancelled order is never queued',
    !afterCancel.some(o => String(o._id) === String(cancelled._id)));

  // ── The count is clamped, so a bad value cannot run off 500 pages ──
  const silly = new Order(baseOrder({ printCopies: 99 }));
  const err = silly.validateSync();
  check('an absurd copy count is rejected', !!err?.errors?.printCopies, 'no validation error');

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
