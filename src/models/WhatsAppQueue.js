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
        enum: ['owner_new_order', 'customer_new_order', 'status_update', 'welcome', 'refund_return', 'contact_auto_reply', 'delivery_proof', 'test'],
        default: 'test'
    },
    priority: {
        type: Number,
        default: 5,
        min: 1,
        max: 10
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
