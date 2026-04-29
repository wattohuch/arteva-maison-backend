/**
 * One-time fix: Repair corrupted category images in the database.
 * "New Arrivals" and "Vases" had their images set to "/assets/images/categories/undefined"
 * by the old buggy editCategory() code. This script restores them.
 * 
 * Run: node fix-category-images.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('ERROR: No MongoDB URI found in .env');
    process.exit(1);
}

const categorySchema = new mongoose.Schema({
    name: String,
    image: String
}, { collection: 'categories', strict: false });

const Category = mongoose.model('CategoryFix', categorySchema);

const fixes = [
    {
        slug: 'new',
        name: 'New Arrivals',
        // Use the same Cloudinary pattern as the other categories
        correctImage: 'https://res.cloudinary.com/dbbwduzfa/image/upload/v1772112205/arteva/products/product-13.jpg'
    },
    {
        slug: 'vases',
        name: 'Vases',
        correctImage: 'https://res.cloudinary.com/dbbwduzfa/image/upload/v1772112184/arteva/products/product-03.jpg'
    }
];

async function fixCategories() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected.\n');

        for (const fix of fixes) {
            const cat = await Category.findOne({ name: fix.name });
            if (!cat) {
                console.log(`⚠ Category "${fix.name}" not found, skipping.`);
                continue;
            }

            console.log(`Found: ${cat.name}`);
            console.log(`  Current image: ${cat.image}`);

            if (cat.image && cat.image.includes('undefined')) {
                cat.image = fix.correctImage;
                await cat.save();
                console.log(`  ✅ Fixed to: ${fix.correctImage}\n`);
            } else {
                console.log(`  ⏭ Image looks OK, skipping.\n`);
            }
        }

        console.log('Done! Disconnecting...');
        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

fixCategories();
