/**
 * Script to make a user an admin
 * Usage: node make-admin.js <email>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

const makeAdmin = async (email) => {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Find user by email
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            console.error(`❌ User not found with email: ${email}`);
            process.exit(1);
        }

        // Check if already admin
        if (user.role === 'admin') {
            console.log(`ℹ️  User ${user.name} (${user.email}) is already an admin`);
            process.exit(0);
        }

        // Update to admin
        user.role = 'admin';
        await user.save();

        console.log(`✅ Successfully made ${user.name} (${user.email}) an admin!`);
        console.log(`\nUser details:`);
        console.log(`- Name: ${user.name}`);
        console.log(`- Email: ${user.email}`);
        console.log(`- Role: ${user.role}`);
        console.log(`- ID: ${user._id}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
};

// Get email from command line
const email = process.argv[2];

if (!email) {
    console.error('❌ Please provide an email address');
    console.log('Usage: node make-admin.js <email>');
    console.log('Example: node make-admin.js user@example.com');
    process.exit(1);
}

makeAdmin(email);
