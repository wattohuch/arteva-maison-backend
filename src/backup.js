/**
 * ARTEVA Maison - Database Backup Script
 * Saves all your data to your computer
 * 
 * HOW TO USE:
 * 1. Open terminal/command prompt
 * 2. Navigate to: cd arteva-maison/backend
 * 3. Run: npm run backup
 * 
 * Your data will be saved to: backend/backups/
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Import all models
const User = require('./models/User');
const Product = require('./models/Product');
const Category = require('./models/Category');
const Cart = require('./models/Cart');
const Order = require('./models/Order');

// Create backup folder
const backupDir = path.join(__dirname, '..', 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

async function backupDatabase() {
    console.log('🔄 Starting database backup...\n');

    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Create timestamp for this backup
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupFolder = path.join(backupDir, `backup-${timestamp}`);
        fs.mkdirSync(backupFolder, { recursive: true });

        // Backup each collection
        const collections = [
            { name: 'users', model: User },
            { name: 'products', model: Product },
            { name: 'categories', model: Category },
            { name: 'carts', model: Cart },
            { name: 'orders', model: Order }
        ];

        let totalRecords = 0;

        for (const collection of collections) {
            const data = await collection.model.find({}).lean();
            const filePath = path.join(backupFolder, `${collection.name}.json`);

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

            console.log(`   📁 ${collection.name}: ${data.length} records saved`);
            totalRecords += data.length;
        }

        // Create backup info file
        const backupInfo = {
            timestamp: new Date().toISOString(),
            totalRecords,
            collections: collections.map(c => c.name),
            mongodbUri: process.env.MONGODB_URI.replace(/\/\/.*:.*@/, '//<hidden>@') // Hide password
        };

        fs.writeFileSync(
            path.join(backupFolder, '_backup-info.json'),
            JSON.stringify(backupInfo, null, 2)
        );

        console.log('\n' + '='.repeat(50));
        console.log('✅ BACKUP COMPLETE!');
        console.log('='.repeat(50));
        console.log(`📍 Location: ${backupFolder}`);
        console.log(`📊 Total records: ${totalRecords}`);
        console.log(`⏰ Time: ${new Date().toLocaleString()}`);
        console.log('='.repeat(50) + '\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ BACKUP FAILED:', error.message);
        console.error('\nMake sure:');
        console.error('1. Your MongoDB URI in .env is correct');
        console.error('2. You have internet connection');
        console.error('3. MongoDB Atlas is accessible\n');
        process.exit(1);
    }
}

backupDatabase();
