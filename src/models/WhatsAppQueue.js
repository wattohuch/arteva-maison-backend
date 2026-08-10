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
        // `inbound_forward` = a customer's WhatsApp message relayed to the owners.
        // An unlisted value fails validation, so the row is never written and the
        // send is lost — every type passed to sendMessage() must appear here.
        enum: ['owner_new_order', 'customer_new_order', 'status_update', 'welcome', 'refund_return', 'contact_auto_reply', 'delivery_proof', 'inbound_forward', 'test'],
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
