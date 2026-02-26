/**
 * ARTEVA Maison - Fix Owner Role
 * Run: node fix-owner-role.js
 * Sets role='owner' for mohammadalawaji2@gmail.com
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function fixOwnerRole() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to database');

        const User = require('./src/models/User');

        const user = await User.findOne({ email: 'mohammadalawaji2@gmail.com' });

        if (!user) {
            console.error('❌ User with email mohammadalawaji2@gmail.com not found');
            process.exit(1);
        }

        console.log(`Found user: ${user.name} (${user.email})`);
        console.log(`Current role: ${user.role}`);

        if (user.role === 'owner') {
            console.log('✅ Role is already "owner" — no change needed');
        } else {
            user.role = 'owner';
            await user.save();
            console.log('✅ Role updated to "owner" successfully');
        }

        await mongoose.disconnect();
        console.log('Disconnected from database');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

fixOwnerRole();
