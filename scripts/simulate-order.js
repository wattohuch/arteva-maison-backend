/**
 * Simulate a test order.
 *
 *   node scripts/simulate-order.js
 *
 * Creates an order, sends the WhatsApp notifications and triggers printing —
 * the whole pipeline, end to end, against whatever database MONGODB_URI names.
 *
 * ⚠ Point this at production and it writes a REAL order to the live shop.
 * That is occasionally what you want, which is exactly why the connection
 * string is not written into this file: a credential in source is a credential
 * in the git history, readable by anyone who can clone the repository, forever.
 * Put it in .env, which is gitignored.
 */

require('dotenv').config();

/* Atlas resolves through a SRV record, and on some networks Node's default
   resolver order returns an IPv6 address that then refuses to connect. Forcing
   IPv4 and a known-good public resolver is the workaround. */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI;
const TEST_PHONE = process.env.TEST_PHONE || '96597295917';

async function run() {
    if (!MONGO_URI) {
        console.error('❌ MONGODB_URI is not set. Put it in .env — never in this file.');
        process.exit(1);
    }

    const target = /localhost|127\.0\.0\.1/.test(MONGO_URI) ? 'local' : 'REMOTE';
    console.log(`🔌 Connecting to ${target} MongoDB...`);
    await mongoose.connect(MONGO_URI);
    console.log(`✅ Connected (${target})`);

    const Order = require('../src/models/Order');
    const User = require('../src/models/User');
    const Product = require('../src/models/Product');

    // 1. Find or create a test customer user
    let user = await User.findOne({ phone: TEST_PHONE });
    if (!user) {
        user = await User.findOne({ email: /test/i });
    }
    if (!user) {
        user = await User.findOne({});
    }
    if (!user) {
        user = new User({
            name: 'Simulated Customer',
            email: `customer_${Date.now()}@artevamaisonkw.com`,
            password: 'Password123!',
            phone: TEST_PHONE,
            role: 'user',
            addresses: [{
                label: 'Home',
                street: 'Abdullah Al-Mubarak, Street 14',
                city: 'Abdullah Al-Mubarak',
                state: '2',
                country: 'Kuwait',
                phone: TEST_PHONE,
                coordinates: { lat: 29.2961062, lng: 47.8264474 }
            }]
        });
        await user.save();
        console.log(`👤 Created new test user in Production: ${user.name}`);
    } else {
        console.log(`👤 Found existing user in Production: ${user.name} (${user.email})`);
    }

    // 2. Find driver or admin in production database to assign order to
    let driver = await User.findOne({ role: 'driver' });
    if (!driver) {
        driver = await User.findOne({ role: { $in: ['admin', 'superuser', 'owner'] } });
    }
    console.log(`🚚 Assigning order to Driver: ${driver?.name || 'Unassigned'} (ID: ${driver?._id})`);

    // 3. Find real production catalog products
    let dbProducts = await Product.find({}).limit(10).lean();

    const sampleCatalog = [
        { name: 'Wavy Golden Serving Bowl', price: 28.500, sku: 'SKU-WAV-GOLD-01' },
        { name: 'Sunset Gradient Vase ( Large )', price: 42.000, sku: 'SKU-SUN-VASE-LG' },
        { name: 'Sunset Gradient Vase ( Medium )', price: 34.000, sku: 'SKU-SUN-VASE-MD' },
        { name: 'Sunset Gradient Vase ( Small )', price: 26.500, sku: 'SKU-SUN-VASE-SM' },
        { name: 'Marble Luxe Coaster Set', price: 18.000, sku: 'SKU-MARBLE-CST' },
        { name: 'Artisanal Ceramic Diffuser', price: 22.000, sku: 'SKU-CER-DIFF-01' }
    ];

    let selectedProducts = [];
    if (dbProducts && dbProducts.length >= 4) {
        const shuffled = dbProducts.sort(() => 0.5 - Math.random());
        selectedProducts = shuffled.slice(0, 4).map(p => ({
            _id: p._id,
            name: p.name,
            nameAr: p.nameAr || p.name,
            price: p.price,
            sku: p.sku || p.code || `SKU-${String(p._id).slice(-6).toUpperCase()}`,
            image: p.images?.[0]?.url || ''
        }));
    } else {
        selectedProducts = sampleCatalog.slice(0, 4).map(p => ({
            _id: new mongoose.Types.ObjectId(),
            name: p.name,
            nameAr: p.name,
            price: p.price,
            sku: p.sku,
            image: '/assets/images/placeholder.jpg'
        }));
    }

    console.log(`\n📦 Selected ${selectedProducts.length} items for production order:`);
    selectedProducts.forEach((p, idx) => {
        console.log(`   ${idx + 1}. ${p.name} | SKU: ${p.sku} | ${p.price} KWD`);
    });

    // 4. Build order items
    const items = selectedProducts.map(p => ({
        product: p._id,
        name: p.name,
        nameAr: p.nameAr,
        price: p.price,
        quantity: Math.floor(Math.random() * 2) + 1,
        image: p.image,
        sku: p.sku
    }));

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryFee = 2.0;
    const total = subtotal + deliveryFee;

    const orderNumber = 'TEST-' + Date.now().toString(36).toUpperCase();

    // Kuwaity Pinned Coordinates (Abdullah Al-Mubarak area pin)
    const testLat = 29.2961062;
    const testLng = 47.8264474;

    const order = new Order({
        orderNumber,
        user: user._id,
        deliveryPilot: driver?._id || user._id,
        items,
        shippingAddress: {
            street: 'Abdullah Al-Mubarak, Street 14',
            city: 'Abdullah Al-Mubarak',
            state: '2', // Block 2
            country: 'Kuwait',
            zipCode: '85000',
            phone: TEST_PHONE,
            coordinates: {
                lat: testLat,
                lng: testLng
            }
        },
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        orderStatus: 'out_for_delivery',
        subtotal,
        deliveryFee,
        total,
        currency: 'KWD',
        notes: '🧪 LIVE PRODUCTION TEST ORDER — 4 Items with Pinned GPS Coordinates (29.2961, 47.8264)'
    });

    await order.save();
    console.log(`\n✅ Order Created & Saved to PRODUCTION Atlas Database!`);
    console.log(`   Order Number: #${orderNumber}`);
    console.log(`   Items Count: ${items.length}`);
    console.log(`   Driver Assigned: ${driver?.name || user.name}`);
    console.log(`   GPS Pin Coordinates: (${testLat}, ${testLng})`);
    console.log(`   Total COD: ${total.toFixed(3)} KWD`);

    console.log('\n========================================');
    console.log(`🎉 SUCCESS! Production Test Order #${orderNumber} is now live in Atlas DB!`);
    console.log('========================================');

    await new Promise(r => setTimeout(r, 2000));
    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
