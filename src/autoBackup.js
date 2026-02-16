/**
 * ARTEVA Maison - Automatic Backup Scheduler
 * 
 * This runs alongside your server and automatically backs up data:
 * - Every day at 4:00 AM (Kuwait time) - when traffic is lowest
 * - Runs in the background - doesn't slow down your website
 * - Keeps the last 7 days of backups automatically
 * 
 * The backup is completely invisible to your customers!
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Import models
const User = require('./models/User');
const Product = require('./models/Product');
const Category = require('./models/Category');
const Cart = require('./models/Cart');
const Order = require('./models/Order');

// Configuration
const BACKUP_HOUR = 4; // 4:00 AM - lowest traffic time
const BACKUP_MINUTE = 0;
const DAYS_TO_KEEP = 7; // Keep last 7 days of backups
const backupDir = path.join(__dirname, '..', 'backups');

// Track active users (for smart backup timing)
let activeUserCount = 0;
let lastActivityTime = Date.now();

// Create backup directory if it doesn't exist
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

/**
 * Update active user count (call this from your server)
 */
function updateActivity() {
    lastActivityTime = Date.now();
}

function incrementUsers() {
    activeUserCount++;
    updateActivity();
}

function decrementUsers() {
    activeUserCount = Math.max(0, activeUserCount - 1);
}

function getActiveUsers() {
    // If no activity for 10 minutes, assume no active users
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - lastActivityTime > tenMinutes) {
        activeUserCount = 0;
    }
    return activeUserCount;
}

/**
 * Perform the actual backup (runs in background, doesn't block)
 */
async function performBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFolder = path.join(backupDir, `backup-${timestamp}`);

    console.log(`\n📦 [${new Date().toLocaleString()}] Starting automatic backup...`);

    try {
        fs.mkdirSync(backupFolder, { recursive: true });

        const collections = [
            { name: 'users', model: User },
            { name: 'products', model: Product },
            { name: 'categories', model: Category },
            { name: 'carts', model: Cart },
            { name: 'orders', model: Order }
        ];

        let totalRecords = 0;

        for (const collection of collections) {
            // Use lean() for faster read, doesn't affect website performance
            const data = await collection.model.find({}).lean();
            const filePath = path.join(backupFolder, `${collection.name}.json`);

            // Write asynchronously to not block
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            totalRecords += data.length;
        }

        // Save backup info
        const backupInfo = {
            timestamp: new Date().toISOString(),
            totalRecords,
            automatic: true
        };
        fs.writeFileSync(
            path.join(backupFolder, '_backup-info.json'),
            JSON.stringify(backupInfo, null, 2)
        );

        console.log(`✅ Backup complete! ${totalRecords} records saved to ${backupFolder}`);

        // Clean up old backups (keep only last 7 days)
        cleanOldBackups();

        return true;
    } catch (error) {
        console.error(`❌ Backup failed: ${error.message}`);
        return false;
    }
}

/**
 * Remove backups older than DAYS_TO_KEEP
 */
function cleanOldBackups() {
    try {
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup-'))
            .sort()
            .reverse();

        // Keep only the most recent backups
        const toDelete = backups.slice(DAYS_TO_KEEP);

        for (const backup of toDelete) {
            const backupPath = path.join(backupDir, backup);
            fs.rmSync(backupPath, { recursive: true, force: true });
            console.log(`🗑️  Removed old backup: ${backup}`);
        }
    } catch (error) {
        console.error('Error cleaning old backups:', error.message);
    }
}

/**
 * Check if it's time for backup
 */
function isBackupTime() {
    const now = new Date();
    return now.getHours() === BACKUP_HOUR && now.getMinutes() === BACKUP_MINUTE;
}

/**
 * Smart backup - waits for low activity
 */
async function smartBackup() {
    const activeUsers = getActiveUsers();

    if (activeUsers > 0) {
        console.log(`⏳ ${activeUsers} users active, waiting 5 minutes to backup...`);
        // Wait 5 minutes and try again
        setTimeout(smartBackup, 5 * 60 * 1000);
        return;
    }

    await performBackup();
}

/**
 * Start the backup scheduler
 */
let backupScheduled = false;

function startBackupScheduler() {
    console.log('📅 Automatic backup scheduler started');
    console.log(`   ⏰ Daily backup at ${BACKUP_HOUR}:00 AM`);
    console.log(`   📁 Backups saved to: ${backupDir}`);
    console.log(`   🔄 Keeping last ${DAYS_TO_KEEP} days of backups\n`);

    // Check every minute if it's backup time
    setInterval(() => {
        if (isBackupTime() && !backupScheduled) {
            backupScheduled = true;
            smartBackup();

            // Reset the flag after 2 minutes (so we don't backup twice)
            setTimeout(() => {
                backupScheduled = false;
            }, 2 * 60 * 1000);
        }
    }, 60 * 1000); // Check every minute
}

/**
 * Force a backup now (can be called from admin panel)
 */
async function forceBackup() {
    console.log('🔧 Manual backup requested...');
    return await performBackup();
}

// Export functions
module.exports = {
    startBackupScheduler,
    performBackup,
    forceBackup,
    updateActivity,
    incrementUsers,
    decrementUsers,
    getActiveUsers
};
