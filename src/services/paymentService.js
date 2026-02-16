/**
 * Payment Service - Abstract layer for payment processing
 * Designed for easy integration of future payment gateways
 */

const Order = require('../models/Order');

// Payment processor registry - add new processors here
const processors = {
    cod: require('./payments/codProcessor'),
    // Future processors:
    // card: require('./payments/stripeProcessor'),
    // knet: require('./payments/knetProcessor'),
};

class PaymentService {
    /**
     * Process a payment for an order
     * @param {Object} order - The order document
     * @param {string} method - Payment method (cod, card, knet)
     * @param {Object} paymentDetails - Method-specific payment details
     * @returns {Promise<Object>} Payment result
     */
    static async processPayment(order, method, paymentDetails = {}) {
        const processor = processors[method];

        if (!processor) {
            throw new Error(`Payment method '${method}' is not supported`);
        }

        try {
            const result = await processor.process(order, paymentDetails);

            // Update order payment status based on result
            if (result.success) {
                order.paymentStatus = result.status || 'pending';
                await order.save();
            }

            return result;
        } catch (error) {
            console.error(`Payment processing error for ${method}:`, error);
            throw error;
        }
    }

    /**
     * Verify a payment (for webhook callbacks or status checks)
     * @param {string} method - Payment method
     * @param {Object} verificationData - Method-specific verification data
     * @returns {Promise<Object>} Verification result
     */
    static async verifyPayment(method, verificationData) {
        const processor = processors[method];

        if (!processor || !processor.verify) {
            throw new Error(`Payment verification not supported for '${method}'`);
        }

        return processor.verify(verificationData);
    }

    /**
     * Get available payment methods
     * @returns {Array} List of available payment methods
     */
    static getAvailableMethods() {
        return Object.keys(processors).map(key => ({
            id: key,
            name: processors[key].name,
            description: processors[key].description,
            enabled: processors[key].enabled !== false
        }));
    }

    /**
     * Refund a payment
     * @param {Object} order - The order to refund
     * @param {number} amount - Refund amount (optional, defaults to full refund)
     * @returns {Promise<Object>} Refund result
     */
    static async refundPayment(order, amount = null) {
        const processor = processors[order.paymentMethod];

        if (!processor || !processor.refund) {
            throw new Error(`Refunds not supported for '${order.paymentMethod}'`);
        }

        const refundAmount = amount || order.total;
        const result = await processor.refund(order, refundAmount);

        if (result.success) {
            order.paymentStatus = 'refunded';
            await order.save();
        }

        return result;
    }
}

module.exports = PaymentService;
