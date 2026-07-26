const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');
const { generateToken } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/error');
const { sendWelcomeEmail, sendOTPEmail } = require('../services/emailService');

// @desc    Sign in with Facebook
// @route   POST /api/auth/facebook
// @access  Public
//
// The client sends the short-lived access token Meta's JS SDK handed it. That
// token is evidence of nothing on its own: anyone can obtain one from any
// Facebook app and post it here. So it is checked against Meta twice —
//
//   1. debug_token, to confirm the token was issued for OUR app and is still
//      valid. Without this check a token minted by an unrelated app would be
//      accepted and could be used to sign in as anyone.
//   2. /me, to read the profile, using the token itself rather than trusting
//      any identity the client claimed in the request body.
//
// Only then is one of our own JWTs issued.
const facebookLogin = asyncHandler(async (req, res) => {
    const { accessToken } = req.body;

    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
        res.status(503);
        throw new Error('Facebook login is not configured on this server');
    }
    if (!accessToken) {
        res.status(400);
        throw new Error('Missing Facebook access token');
    }

    let profile;
    try {
        const debug = await axios.get('https://graph.facebook.com/debug_token', {
            params: {
                input_token: accessToken,
                access_token: `${appId}|${appSecret}`,
            },
            timeout: 8000,
        });

        const info = debug.data?.data;
        if (!info?.is_valid || String(info.app_id) !== String(appId)) {
            res.status(401);
            throw new Error('That Facebook token is not valid for this application');
        }

        const me = await axios.get('https://graph.facebook.com/v21.0/me', {
            params: { fields: 'id,name,email', access_token: accessToken },
            timeout: 8000,
        });
        profile = me.data;
    } catch (err) {
        if (res.statusCode >= 400) throw err;
        res.status(401);
        throw new Error('Could not verify that Facebook account');
    }

    if (!profile?.id) {
        res.status(401);
        throw new Error('Facebook returned no account id');
    }

    // Someone can decline to share their email, and Meta then omits it.
    // A placeholder keeps the unique index satisfied without inventing an
    // address that might belong to a real person.
    const email = profile.email
        ? String(profile.email).toLowerCase()
        : `fb_${profile.id}@facebook.local`;

    let user = await User.findOne({ facebookId: profile.id }).select('+facebookId');

    if (!user) {
        // Link to an existing account when the email already exists, rather
        // than creating a second account for the same person.
        user = await User.findOne({ email });

        if (user) {
            user.facebookId = profile.id;
            await user.save();
        } else {
            user = await User.create({
                name: profile.name || 'Facebook User',
                email,
                facebookId: profile.id,
            });

            sendWelcomeEmail(user).catch(() => { /* welcome mail is optional */ });
        }
    }

    res.json({
        success: true,
        data: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            currency: user.currency,
            language: user.language,
            token: generateToken(user._id),
        },
    });
});

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

        // Send WhatsApp welcome message (async, don't wait)
        try {
            const whatsapp = require('../services/whatsappService');
            whatsapp.sendWelcomeMessage(user).catch(err => console.error('Welcome WhatsApp error:', err));
        } catch (e) {
            console.error('WhatsApp service load error:', e.message);
        }

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

    const user = await User.findOne({ email }).select('+password +revenuePassword');

    if (user && (await user.matchPassword(password))) {
        // Revenue belongs to the owner, not the superuser (the developer
        // account), so it is the owner who is prompted to set the password.
        const needsRevenuePassword = user.role === 'owner' && !user.revenuePassword;

        res.json({
            success: true,
            data: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                currency: user.currency,
                language: user.language,
                needsRevenuePassword, // Flag for frontend to show setup modal
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

    // Generate 6-digit OTP using crypto (secure randomness)
    const otp = crypto.randomInt(100000, 999999).toString();
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

// @desc    Verify password for re-authentication
// @route   POST /api/auth/verify-password
// @access  Private
const verifyPassword = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Verify the user making the request matches the email
    if (req.user.email !== email) {
        res.status(403);
        throw new Error('Unauthorized');
    }

    const user = await User.findById(req.user._id).select('+password');

    if (user && (await user.matchPassword(password))) {
        res.json({
            success: true,
            message: 'Password verified'
        });
    } else {
        res.status(401);
        throw new Error('Incorrect password');
    }
});

module.exports = {
    register,
    login,
    facebookLogin,
    getMe,
    updateProfile,
    addAddress,
    deleteAddress,
    forgotPassword,
    verifyOTP,
    resetPassword,
    verifyPassword
};
