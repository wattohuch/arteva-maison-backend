const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'main',
        unique: true
    },
    whatsappNumber: {
        type: String,
        default: '96550683207',
        trim: true
    },
    whatsappDisplay: {
        type: String,
        default: '+965 5068 3207',
        trim: true
    },
    instagramHandle: {
        type: String,
        default: 'arteva.maison',
        trim: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
