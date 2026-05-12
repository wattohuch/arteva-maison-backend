/**
 * Simulate a Test Order via the LIVE API
 * Usage: node scripts/simulate-order-api.js
 * 
 * Uses the deployed backend API to simulate an order flow.
 */

const BACKEND_URL = 'https://arteva-maison-backend-gy1x.onrender.com/api';

async function run() {
    console.log('🧪 Simulating test order via live API...\n');

    // Step 1: Login as the test user (need credentials)
    // We'll use a direct admin endpoint instead
    
    // First, let's check if the server is up
    console.log('🔌 Checking server status...');
    try {
        const healthRes = await fetch(`${BACKEND_URL}/products?limit=1`);
        const healthData = await healthRes.json();
        if (healthData.success) {
            console.log('✅ Server is online!');
            const product = healthData.data?.[0] || healthData.data?.products?.[0];
            if (product) {
                console.log(`📦 Sample product: ${product.name} (${product.price} KWD)`);
            }
        }
    } catch (e) {
        console.error('❌ Server unreachable:', e.message);
        return;
    }

    console.log('\n========================================');
    console.log('⚠️  To test WhatsApp + Print, you need to:');
    console.log('');
    console.log('1. Go to your website: https://www.artevamaisonkw.com');
    console.log('2. Login with any account');
    console.log('3. Add a product to cart');
    console.log('4. Go to checkout');
    console.log('5. Enter shipping address with phone: +965 97295917');
    console.log('6. Choose COD (Cash on Delivery) payment');
    console.log('7. Place the order');
    console.log('');
    console.log('This triggers:');
    console.log('  📱 WhatsApp notification to owner (you)');
    console.log('  📱 WhatsApp notification to customer (+965 97295917)');
    console.log('  🖨️  Auto-print receipt');
    console.log('  📧 Email confirmation');
    console.log('========================================');
    console.log('');
    console.log('💡 OR use the admin API directly:');
    console.log(`   POST ${BACKEND_URL}/payments/test-order`);
    console.log('   (This endpoint needs to be created on the backend)');
}

run().catch(console.error);
