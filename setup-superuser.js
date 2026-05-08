/**
 * Setup Superuser Script
 * Creates or updates a user with superuser role and revenue password
 */

require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const User = require('./src/models/User');
const bcrypt = require('bcryptjs');

const SUPERUSER_EMAIL = 'mohammadalawaji2@gmail.com';
const SUPERUSER_PHONE = '+96550683207';

async function setupSuperuser() {
    try {
        // Connect to database using environment variable with same config as main app
        const mongoUri = process.env.MONGODB_URI;
        
        if (!mongoUri) {
            console.error('❌ MONGODB_URI not found in environment variables');
            console.error('   Please ensure .env file exists with MONGODB_URI configured');
            process.exit(1);
        }

        console.log('🔌 Connecting to MongoDB...');
        console.log(`   URI: ${mongoUri.substring(0, 20)}...`);

        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 10000,
            maxPoolSize: 5,
            minPoolSize: 1,
            socketTimeoutMS: 45000,
            family: 4, // Use IPv4
            maxIdleTimeMS: 30000,
            compressors: 'zlib'
        });
        console.log('✅ Connected to MongoDB');

        // Find user by email
        let user = await User.findOne({ email: SUPERUSER_EMAIL });

        if (!user) {
            console.log('❌ User not found. Please create an account first.');
            process.exit(1);
        }

        console.log(`\n📋 Current user details:`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Name: ${user.name}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Phone: ${user.phone || 'Not set'}`);

        // Update role to superuser
        user.role = 'superuser';
        
        // Update phone if not set
        if (!user.phone) {
            user.phone = SUPERUSER_PHONE;
            console.log(`\n📞 Phone number set to: ${SUPERUSER_PHONE}`);
        }

        // Set revenue password
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const revenuePassword = await new Promise((resolve) => {
            readline.question('\n🔐 Enter revenue password (different from account password): ', (answer) => {
                readline.close();
                resolve(answer);
            });
        });

        if (!revenuePassword || revenuePassword.length < 6) {
            console.log('❌ Revenue password must be at least 6 characters');
            process.exit(1);
        }

        // Hash revenue password
        const salt = await bcrypt.genSalt(10);
        user.revenuePassword = await bcrypt.hash(revenuePassword, salt);

        await user.save();

        console.log('\n✅ Superuser setup completed successfully!');
        console.log('\n📋 Updated user details:');
        console.log(`   Email: ${user.email}`);
        console.log(`   Name: ${user.name}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Phone: ${user.phone}`);
        console.log(`   Revenue Password: Set ✓`);
        console.log('\n⚠️  IMPORTANT: Save your revenue password securely!');
        console.log('   If forgotten, use OTP recovery via email/SMS.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

setupSuperuser();
