const express = require('express');
const router = express.Router();
const { sendContactMessage } = require('../controllers/contactController');

// Contact form route (public)
router.post('/', sendContactMessage);

module.exports = router;

