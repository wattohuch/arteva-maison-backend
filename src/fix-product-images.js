/**
 * Product Image Reference Fixer
 * Analyzes database vs local files and provides targeted fixes
 * NO SEEDING - Only updates existing products
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

// Available images in local directory
const availableImages = [
    'product-01.png',
    'product-02.png',
    'product-03.png',
    'product-04.png',
    'product-05.png',
    'product-06.png',
    'product-07.png',
    'product-08.png',
    'product-09.png',
    'product-10.png',
    'product-11.png',
    'product-12.png',
    'product-13.png',
    'product-14.png'
];

async function analyzeProductImages() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const products = await Product.find({});
        console.log(`📦 Found ${products.length} products in database\n`);

        const issues = [];
        const fixes = [];

        products.forEach((product, index) => {
            console.log(`\n[${index + 1}] Product: ${product.name}`);
            console.log(`    ID: ${product._id}`);
            
            if (!product.images || product.images.length === 0) {
                console.log(`    ⚠️  No images assigned`);
                issues.push({
                    productId: product._id,
                    productName: product.name,
                    issue: 'No images',
                    currentImages: [],
                    suggestedFix: `Assign product-${String(index + 1).padStart(2, '0')}.png`
                });
            } else {
                product.images.forEach((img, imgIndex) => {
                    const imagePath = img.url || img;
                    const filename = imagePath.split('/').pop();
                    
                    console.log(`    Image ${imgIndex + 1}: ${imagePath}`);
                    
                    // Check if file exists in available images
                    if (!availableImages.includes(filename)) {
                        console.log(`    ❌ File not found: ${filename}`);
                        issues.push({
                            productId: product._id,
                            productName: product.name,
                            issue: 'Image file not found',
                            currentImages: product.images,
                            missingFile: filename,
                            suggestedFix: `Replace with product-${String(index + 1).padStart(2, '0')}.png`
                        });
                    } else {
                        console.log(`    ✅ File exists`);
                    }
                });
            }
        });

        console.log('\n' + '='.repeat(60));
        console.log('📊 ANALYSIS SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total Products: ${products.length}`);
        console.log(`Products with Issues: ${issues.length}`);
        console.log(`Available Images: ${availableImages.length}`);

        if (issues.length > 0) {
            console.log('\n' + '='.repeat(60));
            console.log('🔧 ISSUES FOUND');
            console.log('='.repeat(60));
            
            issues.forEach((issue, index) => {
                console.log(`\n[${index + 1}] ${issue.productName}`);
                console.log(`    Product ID: ${issue.productId}`);
                console.log(`    Issue: ${issue.issue}`);
                if (issue.missingFile) {
                    console.log(`    Missing File: ${issue.missingFile}`);
                }
                console.log(`    Suggested Fix: ${issue.suggestedFix}`);
            });

            console.log('\n' + '='.repeat(60));
            console.log('💡 RECOMMENDED ACTIONS');
            console.log('='.repeat(60));
            console.log('\nOption 1: Auto-fix (assigns sequential images)');
            console.log('  Run: node src/fix-product-images.js --auto-fix');
            console.log('\nOption 2: Manual fix (you choose which image for each product)');
            console.log('  Run: node src/fix-product-images.js --manual');
            console.log('\nOption 3: Generate update script (review before running)');
            console.log('  Run: node src/fix-product-images.js --generate-script');
        } else {
            console.log('\n✅ No issues found! All product images are correctly referenced.');
        }

        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

async function autoFixImages() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const products = await Product.find({});
        let fixedCount = 0;

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const expectedImage = `product-${String(i + 1).padStart(2, '0')}.png`;
            
            // Check if product has missing or incorrect images
            let needsFix = false;
            
            if (!product.images || product.images.length === 0) {
                needsFix = true;
            } else {
                const currentImage = product.images[0].url || product.images[0];
                const currentFilename = currentImage.split('/').pop();
                if (!availableImages.includes(currentFilename)) {
                    needsFix = true;
                }
            }

            if (needsFix) {
                product.images = [{
                    url: `/assets/images/products/${expectedImage}`,
                    isPrimary: true
                }];
                
                await product.save();
                console.log(`✅ Fixed: ${product.name} → ${expectedImage}`);
                fixedCount++;
            }
        }

        console.log(`\n✅ Fixed ${fixedCount} products`);
        await mongoose.disconnect();

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

async function generateUpdateScript() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const products = await Product.find({});
        const updates = [];

        products.forEach((product, index) => {
            let needsUpdate = false;
            
            if (!product.images || product.images.length === 0) {
                needsUpdate = true;
            } else {
                const currentImage = product.images[0].url || product.images[0];
                const currentFilename = currentImage.split('/').pop();
                if (!availableImages.includes(currentFilename)) {
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                const expectedImage = `product-${String(index + 1).padStart(2, '0')}.png`;
                updates.push({
                    productId: product._id.toString(),
                    productName: product.name,
                    newImage: expectedImage
                });
            }
        });

        // Generate MongoDB update script
        const scriptContent = `/**
 * Generated Product Image Update Script
 * Run this in MongoDB shell or via mongosh
 */

// Updates for ${updates.length} products

${updates.map(u => `
// Update: ${u.productName}
db.products.updateOne(
    { _id: ObjectId("${u.productId}") },
    { $set: { images: [{ url: "/assets/images/products/${u.newImage}", isPrimary: true }] } }
);`).join('\n')}

print("✅ Updated ${updates.length} products");
`;

        const fs = require('fs');
        fs.writeFileSync('update-product-images.js', scriptContent);
        
        console.log(`✅ Generated update script: update-product-images.js`);
        console.log(`\nTo apply updates:`);
        console.log(`  mongosh <your-connection-string> update-product-images.js`);

        await mongoose.disconnect();

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Main execution
const args = process.argv.slice(2);

if (args.includes('--auto-fix')) {
    console.log('🔧 AUTO-FIX MODE\n');
    autoFixImages();
} else if (args.includes('--generate-script')) {
    console.log('📝 GENERATE SCRIPT MODE\n');
    generateUpdateScript();
} else {
    console.log('🔍 ANALYSIS MODE\n');
    analyzeProductImages();
}
