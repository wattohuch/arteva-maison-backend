const BACKEND = 'https://arteva-maison-backend-gy1x.onrender.com/api';

const TOKEN = process.argv[2];

async function run() {
    if (!TOKEN) {
        console.log('Please provide your admin token: node scripts/check-whatsapp-status.js YOUR_TOKEN');
        return;
    }

    try {
        const res = await fetch(`${BACKEND}/admin/whatsapp-status`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            }
        });

        const data = await res.json();
        console.log('\n🔍 WhatsApp Status Result on LIVE Server:');
        console.log(JSON.stringify(data, null, 2));

        if (data.ownerPhones && data.ownerPhones.length === 0) {
            console.log('\n❌ ERROR: ownerPhones array is EMPTY on the live server!');
        } else {
            console.log('\n✅ Owner phones look like they are set:', data.ownerPhones);
        }

    } catch (e) {
        console.error('❌ Network error:', e.message);
    }
}

run();
