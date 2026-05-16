const mongoose = require('mongoose');

const whatsappQueueSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending'
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order'
    },
    type: {
        type: String,
        enum: ['owner_new_order', 'customer_new_order', 'status_update', 'test'],
        default: 'test'
    },
    attempts: {
        type: Number,
        default: 0
    },
    errorLog: {
        type: String
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('WhatsAppQueue', whatsappQueueSchema);
