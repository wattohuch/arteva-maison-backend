/**
 * Restore Database from Render Backup
 * This script:
 * 1. Lists backups available on Render server
 * 2. Downloads the selected backup
 * 3. Restores it to your production database
 */

require('dotenv').config();
const https = require('https');
const readline = require('readline');

const BACKEND_URL = 'https://arteva-maison-backend-gy1x.onrender.com';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise(resolve => rl.question(prompt, resolve));
}

async function makeRequest(path, method = 'GET', token) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BACKEND_URL);
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function restoreFromRender() {
    console.log('\n🔄 ARTEVA Maison - Restore from Render Backup\n');

    try {
        // Step 1: Get admin credentials
        console.log('📝 Admin Login Required\n');
        const email = await question('Email: ');
        const password = await question('Password: ');

        console.log('\n🔐 Logging in...');
        const loginRes = await makeRequest('/api/auth/login', 'POST');
        
        // For now, we'll use a simpler approach - you need to get the token manually
        console.log('\n⚠️  To use this script, you need your admin JWT token.');
        console.log('\n📋 How to get your token:');
        console.log('1. Login to admin dashboard at: https://www.artevamaisonkw.com/admin.html');
        console.log('2. Open browser DevTools (F12)');
        console.log('3. Go to Application tab → Local Storage');
        console.log('4. Find "arteva_token" and copy its value\n');

        const token = await question('Paste your admin token here: ');

        if (!token) {
            console.log('\n❌ Token required. Exiting.\n');
            process.exit(1);
        }

        // Step 2: List available backups
        console.log('\n📂 Fetching available backups...');
        const backupsRes = await makeRequest('/api/admin/backups', 'GET', token);

        if (!backupsRes.success || !backupsRes.data || backupsRes.data.length === 0) {
            console.log('\n❌ No backups found on server.');
            console.log('   Backups are created automatically at 4:00 AM daily.');
            console.log('   Or create one manually from admin dashboard.\n');
            process.exit(1);
        }

        console.log('\n📦 Available backups:\n');
        backupsRes.data.forEach((backup, index) => {
            console.log(`   ${index + 1}. ${backup.name}`);
            console.log(`      Records: ${backup.totalRecords || 'Unknown'}`);
            console.log(`      Size: ${backup.size || 'Unknown'}`);
            console.log(`      Date: ${new Date(backup.timestamp).toLocaleString()}`);
            console.log('');
        });

        const choice = await question('Select backup number to restore (or "cancel"): ');

        if (choice.toLowerCase() === 'cancel') {
            console.log('\n❌ Restore cancelled.\n');
            process.exit(0);
        }

        const backupIndex = parseInt(choice) - 1;
        if (isNaN(backupIndex) || backupIndex < 0 || backupIndex >= backupsRes.data.length) {
            console.log('\n❌ Invalid choice.\n');
            process.exit(1);
        }

        const selectedBackup = backupsRes.data[backupIndex];

        console.log(`\n⚠️  WARNING: This will REPLACE all current data with backup data!`);
        console.log(`   Backup: ${selectedBackup.name}`);
        const confirm = await question('\nType "YES" to continue: ');

        if (confirm !== 'YES') {
            console.log('\n❌ Restore cancelled.\n');
            process.exit(0);
        }

        // Step 3: Restore the backup
        console.log('\n🔄 Restoring backup...');
        const restoreRes = await makeRequest(
            `/api/admin/backups/${selectedBackup.name}/restore`,
            'POST',
            token
        );

        if (restoreRes.success) {
            console.log('\n' + '='.repeat(50));
            console.log('✅ RESTORE COMPLETE!');
            console.log('='.repeat(50));
            console.log(`📍 Restored from: ${selectedBackup.name}`);
            console.log(`📊 Records restored: ${restoreRes.data.restoredRecords}`);
            console.log(`⏰ Time: ${new Date().toLocaleString()}`);
            console.log('='.repeat(50) + '\n');
        } else {
            console.log('\n❌ Restore failed:', restoreRes.message);
        }

        rl.close();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        rl.close();
        process.exit(1);
    }
}

restoreFromRender();
