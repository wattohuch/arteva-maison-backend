/**
 * One-time script: Mark all existing paid orders as already printed.
 * Run AFTER deploying the printedAt schema fix.
 * 
 * Usage: node scripts/mark-all-printed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function run() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        family: 4  // Force IPv4 — fixes DNS SRV resolution issues
    });
    console.log('Connected.');

    const Order = require('../src/models/Order');

    const result = await Order.updateMany(
        { paymentStatus: 'paid', printedAt: { $exists: false } },
        { $set: { printedAt: new Date() } }
    );

    console.log(`✅ Marked ${result.modifiedCount} paid orders as printed.`);
    
    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
