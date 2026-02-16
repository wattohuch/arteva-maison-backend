/**
 * ARTEVA Maison - Database Restore Script
 * Restores your data from a backup
 * 
 * HOW TO USE:
 * 1. Open terminal/command prompt
 * 2. Navigate to: cd arteva-maison/backend
 * 3. Run: npm run restore
 * 
 * It will show you available backups to choose from
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Import all models
const User = require('./models/User');
const Product = require('./models/Product');
const Category = require('./models/Category');
const Cart = require('./models/Cart');
const Order = require('./models/Order');

const backupDir = path.join(__dirname, '..', 'backups');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise(resolve => rl.question(prompt, resolve));
}

async function restoreDatabase() {
    console.log('\n🔄 ARTEVA Maison - Database Restore\n');

    try {
        // Check if backups exist
        if (!fs.existsSync(backupDir)) {
            console.log('❌ No backups folder found.');
            console.log('   Run "npm run backup" first to create a backup.\n');
            process.exit(1);
        }

        // List available backups
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup-'))
            .sort()
            .reverse(); // Most recent first

        if (backups.length === 0) {
            console.log('❌ No backups found.');
            console.log('   Run "npm run backup" first to create a backup.\n');
            process.exit(1);
        }

        console.log('Available backups:\n');
        backups.forEach((backup, index) => {
            const infoPath = path.join(backupDir, backup, '_backup-info.json');
            let info = '';
            if (fs.existsSync(infoPath)) {
                const data = JSON.parse(fs.readFileSync(infoPath));
                info = ` (${data.totalRecords} records)`;
            }
            console.log(`   ${index + 1}. ${backup}${info}`);
        });

        const choice = await question('\nEnter backup number to restore (or "cancel"): ');

        if (choice.toLowerCase() === 'cancel') {
            console.log('\n❌ Restore cancelled.\n');
            process.exit(0);
        }

        const backupIndex = parseInt(choice) - 1;
        if (isNaN(backupIndex) || backupIndex < 0 || backupIndex >= backups.length) {
            console.log('\n❌ Invalid choice.\n');
            process.exit(1);
        }

        const selectedBackup = backups[backupIndex];
        const backupPath = path.join(backupDir, selectedBackup);

        console.log(`\n⚠️  WARNING: This will REPLACE all current data with backup data!`);
        const confirm = await question('Type "YES" to continue: ');

        if (confirm !== 'YES') {
            console.log('\n❌ Restore cancelled.\n');
            process.exit(0);
        }

        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('\n✅ Connected to MongoDB\n');

        // Restore each collection
        const collections = [
            { name: 'categories', model: Category },
            { name: 'products', model: Product },
            { name: 'users', model: User },
            { name: 'carts', model: Cart },
            { name: 'orders', model: Order }
        ];

        for (const collection of collections) {
            const filePath = path.join(backupPath, `${collection.name}.json`);

            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath));

                // Clear existing data
                await collection.model.deleteMany({});

                // Insert backup data
                if (data.length > 0) {
                    await collection.model.insertMany(data);
                }

                console.log(`   ✅ ${collection.name}: ${data.length} records restored`);
            } else {
                console.log(`   ⚠️  ${collection.name}: No backup file found`);
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log('✅ RESTORE COMPLETE!');
        console.log('='.repeat(50));
        console.log(`📍 Restored from: ${selectedBackup}`);
        console.log(`⏰ Time: ${new Date().toLocaleString()}`);
        console.log('='.repeat(50) + '\n');

        rl.close();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ RESTORE FAILED:', error.message);
        rl.close();
        process.exit(1);
    }
}

restoreDatabase();
