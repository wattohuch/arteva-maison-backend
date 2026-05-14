/**
 * Check JWT Token and Generate Admin Token
 * This script checks what user/role a JWT token belongs to
 * and generates a new admin token if needed
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('./src/models/User');

const TOKEN_TO_CHECK = process.argv[2];

async function checkAndGenerate() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        if (!TOKEN_TO_CHECK) {
            console.error('❌ No token provided!');
            console.log('Usage: node check-token-and-generate.js YOUR_JWT_TOKEN');
            process.exit(1);
        }

        // Decode and verify the token
        console.log('🔍 Checking token...\n');
        let decoded;
        try {
            decoded = jwt.verify(TOKEN_TO_CHECK, process.env.JWT_SECRET);
            console.log('✅ Token is valid');
            console.log('   User ID:', decoded.id);
            console.log('   Issued:', new Date(decoded.iat * 1000).toLocaleString());
            console.log('   Expires:', new Date(decoded.exp * 1000).toLocaleString());
        } catch (err) {
            console.error('❌ Token is invalid or expired:', err.message);
            process.exit(1);
        }

        // Get user details
        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            console.error('❌ User not found in database!');
            process.exit(1);
        }

        console.log('\n👤 USER DETAILS:');
        console.log('   Name:', user.name);
        console.log('   Email:', user.email);
        console.log('   Role:', user.role);
        console.log('   Phone:', user.phone || 'N/A');

        // Check if user has admin privileges
        const hasAdminAccess = ['admin', 'owner', 'superuser'].includes(user.role);
        
        if (hasAdminAccess) {
            console.log('\n✅ This user HAS admin access!');
            console.log('   The token should work for the print station.');
            console.log('\n🔑 Use this token in your Raspberry Pi .env file:');
            console.log(`   API_KEY=${TOKEN_TO_CHECK}`);
        } else {
            console.log('\n❌ This user DOES NOT have admin access!');
            console.log(`   Current role: ${user.role}`);
            console.log('   Required role: admin, owner, or superuser');
            
            // Find an admin user
            console.log('\n🔍 Looking for admin users...');
            const adminUsers = await User.find({ 
                role: { $in: ['admin', 'owner', 'superuser'] } 
            }).select('-password').limit(5);

            if (adminUsers.length === 0) {
                console.log('❌ No admin users found in database!');
                console.log('   You need to create an admin user first.');
            } else {
                console.log(`✅ Found ${adminUsers.length} admin user(s):\n`);
                
                adminUsers.forEach((admin, index) => {
                    console.log(`${index + 1}. ${admin.name} (${admin.email})`);
                    console.log(`   Role: ${admin.role}`);
                    console.log(`   ID: ${admin._id}`);
                    
                    // Generate token for this admin
                    const adminToken = jwt.sign(
                        { id: admin._id },
                        process.env.JWT_SECRET,
                        { expiresIn: '7300d' } // 20 years
                    );
                    
                    console.log(`   Token: ${adminToken}`);
                    console.log('');
                });

                console.log('🔑 Copy one of the tokens above to your Raspberry Pi .env file:');
                console.log('   API_KEY=<paste_token_here>');
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

checkAndGenerate();
