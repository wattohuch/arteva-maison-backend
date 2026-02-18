/**
 * Restore products and categories from local backup
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Product = require('./src/models/Product');
const Category = require('./src/models/Category');

// Backup paths
const PRODUCTS_BACKUP = 'C:\\Users\\walso\\OneDrive\\Documents\\files\\arteva-maison\\backend\\backups\\backup-2026-02-03T01-00-18\\products.json';
const CATEGORIES_BACKUP = 'C:\\Users\\walso\\OneDrive\\Documents\\files\\arteva-maison\\backend\\backups\\backup-2026-02-03T01-00-18\\categories.json';

async function restoreFromBackup() {
    try {
        console.log('\n🔄 Restoring products and categories from local backup...\n');

        // Connect to production database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB Atlas (Production)\n');

        // Check if backup files exist
        if (!fs.existsSync(PRODUCTS_BACKUP)) {
            console.error('❌ Products backup not found:', PRODUCTS_BACKUP);
            process.exit(1);
        }

        if (!fs.existsSync(CATEGORIES_BACKUP)) {
            console.error('❌ Categories backup not found:', CATEGORIES_BACKUP);
            process.exit(1);
        }

        // Read backup files
        console.log('📂 Reading backup files...');
        const productsData = JSON.parse(fs.readFileSync(PRODUCTS_BACKUP, 'utf8'));
        const categoriesData = JSON.parse(fs.readFileSync(CATEGORIES_BACKUP, 'utf8'));

        console.log(`   Found ${productsData.length} products`);
        console.log(`   Found ${categoriesData.length} categories\n`);

        // Restore categories first
        console.log('🗂️  Restoring categories...');
        await Category.deleteMany({});
        await Category.insertMany(categoriesData);
        console.log(`✅ Restored ${categoriesData.length} categories\n`);

        // Restore products
        console.log('📦 Restoring products...');
        await Product.deleteMany({});
        await Product.insertMany(productsData);
        console.log(`✅ Restored ${productsData.length} products\n`);

        console.log('='.repeat(50));
        console.log('✅ RESTORE COMPLETE!');
        console.log('='.repeat(50));
        console.log(`📊 Summary:`);
        console.log(`   Categories: ${categoriesData.length}`);
        console.log(`   Products: ${productsData.length}`);
        console.log(`   Backup date: 2026-02-03`);
        console.log('='.repeat(50) + '\n');

        console.log('📝 Note: Product images reference the same filenames.');
        console.log('   Make sure the images in your local folder match the backup.\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Restore failed:', error.message);
        console.error(error);
        process.exit(1);
    }
}

restoreFromBackup();
