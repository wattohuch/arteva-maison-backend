/**
 * Simulate Order Creation - For Testing Print Station
 * This script creates a real order in the database to test the print station
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./src/models/Order');
const User = require('./src/models/User');
const Product = require('./src/models/Product');

async function simulateOrder() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Find or create a test user
        let testUser = await User.findOne({ email: 'test@artevamaisonkw.com' });
        if (!testUser) {
            console.log('👤 Creating test user...');
            testUser = await User.create({
                name: 'Test Customer',
                email: 'test@artevamaisonkw.com',
                password: 'test123456',
                phone: '+96550000000',
                language: 'en',
                role: 'user'
            });
            console.log('✅ Test user created');
        } else {
            console.log('✅ Found existing test user');
        }

        // Get a real product from database
        const products = await Product.find({ isActive: true }).limit(2);
        if (products.length === 0) {
            console.error('❌ No products found in database. Add products first.');
            process.exit(1);
        }

        console.log(`📦 Found ${products.length} products to use in order`);

        // Create order items
        const orderItems = products.map(product => ({
            product: product._id,
            name: product.name,
            nameAr: product.nameAr || 'منتج تجريبي',
            price: product.price,
            quantity: 1,
            sku: product.sku || 'TEST-SKU',
            image: product.images && product.images.length > 0 ? product.images[0].url : ''
        }));

        const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const shippingCost = 2.000;
        const total = subtotal + shippingCost;

        // Create the order
        console.log('📝 Creating order...');
        const order = await Order.create({
            user: testUser._id,
            orderNumber: `TEST-${Date.now()}`,
            items: orderItems,
            subtotal: subtotal,
            shippingCost: shippingCost,
            total: total,
            currency: 'KWD',
            shippingAddress: {
                fullName: 'Test Customer',
                phone: '+96550000000',
                street: '123 Test Street, Block 5',
                city: 'Kuwait City',
                governorate: 'Capital',
                country: 'Kuwait',
                postalCode: '12345'
            },
            paymentMethod: 'knet',
            paymentStatus: 'paid',
            orderStatus: 'confirmed',
            statusHistory: [
                {
                    status: 'pending',
                    timestamp: new Date(),
                    note: 'Order created (simulated)',
                    updatedBy: testUser._id
                },
                {
                    status: 'confirmed',
                    timestamp: new Date(),
                    note: 'Order confirmed (simulated)',
                    updatedBy: testUser._id
                }
            ]
        });

        console.log('✅ Order created successfully!');
        console.log('');
        console.log('📋 ORDER DETAILS:');
        console.log('   Order Number:', order.orderNumber);
        console.log('   Order ID:', order._id.toString());
        console.log('   Customer:', testUser.name);
        console.log('   Total:', `${total.toFixed(3)} KWD`);
        console.log('   Items:', orderItems.length);
        console.log('   Status:', order.orderStatus);
        console.log('   Payment:', order.paymentStatus);
        console.log('');
        console.log('🖨️  The print station should automatically detect and print this order!');
        console.log('');
        console.log('📍 Check print station logs with:');
        console.log('   sudo journalctl -u print-station -f');
        console.log('');
        console.log('🌐 View receipt at:');
        console.log(`   https://arteva-maison-backend.onrender.com/api/admin/receipt/${order._id}`);
        console.log('');

        // Emit Socket.IO event if possible
        try {
            const io = require('./src/socketHandler').getIO();
            if (io) {
                io.emit('new_order', {
                    orderId: order._id.toString(),
                    orderNumber: order.orderNumber,
                    customer: testUser.name,
                    total: total,
                    timestamp: new Date().toISOString()
                });
                console.log('📡 Socket.IO event emitted');
            }
        } catch (socketErr) {
            console.log('⚠️  Socket.IO not available (server not running)');
            console.log('   Print station will detect order on next poll cycle');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// Run the simulation
simulateOrder();
