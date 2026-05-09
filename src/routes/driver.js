const express = require('express');
const router = express.Router();
const { protect, driver } = require('../middleware/auth');
const { getAssignedOrders, updateDeliveryStatus, uploadDeliveryProof } = require('../controllers/driverController');

// All routes are protected and require driver role
router.use(protect);
router.use(driver);

router.get('/orders', getAssignedOrders);
router.put('/orders/:id/status', updateDeliveryStatus);
router.post('/orders/:id/proof', ...uploadDeliveryProof);

module.exports = router;
