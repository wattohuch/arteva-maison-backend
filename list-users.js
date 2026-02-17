/**
 * Script to list all users in the database
 * Usage: node list-users.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

const listUsers = async () => {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get all users
        const users = await User.find({}).select('name email role createdAt').sort({ createdAt: -1 });

        if (users.length === 0) {
            console.log('No users found in database');
            process.exit(0);
        }

        console.log(`Found ${users.length} user(s):\n`);
        console.log('─'.repeat(80));

        users.forEach((user, index) => {
            console.log(`${index + 1}. ${user.name}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   Role: ${user.role}`);
            console.log(`   Created: ${user.createdAt.toLocaleDateString()}`);
            console.log(`   ID: ${user._id}`);
            console.log('─'.repeat(80));
        });

        console.log(`\nTo make a user admin, run:`);
        console.log(`node make-admin.js <email>`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
};

listUsers();
