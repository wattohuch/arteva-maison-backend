const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getAdminProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    getAdminOrders,
    updateOrderStatus,
    assignDriver,
    getAdminUsers,
    updateUserRole,
    deleteUser,
    sendOfferEmail
} = require('../controllers/adminController');
const { protect, admin } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Stats
router.get('/stats', protect, admin, getDashboardStats);

// Products
router.route('/products')
    .get(protect, admin, getAdminProducts)
    .post(protect, admin, upload.array('images', 5), createProduct);

router.route('/products/:id')
    .put(protect, admin, upload.array('images', 5), updateProduct)
    .delete(protect, admin, deleteProduct);

// Orders
router.get('/orders', protect, admin, getAdminOrders);
router.put('/orders/:id/status', protect, admin, updateOrderStatus);
router.put('/orders/:id/assign', protect, admin, assignDriver);

// Users
router.route('/users')
    .get(protect, admin, getAdminUsers);

router.route('/users/:id')
    .put(protect, admin, updateUserRole)
    .delete(protect, admin, deleteUser);

// Email
router.post('/send-email', protect, admin, sendOfferEmail);

// Backup management
const { listBackups, downloadBackup, createBackup, restoreBackup } = require('../controllers/backupController');
router.get('/backups', protect, admin, listBackups);
router.get('/backups/:backupName/download', protect, admin, downloadBackup);
router.post('/backups/create', protect, admin, createBackup);
router.post('/backups/:backupName/restore', protect, admin, restoreBackup);

module.exports = router;
