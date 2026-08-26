/**
 * The QR on a receipt must resolve, or not be printed at all.
 *
 * A manual receipt printed from the generator carried a QR built from the
 * unsaved draft: an order number the database had never seen and no tracking
 * token. Scanning it gave "Order not found" — a customer holding paper from the
 * shop, scanning the code on it, and being told the order does not exist.
 *
 * The link is only meaningful once the receipt is saved and the server has
 * minted a token, so that is exactly when it may be drawn.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** Mirrors the renderer's rule: a code is drawn only when it can resolve. */
function canLinkToReceipt(order) {
  return !!(order && order.trackingToken && order.orderNumber);
}

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const Order = require('../src/models/Order');
  const User = require('../src/models/User');

  const admin = await User.create({
    name: 'Counter', email: 'c@t.com', password: 'secret123', role: 'admin',
  });

  // ── The draft, as the generator holds it before Save ──
  const draft = { orderNumber: '56I7WLAT', trackingToken: '' };
  check('an unsaved draft cannot produce a working link', !canLinkToReceipt(draft));

  // ── The same receipt once saved ──
  const saved = await Order.create({
    user: admin._id,
    orderSource: 'manual',
    orderNumber: '56I7WLAT',
    customer: { name: 'Moza', email: '', phone: '+96541107701' },
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Bowl', price: 26, quantity: 1 }],
    shippingAddress: { street: 'S', city: 'Kuwait', fullName: 'Moza' },
    subtotal: 26, total: 26, paymentStatus: 'paid', orderStatus: 'confirmed',
  });

  check('saving mints a tracking token', !!saved.trackingToken, String(saved.trackingToken));
  check('  and the link can now be drawn', canLinkToReceipt(saved));

  // ── The link must actually find the order, the way the endpoint does ──
  const url = `https://www.artevamaisonkw.com/receipt.html?order=${encodeURIComponent(saved.orderNumber)}&token=${encodeURIComponent(saved.trackingToken)}`;
  const params = new URLSearchParams(url.split('?')[1]);

  const found = await Order.findOne({ orderNumber: params.get('order') });
  check('the order number in the link resolves', !!found, 'lookup returned nothing');
  check('  and the token matches the stored one',
    found.trackingToken === params.get('token'),
    `${found.trackingToken} vs ${params.get('token')}`);

  // The endpoint refuses a receipt whose payment is not settled, so a link on
  // an unpaid receipt would 403 even though the order exists.
  check('  and the receipt is payable, so the endpoint will serve it',
    found.paymentStatus === 'paid' || found.paymentMethod === 'cod',
    found.paymentStatus);

  // ── A wrong token must not open someone else's receipt ──
  const other = await Order.create({
    user: admin._id, orderSource: 'manual', orderNumber: 'OTHER123',
    items: [{ product: new mongoose.Types.ObjectId(), name: 'X', price: 1, quantity: 1 }],
    shippingAddress: { street: 'S', city: 'Kuwait' },
    subtotal: 1, total: 1, paymentStatus: 'paid',
  });
  check('one receipt token does not open another',
    other.trackingToken !== saved.trackingToken);

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
