require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./src/models/Order');
const { generateReceiptHTML } = require('./src/utils/receiptTemplate');
const fs = require('fs');

async function test() {
    await mongoose.connect(process.env.MONGODB_URI);
    try {
        const order1 = await Order.findOne({ orderNumber: 'Y3PYX201' }).populate('user', 'name email phone');
        if (order1) {
            const html1 = await generateReceiptHTML(order1);
            fs.writeFileSync('Y3PYX201_receipt.html', html1);
            console.log('Saved Y3PYX201 receipt');
        }
        
        const order2 = await Order.findOne({ orderNumber: 'Y09U83UX' }).populate('user', 'name email phone');
        if (order2) {
            const html2 = await generateReceiptHTML(order2);
            fs.writeFileSync('Y09U83UX_receipt.html', html2);
            console.log('Saved Y09U83UX receipt');
        }
    } catch (err) {
        console.error('Error:', err);
    }
    process.exit();
}
test();
