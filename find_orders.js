const mongoose = require('mongoose');

async function run() {
    try {
        await mongoose.connect('mongodb+srv://sicklxrdfy_db_user:7UkuAQCxq77M3Juu@clusterarteva.w0s4wst.mongodb.net/arteva_maison?appName=ClusterArteva');
        const Order = require('./src/models/Order');
        
        const count = await Order.countDocuments({ 
            $or: [
                { orderStatus: { $in: ['pending', 'cancelled'] } },
                { paymentStatus: { $in: ['pending', 'cancelled'] } }
            ]
        });
        
        console.log('Total Pending/Cancelled Orders found:', count);
        
        // Uncomment to delete
        // const result = await Order.deleteMany({
        //     $or: [
        //         { orderStatus: { $in: ['pending', 'cancelled'] } },
        //         { paymentStatus: { $in: ['pending', 'cancelled'] } }
        //     ]
        // });
        // console.log('Deleted:', result.deletedCount);
        
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.connection.close();
    }
}

run();
