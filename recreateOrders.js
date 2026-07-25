const mongoose = require('mongoose');
const Order = require('./src/models/Order');

const directUri = 'mongodb://sicklxrdfy_db_user:7UkuAQCxq77M3Juu@ac-eyry4gp-shard-00-00.w0s4wst.mongodb.net:27017,ac-eyry4gp-shard-00-01.w0s4wst.mongodb.net:27017,ac-eyry4gp-shard-00-02.w0s4wst.mongodb.net:27017/arteva_maison?replicaSet=atlas-kgzl5h-shard-0&ssl=true&authSource=admin';

async function recreate() {
    await mongoose.connect(directUri);
    console.log('Connected to DB');
    
    const ordersToFix = ['Y09U83UX', 'Y3PYX201'];
    
    for (const oldNum of ordersToFix) {
        const oldOrder = await Order.findOne({ orderNumber: oldNum });
        if (!oldOrder) {
            console.log('Not found:', oldNum);
            continue;
        }
        
        oldOrder.orderStatus = 'confirmed';
        oldOrder.paymentStatus = 'paid';
        oldOrder.paymentMethod = 'knet'; 
        oldOrder.cancelledAt = undefined;
        oldOrder.notes = (oldOrder.notes || '') + '\n[ADMIN] Reactivated and marked as paid manually (Bank Transfer).';
        
        await oldOrder.save();
        console.log('Reactivated order:', oldNum);
    }
    
    process.exit();
}
recreate().catch(console.error);
