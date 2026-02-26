/**
 * Migration Script: Upload local product images to Cloudinary
 * and update MongoDB product records with Cloudinary URLs.
 * 
 * Usage: node src/migrate-images-to-cloudinary.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');
const { uploadFileToCloudinary } = require('./config/cloudinary');

// Local images directory (frontend folder)
const LOCAL_IMAGES_DIR = path.join(__dirname, '../../arteva-maison-frontend/assets/images/products');

async function migrateImages() {
    console.log('\n🚀 Starting Cloudinary Image Migration...\n');

    // Connect to MongoDB
    await connectDB();

    // Get Product model
    const Product = require('./models/Product');

    // Step 1: Upload all local images to Cloudinary
    console.log('📁 Scanning local images directory:', LOCAL_IMAGES_DIR);

    if (!fs.existsSync(LOCAL_IMAGES_DIR)) {
        console.error('❌ Local images directory not found:', LOCAL_IMAGES_DIR);
        process.exit(1);
    }

    const files = fs.readdirSync(LOCAL_IMAGES_DIR).filter(f =>
        /\.(png|jpg|jpeg|webp|gif)$/i.test(f) && f !== 'placeholder.png'
    );

    console.log(`📷 Found ${files.length} images to upload\n`);

    // Upload each image and build a mapping: old path -> cloudinary URL
    const urlMap = {};

    for (const file of files) {
        const filePath = path.join(LOCAL_IMAGES_DIR, file);
        const baseName = path.parse(file).name; // e.g., "product-01"

        try {
            console.log(`  ⬆️  Uploading ${file}...`);
            const result = await uploadFileToCloudinary(filePath, 'products', baseName);

            // Map both common path formats to the Cloudinary URL
            urlMap[`/assets/images/products/${file}`] = result.url;
            urlMap[`assets/images/products/${file}`] = result.url;

            console.log(`  ✅ ${file} → ${result.url}`);
        } catch (error) {
            console.error(`  ❌ Failed to upload ${file}:`, error.message);
        }
    }

    // Also upload placeholder
    const placeholderPath = path.join(LOCAL_IMAGES_DIR, 'placeholder.png');
    if (fs.existsSync(placeholderPath)) {
        try {
            console.log(`\n  ⬆️  Uploading placeholder.png...`);
            const result = await uploadFileToCloudinary(placeholderPath, 'products', 'placeholder');
            urlMap['/assets/images/products/placeholder.png'] = result.url;
            console.log(`  ✅ placeholder.png → ${result.url}`);
        } catch (error) {
            console.error(`  ❌ Failed to upload placeholder:`, error.message);
        }
    }

    console.log(`\n📊 Successfully uploaded ${Object.keys(urlMap).length / 2} images\n`);

    // Step 2: Update all products in MongoDB
    console.log('🔄 Updating product records in MongoDB...\n');

    const products = await Product.find({});
    let updated = 0;

    for (const product of products) {
        let changed = false;

        // Update product.image (legacy single image field)
        if (product.image && urlMap[product.image]) {
            console.log(`  📝 ${product.name}: image "${product.image}" → Cloudinary URL`);
            product.image = urlMap[product.image];
            changed = true;
        }

        // Update product.images array
        if (product.images && product.images.length > 0) {
            for (const img of product.images) {
                if (img.url && urlMap[img.url]) {
                    console.log(`  📝 ${product.name}: images[].url "${img.url}" → Cloudinary URL`);
                    img.url = urlMap[img.url];
                    changed = true;
                }
            }
        }

        if (changed) {
            await product.save();
            updated++;
        }
    }

    console.log(`\n✅ Migration complete! Updated ${updated} of ${products.length} products.\n`);

    // Print summary
    console.log('📋 URL Mapping Summary:');
    const uniqueUrls = {};
    for (const [oldPath, newUrl] of Object.entries(urlMap)) {
        if (oldPath.startsWith('/')) {
            uniqueUrls[oldPath] = newUrl;
        }
    }
    for (const [oldPath, newUrl] of Object.entries(uniqueUrls)) {
        console.log(`  ${oldPath}`);
        console.log(`  → ${newUrl}\n`);
    }

    await mongoose.disconnect();
    console.log('🔌 Database disconnected. Migration finished!');
}

migrateImages().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
});
