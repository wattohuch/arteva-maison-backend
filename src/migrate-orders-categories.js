/**
 * Migration Script: Fix old order items & category images
 * Updates MongoDB records that still reference local paths to use Cloudinary URLs.
 * 
 * Usage: node src/migrate-orders-categories.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');
const { uploadFileToCloudinary } = require('./config/cloudinary');

// Map old local paths to Cloudinary URLs
// This uses the same images that were already uploaded to Cloudinary
async function buildUrlMap() {
    const Product = require('./models/Product');
    const products = await Product.find({});

    const urlMap = {};

    for (const product of products) {
        // Build mapping from old filenames to current Cloudinary URLs
        if (product.images && product.images.length > 0) {
            for (const img of product.images) {
                if (img.url && img.url.includes('cloudinary.com')) {
                    // Extract the product number from the Cloudinary URL
                    const match = img.url.match(/product-(\d+)/);
                    if (match) {
                        const num = match[1];
                        // Map all common old path formats
                        urlMap[`/assets/images/products/product-${num}.png`] = img.url;
                        urlMap[`assets/images/products/product-${num}.png`] = img.url;
                        urlMap[`/assets/images/products/product-${num}.jpg`] = img.url;
                    }
                }
            }
        }
    }

    return urlMap;
}

async function migrateOrderImages(urlMap) {
    const Order = require('./models/Order');
    const orders = await Order.find({});

    console.log(`\n📦 Checking ${orders.length} orders for old image paths...\n`);

    let updated = 0;

    for (const order of orders) {
        let changed = false;

        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                if (item.image && !item.image.includes('cloudinary.com') && urlMap[item.image]) {
                    console.log(`  📝 Order ${order.orderNumber}: "${item.image}" → Cloudinary`);
                    item.image = urlMap[item.image];
                    changed = true;
                }
            }
        }

        if (changed) {
            await order.save();
            updated++;
        }
    }

    console.log(`\n✅ Updated ${updated} orders with Cloudinary image URLs\n`);
}

async function migrateCategoryImages() {
    const Category = require('./models/Category');
    const categories = await Category.find({});

    console.log(`\n🏷️ Checking ${categories.length} categories for images...\n`);

    // Check which categories have images
    const LOCAL_IMAGES_DIR = path.join(__dirname, '../../arteva-maison-frontend/assets/images');

    let updated = 0;

    for (const cat of categories) {
        if (cat.image && !cat.image.includes('cloudinary.com')) {
            // Try to upload from local if file exists
            const localPath = path.join(LOCAL_IMAGES_DIR, cat.image.replace(/^\//, '').replace('assets/images/', ''));

            if (fs.existsSync(localPath)) {
                try {
                    console.log(`  ⬆️ Uploading category "${cat.name}" image: ${localPath}`);
                    const result = await uploadFileToCloudinary(localPath, 'categories', cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-'));
                    cat.image = result.url;
                    await cat.save();
                    updated++;
                    console.log(`  ✅ ${cat.name} → ${result.url}`);
                } catch (err) {
                    console.error(`  ❌ Failed to upload for ${cat.name}:`, err.message);
                }
            } else {
                console.log(`  ⚠️ Category "${cat.name}" has image path "${cat.image}" but local file not found`);
                // Clear the broken path so placeholder shows
                cat.image = '';
                await cat.save();
                updated++;
            }
        } else if (!cat.image) {
            console.log(`  ℹ️ Category "${cat.name}" has no image set (placeholder will show)`);
        } else {
            console.log(`  ✅ Category "${cat.name}" already has Cloudinary URL`);
        }
    }

    console.log(`\n✅ Updated ${updated} categories\n`);
}

async function main() {
    console.log('\n🚀 Starting Order & Category Image Migration...\n');

    await connectDB();

    // Build URL map from existing products (already migrated)
    const urlMap = await buildUrlMap();
    console.log(`📊 Found ${Object.keys(urlMap).length} Cloudinary URL mappings from products\n`);

    // Migrate order item images
    await migrateOrderImages(urlMap);

    // Migrate category images
    await migrateCategoryImages();

    await mongoose.disconnect();
    console.log('🔌 Database disconnected. Migration finished!');
}

main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
});
