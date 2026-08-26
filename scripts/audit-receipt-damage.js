/**
 * Did the receipt editor already overwrite real accounts?
 *
 *   node scripts/audit-receipt-damage.js
 *
 * READ ONLY. Changes nothing.
 *
 * Until this was fixed, saving a manual receipt copied the typed name, email
 * and phone into the linked User document, and a receipt saved without an email
 * was linked to whoever was logged in. So a staff account could have been
 * renamed to a customer, and manual receipts attached to a staff account print
 * that staff member's details in the customer box.
 *
 * This reports both, so the damage can be seen before deciding what to correct.
 */
require('dotenv').config();

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');

const STAFF = ['owner', 'superuser', 'admin', 'cashier'];

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const Order = require('../src/models/Order');
  const User = require('../src/models/User');

  console.log('── Staff accounts ──');
  const staff = await User.find({ role: { $in: STAFF } })
    .select('name email phone role updatedAt createdAt').lean();

  for (const u of staff) {
    // A profile edited long after it was created is not proof of damage, but it
    // is where to look first — these accounts are rarely edited legitimately.
    const touched = u.updatedAt && u.createdAt &&
      (new Date(u.updatedAt) - new Date(u.createdAt)) > 60_000;
    console.log(
      `  ${String(u.role).padEnd(10)} ${String(u.name).padEnd(22)} ${String(u.email).padEnd(30)} ` +
      `${String(u.phone || '—').padEnd(16)}${touched ? '  ← profile changed after creation' : ''}`
    );
  }

  console.log('\n── Manual receipts attached to a staff account ──');
  console.log('   (these print the staff member as the customer unless they carry their own snapshot)');

  const staffIds = staff.map(u => u._id);
  const suspect = await Order.find({ orderSource: 'manual', user: { $in: staffIds } })
    .select('orderNumber user customer shippingAddress createdAt total')
    .populate('user', 'name email role')
    .sort({ createdAt: -1 })
    .lean();

  if (!suspect.length) {
    console.log('   none found.');
  } else {
    let fixable = 0;
    for (const o of suspect) {
      const snap = o.customer || {};
      const hasSnapshot = !!(snap.name || snap.email || snap.phone);
      const fallbackName = o.shippingAddress?.fullName;
      if (!hasSnapshot && fallbackName) fixable++;

      console.log(
        `   ${String(o.orderNumber).padEnd(10)} ` +
        `prints: ${String(hasSnapshot ? snap.name : o.user?.name).padEnd(20)} ` +
        `${hasSnapshot ? '(own snapshot — correct)' : `(STAFF ACCOUNT${fallbackName ? ` — address says "${fallbackName}"` : ''})`}`
      );
    }
    console.log(`\n   ${suspect.length} manual receipt(s) on a staff account; ` +
      `${fixable} could be corrected from the shipping name already stored.`);
  }

  console.log('\nRead-only. Nothing was changed.');
  await mongoose.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
