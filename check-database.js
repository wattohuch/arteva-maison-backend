/**
 * Script to check database collections and counts
 */

require('dotenv').config();
const mongoose = require('mongoose');

const checkDatabase = async () => {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB Atlas');
        console.log(`📍 Database: ${mongoose.connection.name}\n`);

        // Get all collections
        const collections = await mongoose.connection.db.listCollections().toArray();
        
        console.log('📊 Collections in database:');
        console.log('─'.repeat(80));

        for (const collection of collections) {
            const count = await mongoose.connection.db.collection(collection.name).countDocuments();
            console.log(`${collection.name}: ${count} documents`);
        }

        console.log('─'.repeat(80));

        // Check users specifically
        const User = require('./src/models/User');
        const users = await User.find({}).select('name email role createdAt');
        
        console.log(`\n👥 Users found: ${users.length}`);
        if (users.length > 0) {
            users.forEach(user => {
                console.log(`  - ${user.name} (${user.email}) - Role: ${user.role}`);
            });
        }

        // Check orders
        const Order = require('./src/models/Order');
        const orders = await Order.find({}).select('orderNumber user createdAt');
        console.log(`\n📦 Orders found: ${orders.length}`);

        // Check products
        const Product = require('./src/models/Product');
        const products = await Product.find({}).select('name');
        console.log(`🛍️  Products found: ${products.length}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
};

checkDatabase();
