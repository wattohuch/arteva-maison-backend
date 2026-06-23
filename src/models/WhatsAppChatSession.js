const mongoose = require('mongoose');

const whatsappChatSessionSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    lastGreetedAt: {
        type: Date,
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('WhatsAppChatSession', whatsappChatSessionSchema);
