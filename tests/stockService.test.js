/**
 * Verifies stockService against a real MongoDB instance.
 * Run from the backend directory: node <this file>
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  → got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'stocktest' });

  const Product = require('../src/models/Product');
  const stock = require('../src/services/stockService');

  const Category = mongoose.model('Category', new mongoose.Schema({ name: String }));
  const cat = await Category.create({ name: 'Test' });

  const mk = (name, qty) => Product.create({ name, price: 10, category: cat._id, stock: qty });
  const stockOf = async (id) => (await Product.findById(id)).stock;

  // ── 1. Manual receipt deducts stock ──
  const a = await mk('Vase A', 10);
  const items = [{ product: a._id, name: 'Vase A', quantity: 3 }];
  await stock.reconcile(stock.buildTargets([], items, stock.heldForLine));
  check('create receipt: 10 - 3', await stockOf(a._id), 7);

  // ── 2. Editing quantity up moves only the delta ──
  const held = [{ product: a._id, name: 'Vase A', quantity: 3, stockHeld: 3 }];
  const grown = [{ product: a._id, name: 'Vase A', quantity: 5 }];
  await stock.reconcile(stock.buildTargets(held, grown, stock.heldForLine));
  check('edit 3 -> 5: deducts 2 more', await stockOf(a._id), 5);

  // ── 3. Editing quantity down returns the difference ──
  const held5 = [{ product: a._id, name: 'Vase A', quantity: 5, stockHeld: 5 }];
  const shrunk = [{ product: a._id, name: 'Vase A', quantity: 1 }];
  await stock.reconcile(stock.buildTargets(held5, shrunk, stock.heldForLine));
  check('edit 5 -> 1: restores 4', await stockOf(a._id), 9);

  // ── 4. Refunding a line puts it back ──
  const held1 = [{ product: a._id, name: 'Vase A', quantity: 1, stockHeld: 1 }];
  const refunded = [{ product: a._id, name: 'Vase A', quantity: 1, isRefunded: true }];
  await stock.reconcile(stock.buildTargets(held1, refunded, stock.heldForLine));
  check('refund line: restores 1', await stockOf(a._id), 10);

  // ── 5. Replaying the same save is a no-op (idempotence) ──
  const settled = [{ product: a._id, name: 'Vase A', quantity: 1, isRefunded: true, stockHeld: 0 }];
  await stock.reconcile(stock.buildTargets(settled, refunded, stock.heldForLine));
  check('replay refunded save: unchanged', await stockOf(a._id), 10);

  // ── 6. Overselling is refused and nothing is written ──
  const b = await mk('Vase B', 2);
  let refused = false;
  try {
    await stock.reconcile(stock.buildTargets([], [{ product: b._id, name: 'Vase B', quantity: 5 }], stock.heldForLine));
  } catch (e) { refused = e.code === 'INSUFFICIENT_STOCK'; }
  check('oversell refused', refused, true);
  check('oversell left stock untouched', await stockOf(b._id), 2);

  // ── 7. Partial failure rolls back the lines that DID succeed ──
  const c = await mk('Vase C', 10);
  const d = await mk('Vase D', 1);
  let rolled = false;
  try {
    await stock.reconcile(stock.buildTargets([], [
      { product: c._id, name: 'Vase C', quantity: 4 },   // would succeed
      { product: d._id, name: 'Vase D', quantity: 9 },   // fails
    ], stock.heldForLine));
  } catch (e) { rolled = e.code === 'INSUFFICIENT_STOCK'; }
  check('multi-line failure raised', rolled, true);
  check('succeeded line rolled back', await stockOf(c._id), 10);
  check('failed line untouched', await stockOf(d._id), 1);

  // ── 8. Concurrent deductions cannot oversell (the race the guard exists for) ──
  const e = await mk('Vase E', 5);
  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      stock.reconcile(stock.buildTargets([], [{ product: e._id, name: 'Vase E', quantity: 1 }], stock.heldForLine))
    )
  );
  const ok = attempts.filter(r => r.status === 'fulfilled').length;
  check('10 concurrent x1 against stock 5: exactly 5 succeed', ok, 5);
  check('concurrent: stock floors at 0, never negative', await stockOf(e._id), 0);

  // ── 9. Deleting an order releases everything it held ──
  const f = await mk('Vase F', 8);
  const order = { items: [{ product: f._id, name: 'Vase F', quantity: 3, stockHeld: 3 }] };
  await stock.releaseOrderStock(order);
  check('delete order: stock returned', await stockOf(f._id), 11);
  check('delete order: holdings cleared', order.items[0].stockHeld, 0);

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('SUITE ERROR:', err); process.exit(1); });
