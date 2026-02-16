const User = require('../models/User');
const { generateToken } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/error');
const { sendWelcomeEmail, sendOTPEmail } = require('../services/emailService');

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
    const { name, email, password, phone } = req.body;

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
        res.status(400);
        throw new Error('User already exists');
    }

    const user = await User.create({ name, email, password, phone });

    if (user) {
        // Send welcome email (async, don't wait)
        sendWelcomeEmail(user).catch(err => console.error('Welcome email error:', err));

        res.status(201).json({
            success: true,
            data: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                language: user.language,
                token: generateToken(user._id)
            }
        });
    } else {
        res.status(400);
        throw new Error('Invalid user data');
    }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');

    if (user && (await user.matchPassword(password))) {
        res.json({
            success: true,
            data: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                name: user.name,
                email: user.email,
                role: user.role,
                currency: user.currency,
                language: user.language,
                token: generateToken(user._id)
            }
        });
    } else {
        res.status(401);
        throw new Error('Invalid email or password');
    }
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    res.json({
        success: true,
        data: user
    });
});

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (user) {
        user.name = req.body.name || user.name;
        user.email = req.body.email || user.email;
        user.phone = req.body.phone || user.phone;

        if (req.body.password) {
            user.password = req.body.password;
        }

        if (req.body.currency) {
            user.currency = req.body.currency;
        }

        if (req.body.language) {
            user.language = req.body.language;
        }

        const updatedUser = await user.save();

        res.json({
            success: true,
            data: {
                _id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                currency: updatedUser.currency,
                language: updatedUser.language
            }
        });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Add address to user
// @route   POST /api/auth/addresses
// @access  Private
const addAddress = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (user) {
        const { label, street, city, state, country, zipCode, phone, isDefault, coordinates } = req.body;

        // If this is default, unset other defaults
        if (isDefault) {
            user.addresses.forEach(addr => addr.isDefault = false);
        }

        user.addresses.push({ label, street, city, state, country, zipCode, phone, isDefault, coordinates });
        await user.save();

        res.status(201).json({
            success: true,
            data: user.addresses
        });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Delete address
// @route   DELETE /api/auth/addresses/:id
// @access  Private
const deleteAddress = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (user) {
        user.addresses = user.addresses.filter(addr => addr._id.toString() !== req.params.id);
        await user.save();

        res.json({
            success: true,
            data: user.addresses
        });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Request password reset OTP
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
        // Don't reveal if user exists for security
        return res.json({
            success: true,
            message: 'If an account exists with this email, an OTP has been sent.'
        });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.resetPasswordOTP = otp;
    user.resetPasswordOTPExpiry = otpExpiry;
    await user.save();

    // Send OTP email
    await sendOTPEmail(user, otp).catch(err => console.error('OTP email error:', err));

    res.json({
        success: true,
        message: 'If an account exists with this email, an OTP has been sent.'
    });
});

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOTP = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });

    if (!user || !user.resetPasswordOTP || !user.resetPasswordOTPExpiry) {
        res.status(400);
        throw new Error('Invalid or expired OTP');
    }

    if (user.resetPasswordOTP !== otp) {
        res.status(400);
        throw new Error('Invalid OTP');
    }

    if (new Date() > user.resetPasswordOTPExpiry) {
        res.status(400);
        throw new Error('OTP has expired. Please request a new one.');
    }

    res.json({
        success: true,
        message: 'OTP verified successfully'
    });
});

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({ email }).select('+password');

    if (!user || !user.resetPasswordOTP || !user.resetPasswordOTPExpiry) {
        res.status(400);
        throw new Error('Invalid or expired OTP');
    }

    if (user.resetPasswordOTP !== otp) {
        res.status(400);
        throw new Error('Invalid OTP');
    }

    if (new Date() > user.resetPasswordOTPExpiry) {
        res.status(400);
        throw new Error('OTP has expired. Please request a new one.');
    }

    // Update password
    user.password = newPassword;
    user.resetPasswordOTP = null;
    user.resetPasswordOTPExpiry = null;
    await user.save();

    res.json({
        success: true,
        message: 'Password reset successfully'
    });
});

module.exports = {
    register,
    login,
    getMe,
    updateProfile,
    addAddress,
    deleteAddress,
    forgotPassword,
    verifyOTP,
    resetPassword
};
