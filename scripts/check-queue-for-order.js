const BACKEND = 'https://arteva-maison-backend-gy1x.onrender.com/api';

// Pass the order ID as the 3rd argument:
// node scripts/check-queue-for-order.js YOUR_TOKEN 6a08b179cedf1bbc9e30dfeb
const TOKEN = process.argv[2];
const ORDER_ID = process.argv[3];

async function run() {
    if (!TOKEN || !ORDER_ID) {
        console.log('Usage: node scripts/check-queue-for-order.js YOUR_TOKEN <ORDER_ID>');
        return;
    }

    try {
        // We will call the standard print-queue/whatsapp-queue polling and filter
        // Wait, there's no public endpoint to search WhatsAppQueue by order.
        // We can just query the live DB directly by creating a temporary route!
        console.log('Since there is no public endpoint for querying WhatsAppQueue by order ID, please add this temporary route to your src/routes/admin.js:');
        console.log(`
router.get('/whatsapp-queue/check-order/:orderId', protect, admin, async (req, res) => {
    const WhatsAppQueue = require('../models/WhatsAppQueue');
    const items = await WhatsAppQueue.find({ order: req.params.orderId });
    res.json({ success: true, items });
});
        `);
        console.log('After adding that and pushing to render, run this script again!');
    } catch (e) {
        console.error('Error:', e.message);
    }
}

run();
