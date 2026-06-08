require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./src/models/Order');
const User = require('./src/models/User');
const Product = require('./src/models/Product');

async function seedOrder() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('Connected to DB');

        const user = await User.findOne({});
        if (!user) {
            console.log('No user found');
            process.exit(1);
        }

        const product = await Product.findOne({});
        if (!product) {
            console.log('No product found');
            process.exit(1);
        }

        const newOrder = new Order({
            user: user._id,
            items: [{
                product: product._id,
                name: product.name,
                nameAr: product.nameAr || product.name,
                price: product.price,
                quantity: 1,
                image: product.images && product.images.length > 0 ? product.images[0].url : ''
            }],
            shippingAddress: {
                street: 'Block 1, Street 2, House 3',
                city: 'Farwaniya',
                phone: user.phone || '96512345678',
                coordinates: {
                    lat: 29.2783,
                    lng: 47.9511
                }
            },
            paymentMethod: 'cod',
            paymentStatus: 'pending',
            orderStatus: 'pending',
            subtotal: product.price,
            shippingCost: 2.0,
            total: product.price + 2.0
        });

        // Add initial status history
        newOrder.statusHistory.push({
            status: 'pending',
            note: 'Order placed with COD (Test for Farwaniya)'
        });

        // Trigger the pre-save hook to generate order number
        await newOrder.save();

        console.log(`✅ Order created successfully for Farwaniya! Order Number: ${newOrder.orderNumber}`);
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seedOrder();
