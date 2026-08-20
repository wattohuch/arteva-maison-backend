const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide a name'],
        trim: true,
        maxlength: [50, 'Name cannot be more than 50 characters']
    },
    email: {
        type: String,
        required: [true, 'Please provide an email'],
        unique: true,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    password: {
        type: String,
        // New accounts must have one. Existing ones may not: the retired
        // Facebook sign-in created accounts with no password, and re-imposing
        // the requirement on every save would fail validation on an ordinary
        // profile edit and lock those people out of their own account.
        required: [
            function () { return this.isNew; },
            'Please provide a password'
        ],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false
    },
    phone: {
        type: String,
        trim: true
    },
    /**
     * What this account may do.
     *
     *   user       shopper
     *   driver     delivery pilot — the driver app only
     *   cashier    counter staff. May create an invoice and nothing else: no
     *              order history, no revenue, no customers, no settings. The
     *              restriction is enforced on every route (see
     *              middleware/auth.js), not by hiding buttons.
     *   admin      runs the shop day to day
     *   owner      the person who owns the business. The only role revenue is
     *              ever shown to.
     *   superuser  the developer account. Administers everything except the
     *              takings, which are deliberately none of its business.
     */
    role: {
        type: String,
        enum: ['user', 'cashier', 'admin', 'driver', 'owner', 'superuser'],
        default: 'user'
    },
    revenuePassword: {
        type: String,
        select: false
    },
    /**
     * Failed revenue-password attempts, and the time the lockout lifts.
     *
     * The revenue password is a short secret guarding the shop's takings and
     * it sits behind an already-authenticated session, so the ordinary login
     * rate limiter never sees these attempts. Without a counter of its own an
     * open owner session is an offline-speed oracle against it.
     */
    revenueAttempts: {
        type: Number,
        default: 0,
        select: false
    },
    revenueLockedUntil: {
        type: Date,
        default: null,
        select: false
    },
    /**
     * Live refresh-token sessions, one entry per signed-in device.
     *
     * Only the SHA-256 hash of each token is kept, so this array is not a set
     * of usable credentials. `select: false` keeps it off every ordinary user
     * read — it is session bookkeeping, not profile data.
     */
    refreshTokens: {
        type: [{
            jti: { type: String, required: true },
            tokenHash: { type: String, required: true },
            expiresAt: { type: Date, required: true },
            createdAt: { type: Date, default: Date.now },
            userAgent: { type: String, default: '' },
            _id: false
        }],
        default: [],
        select: false
    },
    addresses: [{
        label: { type: String, default: 'Home' },
        street: String,
        city: String,
        state: String,
        country: { type: String, default: 'Kuwait' },
        zipCode: String,
        phone: String,
        coordinates: {
            lat: Number,
            lng: Number
        },
        isDefault: { type: Boolean, default: false }
    }],
    currency: {
        type: String,
        default: 'KWD',
        enum: ['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR', 'USD']
    },
    language: {
        type: String,
        default: 'en',
        enum: ['en', 'ar']
    },
    wishlist: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    resetPasswordOTP: {
        type: String,
        default: null
    },
    resetPasswordOTPExpiry: {
        type: Date,
        default: null
    },
    revenueOTP: {
        type: String,
        default: null
    },
    revenueOTPExpiry: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function () {
    if (!this.isModified('password')) {
        return;
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);

    // Changing the password ends every other session.
    //
    // Without this a password reset — the thing you do precisely because you
    // believe someone else has your credentials — left all their refresh
    // tokens working for another month. `isNew` is excluded because a fresh
    // account has no sessions to drop and assigning here would only add a
    // pointless write.
    if (!this.isNew) {
        this.refreshTokens = [];
    }
});

// Compare password method
userSchema.methods.matchPassword = async function (enteredPassword) {
    // An account with no stored hash has nothing to compare against. bcrypt
    // would throw on an undefined hash; a plain false is the honest answer.
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
