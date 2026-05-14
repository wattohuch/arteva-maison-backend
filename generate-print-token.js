/**
 * Generate Print Station Token
 * Run this script to generate a fresh admin token for the print station
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function generateToken() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find all admin users
        const adminUsers = await User.find({ 
            role: { $in: ['admin', 'owner', 'superuser'] } 
        }).select('-password');

        if (adminUsers.length === 0) {
            console.error('❌ No admin users found in database!');
            console.log('   Create an admin user first.');
            process.exit(1);
        }

        console.log(`✅ Found ${adminUsers.length} admin user(s):\n`);
        
        adminUsers.forEach((admin, index) => {
            console.log(`${index + 1}. ${admin.name} (${admin.email})`);
            console.log(`   Role: ${admin.role}`);
            console.log(`   ID: ${admin._id}`);
            
            // Generate 20-year token for this admin
            const token = jwt.sign(
                { id: admin._id },
                process.env.JWT_SECRET,
                { expiresIn: '7300d' } // 20 years
            );
            
            console.log(`   Token: ${token}`);
            console.log('');
        });

        console.log('═══════════════════════════════════════════════════════════');
        console.log('🔑 COPY ONE OF THE TOKENS ABOVE');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log('📋 On Raspberry Pi, run:');
        console.log('   nano ~/print-station/.env');
        console.log('');
        console.log('   Update this line:');
        console.log('   API_KEY=<paste_token_here>');
        console.log('');
        console.log('   Save (Ctrl+O, Enter, Ctrl+X)');
        console.log('');
        console.log('   Then test:');
        console.log('   cd ~/print-station');
        console.log('   TEST_MODE=true node print-station.js');
        console.log('');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

generateToken();
