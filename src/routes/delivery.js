const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const {
    getAllPilots,
    getPilot,
    createPilot,
    updatePilot,
    assignPilotToOrder,
    updateDeliveryLocation,
    getOrderTracking,
    updateDeliveryStatus,
    getAvailablePilots
} = require('../controllers/deliveryController');

// Public routes
router.get('/track/:orderNumber', getOrderTracking);

// Protected routes (admin)
router.get('/pilots', protect, admin, getAllPilots);
router.get('/pilots/available', protect, admin, getAvailablePilots);
router.get('/pilots/:id', protect, admin, getPilot);
router.post('/pilots', protect, admin, createPilot);
router.put('/pilots/:id', protect, admin, updatePilot);

// Order assignment and status (admin)
router.post('/assign/:orderId', protect, admin, assignPilotToOrder);
router.put('/status/:orderId', protect, updateDeliveryStatus);

// Location update (delivery pilot - could add specific auth)
router.put('/location/:orderId', updateDeliveryLocation);

module.exports = router;
