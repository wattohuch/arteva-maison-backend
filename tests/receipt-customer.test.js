/**
 * A receipt describes a sale. It must never edit a user account.
 *
 * Two failures happened in ordinary counter use and this pins both:
 *
 *   1. A receipt saved with a name and phone but no email was attached to
 *      whoever was logged in, and the renderers read the customer from that
 *      account — so it printed the cashier's name and email instead of the
 *      buyer's.
 *
 *   2. Editing any receipt copied the typed name, email and phone INTO the
 *      linked User document. That renamed the admin's own account in case (1),
 *      and rewrote a real customer's profile — including the email they sign in
 *      with — whenever the receipt did match one.
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { buildReceiptHTMLFromData } = require('../raspi-print-station/sharedReceiptTemplate');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** Mirrors how every renderer resolves who the buyer is. */
function resolveCustomer(order) {
  const c = order.customer;
  return (c && (c.name || c.email || c.phone)) ? c : (order.user || {});
}

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const Order = require('../src/models/Order');
  const User = require('../src/models/User');

  const owner = await User.create({
    name: 'mohammad', email: 'owner@arteva.com', password: 'secret123', role: 'owner', phone: '+96500000000',
  });

  // ── A counter receipt: name and phone typed, no email ──
  const receipt = await Order.create({
    user: owner._id,                       // no email typed, so it links to the admin
    createdByAdmin: owner._id,
    orderSource: 'manual',
    customer: { name: 'Moza', email: '', phone: '+96541107701' },
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Bowl', price: 26, quantity: 1 }],
    shippingAddress: { street: 'Salva Block6', city: 'Kuwait', fullName: 'Moza' },
    subtotal: 26, total: 26, paymentStatus: 'paid', orderStatus: 'confirmed',
  });

  const stored = await Order.findById(receipt._id).populate('user', 'name email phone').lean();
  const buyer = resolveCustomer(stored);

  check('the receipt names the BUYER, not the cashier', buyer.name === 'Moza', buyer.name);
  check('  and carries the buyer phone', buyer.phone === '+96541107701', buyer.phone);
  check('  not the owner email', buyer.email !== 'owner@arteva.com', buyer.email);

  // The rendered receipt is what the customer is handed — check the real output.
  const html = buildReceiptHTMLFromData(stored, { receiptQR: '', whatsappQR: '' });
  check('  the printed receipt shows "Moza"', html.includes('Moza'));
  check('  and never shows the owner name', !html.includes('mohammad'), 'owner name leaked onto the receipt');
  check('  nor the owner email', !html.includes('owner@arteva.com'), 'owner email leaked onto the receipt');

  // ── The account behind it must be untouched ──
  const ownerAfter = await User.findById(owner._id).lean();
  check('the owner account keeps its name', ownerAfter.name === 'mohammad', ownerAfter.name);
  check('  its email', ownerAfter.email === 'owner@arteva.com', ownerAfter.email);
  check('  and its phone', ownerAfter.phone === '+96500000000', ownerAfter.phone);

  // ── Editing the receipt changes the order, never the account ──
  const editing = await Order.findById(receipt._id);
  editing.customer.name = 'Moza Al-Sabah';
  editing.customer.phone = '+96599999999';
  editing.markModified('customer');
  await editing.save();

  const edited = await Order.findById(receipt._id).lean();
  const ownerAfterEdit = await User.findById(owner._id).lean();

  check('an edit updates the receipt', edited.customer.name === 'Moza Al-Sabah', edited.customer.name);
  check('  and STILL leaves the account alone', ownerAfterEdit.name === 'mohammad', ownerAfterEdit.name);
  check('  including the sign-in email', ownerAfterEdit.email === 'owner@arteva.com', ownerAfterEdit.email);

  // ── An online order has no snapshot and resolves through the account ──
  const shopper = await User.create({ name: 'Real Shopper', email: 'shopper@x.com', password: 'secret123' });
  const online = await Order.create({
    user: shopper._id, orderSource: 'online',
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Vase', price: 40, quantity: 1 }],
    shippingAddress: { street: 'A', city: 'Kuwait' },
    subtotal: 40, total: 40,
  });
  const onlineStored = await Order.findById(online._id).populate('user', 'name email phone').lean();
  check('an online order still resolves through its account',
    resolveCustomer(onlineStored).name === 'Real Shopper',
    resolveCustomer(onlineStored).name);

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
