/**
 * Simulate a Test Order
 * Usage: node scripts/simulate-order.js
 * 
 * Creates a test order, sends WhatsApp notifications, and triggers printing.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI;
const TEST_PHONE = '96597295917';

async function run() {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const Order = require('../src/models/Order');
    const User = require('../src/models/User');
    const Product = require('../src/models/Product');

    // Find a real product to use
    const product = await Product.findOne({ isActive: true }).lean();
    if (!product) {
        console.error('❌ No active products found in DB');
        process.exit(1);
    }
    console.log(`📦 Using product: ${product.name} (${product.price} KWD)`);

    // Find or create test user
    let user = await User.findOne({ phone: TEST_PHONE });
    if (!user) {
        user = await User.findOne({ email: { $regex: /test/i } });
    }
    if (!user) {
        // Use the first admin/superuser
        user = await User.findOne({ role: { $in: ['admin', 'superuser', 'owner'] } });
    }
    if (!user) {
        console.error('❌ No user found. Create a test user first.');
        process.exit(1);
    }

    // Override phone for this test
    const testUser = {
        _id: user._id,
        name: user.name || 'Test Customer',
        email: user.email,
        phone: TEST_PHONE,
        language: 'en'
    };

    console.log(`👤 User: ${testUser.name} (${testUser.email})`);

    // Create test order
    const orderNumber = 'TEST-' + Date.now().toString(36).toUpperCase();
    const order = new Order({
        orderNumber,
        user: user._id,
        items: [{
            product: product._id,
            name: product.name,
            nameAr: product.nameAr || product.name,
            price: product.price,
            quantity: 1,
            image: product.images?.[0]?.url || ''
        }],
        shippingAddress: {
            street: 'Test Street 123',
            city: 'Kuwait City',
            state: 'Al Asimah',
            country: 'Kuwait',
            zipCode: '12345',
            phone: TEST_PHONE
        },
        paymentMethod: 'card',
        paymentStatus: 'paid',
        orderStatus: 'confirmed',
        subtotal: product.price,
        deliveryFee: 2.0,
        total: product.price + 2.0,
        currency: 'KWD',
        notes: '🧪 TEST ORDER — Delete after testing'
    });

    await order.save();
    console.log(`\n✅ Order created: #${orderNumber}`);
    console.log(`💰 Total: ${order.total} KWD`);

    // Send WhatsApp notifications
    console.log('\n📱 Sending WhatsApp notifications...');
    try {
        const whatsapp = require('../src/services/whatsappService');

        // Wait for WhatsApp to connect
        console.log('⏳ Waiting for WhatsApp connection (5s)...');
        await new Promise(r => setTimeout(r, 5000));

        if (whatsapp.isConnected) {
            console.log('✅ WhatsApp connected!');

            // Notify owner
            const ownerResult = await whatsapp.notifyOwnerPaymentReceived(order, testUser);
            console.log('  Owner notification:', ownerResult.success ? '✅ Sent' : `❌ ${ownerResult.error}`);

            // Notify customer
            const custResult = await whatsapp.notifyCustomerNewOrder(order, testUser);
            console.log('  Customer notification:', custResult.success ? '✅ Sent' : `❌ ${custResult.error}`);
        } else {
            console.log('⚠️ WhatsApp NOT connected. Pairing code needed — check server logs.');
        }
    } catch (err) {
        console.error('❌ WhatsApp error:', err.message);
    }

    // Trigger print
    console.log('\n🖨️ Triggering print...');
    try {
        const { autoPrintReceipt } = require('../src/services/printService');
        const printResult = await autoPrintReceipt(order._id);
        console.log('  Print result:', printResult?.success ? '✅ Sent to printer' : `❌ ${printResult?.error || 'Unknown error'}`);
    } catch (err) {
        console.error('❌ Print error:', err.message);
    }

    console.log('\n========================================');
    console.log(`🧪 TEST ORDER: #${orderNumber}`);
    console.log(`📞 WhatsApp to: +${TEST_PHONE}`);
    console.log(`💰 Total: ${order.total} KWD`);
    console.log('========================================');
    console.log('\n⚠️ Remember to delete this test order from admin panel!');

    // Give time for async operations
    await new Promise(r => setTimeout(r, 3000));
    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
