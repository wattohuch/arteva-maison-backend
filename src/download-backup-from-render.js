/**
 * Download Backup from Render Server
 * Since Render free tier doesn't have Shell access, we'll create an API endpoint
 * to download backups
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const BACKEND_URL = process.env.FRONTEND_URL.replace('www.artevamaisonkw.com', 'arteva-maison-backend-gy1x.onrender.com');

async function downloadBackup() {
    console.log('📥 Downloading backup from Render server...\n');
    console.log('⚠️  NOTE: This requires an API endpoint on the server.');
    console.log('   We need to add a backup download endpoint first.\n');
    
    console.log('Alternative: Check if backups exist locally first...\n');
    
    const localBackupDir = path.join(__dirname, '..', 'backups');
    
    if (fs.existsSync(localBackupDir)) {
        const backups = fs.readdirSync(localBackupDir)
            .filter(f => f.startsWith('backup-'))
            .sort()
            .reverse();
        
        if (backups.length > 0) {
            console.log('✅ Found local backups:');
            backups.forEach((backup, i) => {
                console.log(`   ${i + 1}. ${backup}`);
            });
            console.log('\nYou can restore from these using: node src/restore.js\n');
            return;
        }
    }
    
    console.log('❌ No local backups found.');
    console.log('\n📋 Next steps:');
    console.log('1. We need to add a backup download API endpoint');
    console.log('2. Or manually create a backup before the seed was run');
    console.log('3. Or accept that users need to re-register\n');
}

downloadBackup();
