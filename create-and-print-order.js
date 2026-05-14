/**
 * Create Order and Print Directly
 * This script creates an order in MongoDB and generates the receipt HTML locally
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./src/models/Order');
const User = require('./src/models/User');
const Product = require('./src/models/Product');
const { generateReceiptHTML } = require('./src/utils/receiptTemplate');
const fs = require('fs');
const path = require('path');

async function createAndPrint() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find test user
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
        }

        // Get products
        const products = await Product.find({ isActive: true }).limit(2);
        if (products.length === 0) {
            console.error('❌ No products found');
            process.exit(1);
        }

        console.log(`📦 Found ${products.length} products`);

        // Create order
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
            orderStatus: 'confirmed'
        });

        // Populate user for receipt
        await order.populate('user', 'name email phone language');

        console.log('✅ Order created!');
        console.log('   Order Number:', order.orderNumber);
        console.log('   Order ID:', order._id.toString());
        console.log('   Total:', `${total.toFixed(3)} KWD`);
        console.log('');

        // Generate receipt HTML
        console.log('📄 Generating receipt HTML...');
        const receiptHTML = generateReceiptHTML(order.toObject());

        // Save to file
        const outputPath = path.join(__dirname, 'test-receipt.html');
        fs.writeFileSync(outputPath, receiptHTML);
        console.log('✅ Receipt saved to:', outputPath);
        console.log('');

        console.log('🖨️  TO PRINT ON RASPBERRY PI:');
        console.log('');
        console.log('1. Copy the receipt file to Raspberry Pi:');
        console.log(`   scp "${outputPath}" pi@printstation:~/test-receipt.html`);
        console.log('');
        console.log('2. On Raspberry Pi, print it:');
        console.log('   chromium --headless --disable-gpu --print-to-pdf=/tmp/receipt.pdf ~/test-receipt.html');
        console.log('   lpr -P hp-smarttank /tmp/receipt.pdf');
        console.log('');
        console.log('OR just place a real order on your website and it will print automatically!');
        console.log('');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

createAndPrint();
