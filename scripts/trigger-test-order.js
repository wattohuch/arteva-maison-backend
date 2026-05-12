/**
 * Trigger test order on LIVE server
 * Usage: node scripts/trigger-test-order.js
 * 
 * Requires your admin auth token from localStorage (arteva_token)
 */

const BACKEND = 'https://arteva-maison-backend-gy1x.onrender.com/api';
const TEST_PHONE = '96597295917';

// Get your token: Go to admin dashboard → open DevTools Console → type: localStorage.getItem('arteva_token')
const TOKEN = process.argv[2] || '';

async function run() {
    if (!TOKEN) {
        console.log('========================================');
        console.log('⚠️  AUTH TOKEN REQUIRED');
        console.log('');
        console.log('To get your token:');
        console.log('1. Go to https://www.artevamaisonkw.com/admin.html');
        console.log('2. Open browser DevTools (F12)');
        console.log('3. Go to Console tab');
        console.log('4. Type: localStorage.getItem("arteva_token")');
        console.log('5. Copy the token (without quotes)');
        console.log('6. Run: node scripts/trigger-test-order.js YOUR_TOKEN_HERE');
        console.log('========================================');
        return;
    }

    console.log(`🧪 Triggering test order to +${TEST_PHONE}...`);
    console.log(`📡 Server: ${BACKEND}`);
    
    try {
        const res = await fetch(`${BACKEND}/admin/simulate-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            },
            body: JSON.stringify({ phone: TEST_PHONE })
        });

        const data = await res.json();
        console.log('\n📋 Result:', JSON.stringify(data, null, 2));

        if (data.success) {
            console.log('\n✅ Test order created!');
            console.log(`📦 Order: ${data.data.order}`);
            console.log(`📱 WhatsApp Owner: ${data.data.whatsappOwner ? '✅' : '❌'}`);
            console.log(`📱 WhatsApp Customer: ${data.data.whatsappCustomer ? '✅' : '❌'}`);
            console.log(`🖨️  Print: ${data.data.print ? '✅' : '❌'}`);
            if (data.data.whatsappError) console.log(`⚠️ WhatsApp Error: ${data.data.whatsappError}`);
            if (data.data.printError) console.log(`⚠️ Print Error: ${data.data.printError}`);
        } else {
            console.log('❌ Failed:', data.message);
        }
    } catch (e) {
        console.error('❌ Network error:', e.message);
    }
}

run();
