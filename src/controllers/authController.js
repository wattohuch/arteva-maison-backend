const crypto = require('crypto');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/error');
const { sendWelcomeEmail, sendOTPEmail } = require('../services/emailService');
const tokens = require('../services/tokenService');

/**
 * The user fields every auth response carries.
 *
 * Centralised so login, register and refresh can never disagree about what the
 * client is told. A mismatch there is how a client ends up holding a stale
 * `role` and rendering UI the API will then refuse.
 */
function publicUser(user, extra = {}) {
    return {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        currency: user.currency,
        language: user.language,
        ...extra,
    };
}

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
        const session = await tokens.issueSession(user, {
            userAgent: req.get('user-agent') || '',
        });

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
            data: publicUser(user, {
                // `token` keeps its historical name: it is the access token,
                // and renaming it would break every client already deployed.
                token: session.accessToken,
                refreshToken: session.refreshToken,
                expiresIn: session.expiresIn,
            })
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

    // `+refreshTokens` so issueSession appends to the real list rather than
    // replacing an undefined one. Without it, signing in on a phone would
    // silently end the session running on the counter machine.
    const user = await User.findOne({ email })
        .select('+password +revenuePassword +refreshTokens');

    if (user && (await user.matchPassword(password))) {
        // Revenue belongs to the owner, not the superuser (the developer
        // account), so it is the owner who is prompted to set the password.
        const needsRevenuePassword = user.role === 'owner' && !user.revenuePassword;

        const session = await tokens.issueSession(user, {
            userAgent: req.get('user-agent') || '',
        });

        res.json({
            success: true,
            data: publicUser(user, {
                needsRevenuePassword, // Flag for frontend to show setup modal
                token: session.accessToken,
                refreshToken: session.refreshToken,
                expiresIn: session.expiresIn,
            })
        });
    } else {
        res.status(401);
        throw new Error('Invalid email or password');
    }
});

// @desc    Exchange a refresh token for a new access token
// @route   POST /api/auth/refresh
// @access  Public (the refresh token is itself the credential)
//
// Deliberately public: the whole point is that it works once the access token
// has expired, so requiring a valid one would make it useless.
//
// Rotation with reuse detection. Spending a refresh token invalidates it and
// issues a replacement in the same write. A token presented twice therefore
// means either a client race it should have serialised, or a stolen token, and
// since the two are indistinguishable from here both are treated as theft:
// every session on the account is dropped.
const refresh = asyncHandler(async (req, res) => {
    const presented = req.body && req.body.refreshToken;

    if (!presented) {
        return res.status(401).json({
            success: false,
            code: 'SESSION_NO_TOKEN',
            message: 'No refresh token supplied.',
        });
    }

    let decoded;
    try {
        decoded = tokens.verifyRefreshToken(presented);
    } catch (err) {
        return res.status(401).json({
            success: false,
            code: err.name === 'TokenExpiredError' ? 'SESSION_EXPIRED' : 'SESSION_INVALID',
            message: 'Your session has ended. Please sign in again.',
        });
    }

    const user = await User.findById(decoded.id).select('+refreshTokens');
    if (!user) {
        return res.status(401).json({
            success: false,
            code: 'SESSION_USER_GONE',
            message: 'Your session has ended. Please sign in again.',
        });
    }

    const presentedHash = tokens.hashRefreshToken(presented);
    const held = (user.refreshTokens || []).find(s => s.jti === decoded.jti);

    // The signature was good but this session is not on the account: it has
    // already been rotated away, or was revoked at logout.
    if (!held || held.tokenHash !== presentedHash) {
        await tokens.revokeAllSessions(user);
        console.warn(
            `[AUTH] Refresh token reuse detected for ${user.email} - all sessions revoked`
        );
        return res.status(401).json({
            success: false,
            code: 'SESSION_INVALID',
            message: 'Your session has ended. Please sign in again.',
        });
    }

    const session = await tokens.issueSession(user, {
        userAgent: req.get('user-agent') || '',
        replaceJti: decoded.jti,
    });

    res.json({
        success: true,
        data: publicUser(user, {
            token: session.accessToken,
            refreshToken: session.refreshToken,
            expiresIn: session.expiresIn,
        }),
    });
});

// @desc    End this session
// @route   POST /api/auth/logout
// @access  Public (an expired access token must still be able to sign out)
//
// Revoking server-side is the point. Without it "log out" only cleared the
// browser's copy while the refresh token stayed valid for another month.
const logout = asyncHandler(async (req, res) => {
    const presented = req.body && req.body.refreshToken;

    // Always 200. Whether the token was still live is not something a caller
    // needs to learn, and a logout that can fail is worse than a redundant one.
    if (!presented) {
        return res.json({ success: true, message: 'Signed out.' });
    }

    try {
        const decoded = tokens.verifyRefreshToken(presented);
        const user = await User.findById(decoded.id).select('+refreshTokens');
        if (user) await tokens.revokeSession(user, decoded.jti);
    } catch {
        // An unreadable token is already useless; there is nothing to revoke.
    }

    res.json({ success: true, message: 'Signed out.' });
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
        // 403, not 401. The caller's session is valid; they simply typed the
        // wrong password into a re-authentication prompt. Answering 401 here
        // made the client discard a perfectly good JWT and sign the admin out.
        res.status(403);
        throw new Error('Incorrect password');
    }
});

module.exports = {
    register,
    login,
    refresh,
    logout,
    getMe,
    updateProfile,
    addAddress,
    deleteAddress,
    forgotPassword,
    verifyOTP,
    resetPassword,
    verifyPassword
};
