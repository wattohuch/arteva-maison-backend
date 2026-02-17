const { asyncHandler } = require('../middleware/error');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Cart = require('../models/Cart');
const Order = require('../models/Order');

const backupDir = path.join(__dirname, '..', '..', 'backups');

// Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// @desc    List all available backups
// @route   GET /api/admin/backups
// @access  Private/Admin
const listBackups = asyncHandler(async (req, res) => {
    const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('backup-'))
        .map(folder => {
            const infoPath = path.join(backupDir, folder, '_backup-info.json');
            let info = { totalRecords: 0, timestamp: folder };
            
            if (fs.existsSync(infoPath)) {
                info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
            }
            
            return {
                name: folder,
                ...info,
                size: getFolderSize(path.join(backupDir, folder))
            };
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    res.json({
        success: true,
        data: backups
    });
});

// @desc    Download a backup as JSON
// @route   GET /api/admin/backups/:backupName/download
// @access  Private/Admin
const downloadBackup = asyncHandler(async (req, res) => {
    const { backupName } = req.params;
    const backupPath = path.join(backupDir, backupName);

    if (!fs.existsSync(backupPath)) {
        res.status(404);
        throw new Error('Backup not found');
    }

    // Read all backup files
    const backupData = {};
    const files = fs.readdirSync(backupPath).filter(f => f.endsWith('.json'));
    
    files.forEach(file => {
        const filePath = path.join(backupPath, file);
        const collectionName = file.replace('.json', '');
        backupData[collectionName] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${backupName}.json"`);
    res.json({
        success: true,
        backupName,
        data: backupData
    });
});

// @desc    Create a new backup
// @route   POST /api/admin/backups/create
// @access  Private/Admin
const createBackup = asyncHandler(async (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '-' + 
                      new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    const backupFolder = path.join(backupDir, `backup-${timestamp}`);

    // Create backup folder
    fs.mkdirSync(backupFolder, { recursive: true });

    const collections = [
        { name: 'categories', model: Category },
        { name: 'products', model: Product },
        { name: 'users', model: User },
        { name: 'carts', model: Cart },
        { name: 'orders', model: Order }
    ];

    let totalRecords = 0;

    for (const collection of collections) {
        const data = await collection.model.find({}).lean();
        const filePath = path.join(backupFolder, `${collection.name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        totalRecords += data.length;
    }

    // Save backup info
    const backupInfo = {
        timestamp: new Date().toISOString(),
        totalRecords,
        collections: collections.map(c => c.name),
        createdBy: req.user.email
    };

    fs.writeFileSync(
        path.join(backupFolder, '_backup-info.json'),
        JSON.stringify(backupInfo, null, 2)
    );

    res.json({
        success: true,
        message: 'Backup created successfully',
        data: {
            name: `backup-${timestamp}`,
            ...backupInfo
        }
    });
});

// @desc    Restore from a backup
// @route   POST /api/admin/backups/:backupName/restore
// @access  Private/Admin
const restoreBackup = asyncHandler(async (req, res) => {
    const { backupName } = req.params;
    const backupPath = path.join(backupDir, backupName);

    if (!fs.existsSync(backupPath)) {
        res.status(404);
        throw new Error('Backup not found');
    }

    const collections = [
        { name: 'categories', model: Category },
        { name: 'products', model: Product },
        { name: 'users', model: User },
        { name: 'carts', model: Cart },
        { name: 'orders', model: Order }
    ];

    let restoredRecords = 0;

    for (const collection of collections) {
        const filePath = path.join(backupPath, `${collection.name}.json`);

        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            // Clear existing data
            await collection.model.deleteMany({});

            // Insert backup data
            if (data.length > 0) {
                await collection.model.insertMany(data);
            }

            restoredRecords += data.length;
        }
    }

    res.json({
        success: true,
        message: 'Database restored successfully',
        data: {
            backupName,
            restoredRecords
        }
    });
});

// Helper function to get folder size
function getFolderSize(folderPath) {
    let size = 0;
    const files = fs.readdirSync(folderPath);
    
    files.forEach(file => {
        const filePath = path.join(folderPath, file);
        const stats = fs.statSync(filePath);
        size += stats.size;
    });
    
    return formatBytes(size);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

module.exports = {
    listBackups,
    downloadBackup,
    createBackup,
    restoreBackup
};
