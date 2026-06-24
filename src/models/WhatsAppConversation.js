const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'model', 'system'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const whatsappConversationSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    messages: [messageSchema],
    lastMessageAt: {
        type: Date,
        default: Date.now
    },
    lastGreetedAt: {
        type: Date,
        default: Date.now
    },
    isHumanEscalated: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

whatsappConversationSchema.index({ lastMessageAt: 1 }, { expireAfterSeconds: 7200 });

module.exports = mongoose.model('WhatsAppConversation', whatsappConversationSchema);
