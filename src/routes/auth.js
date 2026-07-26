const express = require('express');
const router = express.Router();
const { register, login, getMe, updateProfile, addAddress, deleteAddress, forgotPassword, verifyOTP, resetPassword, verifyPassword } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
    registerRules,
    loginRules,
    forgotPasswordRules,
    verifyOtpRules,
    resetPasswordRules,
    verifyPasswordRules,
    addAddressRules,
} = require('../validators/authValidators');
const { mongoIdParam } = require('../validators/commonValidators');

router.post('/register', validate(registerRules), register);
router.post('/login', validate(loginRules), login);
router.post('/forgot-password', validate(forgotPasswordRules), forgotPassword);
router.post('/verify-otp', validate(verifyOtpRules), verifyOTP);
router.post('/reset-password', validate(resetPasswordRules), resetPassword);
router.post('/verify-password', protect, validate(verifyPasswordRules), verifyPassword);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.post('/addresses', protect, validate(addAddressRules), addAddress);
router.delete('/addresses/:id', protect, validate(mongoIdParam('id')), deleteAddress);

module.exports = router;
