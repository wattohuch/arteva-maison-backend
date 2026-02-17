/**
 * Script to check orders and their associated users
 */

require('dotenv').config();
const mongoose = require('mongoose');

const checkOrdersUsers = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Load models first
        const User = require('./src/models/User');
        const Order = require('./src/models/Order');
        
        const orders = await Order.find({})
            .populate('user', 'name email')
            .select('orderNumber user shippingAddress createdAt')
            .sort({ createdAt: -1 });

        console.log(`Found ${orders.length} orders:\n`);
        console.log('─'.repeat(80));

        const userIds = new Set();
        const userEmails = new Set();

        orders.forEach((order, index) => {
            console.log(`${index + 1}. Order #${order.orderNumber}`);
            console.log(`   Date: ${order.createdAt.toLocaleDateString()}`);
            
            if (order.user) {
                console.log(`   User: ${order.user.name} (${order.user.email})`);
                console.log(`   User ID: ${order.user._id}`);
                userIds.add(order.user._id.toString());
                userEmails.add(order.user.email);
            } else {
                console.log(`   User: [DELETED OR MISSING]`);
                console.log(`   Shipping: ${order.shippingAddress?.name || 'N/A'}`);
                console.log(`   Email: ${order.shippingAddress?.email || 'N/A'}`);
            }
            console.log('─'.repeat(80));
        });

        console.log(`\n📊 Summary:`);
        console.log(`Total orders: ${orders.length}`);
        console.log(`Unique user IDs in orders: ${userIds.size}`);
        console.log(`Unique emails: ${userEmails.size}`);

        // Check if user IDs exist in users collection
        const existingUsers = await User.find({ _id: { $in: Array.from(userIds) } });
        console.log(`Users still in database: ${existingUsers.length}`);
        console.log(`Users MISSING from database: ${userIds.size - existingUsers.length}`);

        if (userIds.size - existingUsers.length > 0) {
            console.log(`\n⚠️  WARNING: ${userIds.size - existingUsers.length} users referenced in orders are missing from the users collection!`);
            console.log(`This suggests users were deleted.`);
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
};

checkOrdersUsers();
