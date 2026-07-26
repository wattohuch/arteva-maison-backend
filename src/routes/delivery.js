const express = require('express');
const router = express.Router();
const { protect, admin, driver } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
    orderIdParam,
    orderNumberParam,
    updateLocationRules,
    updateStatusRules,
} = require('../validators/deliveryValidators');
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
router.get('/track/:orderNumber', validate(orderNumberParam), getOrderTracking);

// Protected routes (admin)
router.get('/pilots', protect, admin, getAllPilots);
router.get('/pilots/available', protect, admin, getAvailablePilots);
router.get('/pilots/:id', protect, admin, getPilot);
router.post('/pilots', protect, admin, createPilot);
router.put('/pilots/:id', protect, admin, updatePilot);

// Order assignment and status
router.post('/assign/:orderId', protect, admin, validate(orderIdParam), assignPilotToOrder);

/*
 * Both handlers below move a real order along the delivery workflow, and
 * `delivered` additionally marks a COD order PAID. They were reachable by any
 * signed-in customer (status) and by anyone at all (location) — a shopper
 * could mark their own cash order paid and delivered without paying, and an
 * anonymous caller could write GPS coordinates onto any order and broadcast a
 * fake live position to the customer's tracking page over the socket.
 *
 * Now restricted to drivers and staff, which is what the route comments always
 * claimed. Nothing in either frontend or the Pi agents calls these — the driver
 * app uses /api/driver/orders/:id/status — so tightening them breaks no caller.
 */
router.put('/status/:orderId', protect, driver, validate(updateStatusRules), updateDeliveryStatus);
router.put('/location/:orderId', protect, driver, validate(updateLocationRules), updateDeliveryLocation);

module.exports = router;
