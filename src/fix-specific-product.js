require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function fixFloralVase() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find Floral Cylinder Vase
        const product = await Product.findById('69957383920548df9ee0d2ab');
        
        if (!product) {
            console.log('❌ Product not found');
            process.exit(1);
        }

        console.log(`Found: ${product.name}`);
        console.log(`Current images:`, product.images);

        // Keep only the valid image (product-05.png)
        product.images = [{
            url: '/assets/images/products/product-05.png',
            isPrimary: true
        }];

        await product.save();
        
        console.log(`✅ Fixed! Now has only: product-05.png`);

        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

fixFloralVase();
