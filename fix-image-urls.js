/**
 * Safe Image URL Fix Script
 * Updates product image URLs from .jpeg/.jpg to .png
 * Does NOT delete any data - only updates image URLs
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./src/models/Product');

async function fixImageUrls() {
    console.log('🔄 Starting safe image URL fix...\n');

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find all products with .jpeg or .jpg in image URLs
        const products = await Product.find({});
        let updatedCount = 0;

        for (const product of products) {
            let needsUpdate = false;

            if (product.images && product.images.length > 0) {
                product.images = product.images.map(img => {
                    if (img.url && (img.url.includes('.jpeg') || img.url.includes('.jpg'))) {
                        const newUrl = img.url.replace(/\.jpe?g$/i, '.png');
                        console.log(`  📝 ${product.name}: ${img.url} → ${newUrl}`);
                        img.url = newUrl;
                        needsUpdate = true;
                    }
                    return img;
                });
            }

            if (needsUpdate) {
                await product.save();
                updatedCount++;
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log(`✅ DONE! Updated ${updatedCount} product(s) out of ${products.length} total`);
        console.log('='.repeat(50) + '\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

fixImageUrls();
