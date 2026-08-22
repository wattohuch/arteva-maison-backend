const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'main',
        unique: true
    },
    whatsappNumber: {
        type: String,
        default: '96598048900',
        trim: true
    },
    whatsappDisplay: {
        type: String,
        default: '+965 9804 8900',
        trim: true
    },
    instagramHandle: {
        type: String,
        default: 'arteva.maison',
        trim: true
    },
    whatsappOwnerPhones: {
        type: [String],
        default: ['96565611566', '96551008567']
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
