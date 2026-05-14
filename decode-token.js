/**
 * Decode JWT Token (no database needed)
 */

const jwt = require('jsonwebtoken');

const TOKEN = process.argv[2];

if (!TOKEN) {
    console.error('Usage: node decode-token.js YOUR_JWT_TOKEN');
    process.exit(1);
}

try {
    // Decode without verification (just to see contents)
    const decoded = jwt.decode(TOKEN);
    
    console.log('📋 TOKEN CONTENTS:');
    console.log(JSON.stringify(decoded, null, 2));
    console.log('');
    console.log('User ID:', decoded.id);
    console.log('Issued:', new Date(decoded.iat * 1000).toLocaleString());
    console.log('Expires:', new Date(decoded.exp * 1000).toLocaleString());
    console.log('');
    console.log('⚠️  This token does NOT contain role information.');
    console.log('    The role is stored in the database, not in the JWT.');
    console.log('');
    console.log('🔑 SOLUTION: Login to your website as admin and get the token:');
    console.log('   1. Go to https://www.artevamaisonkw.com/admin.html');
    console.log('   2. Login with your admin account');
    console.log('   3. Open browser console (F12)');
    console.log('   4. Run: localStorage.getItem("arteva_token")');
    console.log('   5. Copy that token to Raspberry Pi .env file');
    
} catch (error) {
    console.error('❌ Failed to decode token:', error.message);
}
