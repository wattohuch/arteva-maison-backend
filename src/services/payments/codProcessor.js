/**
 * Cash on Delivery (COD) Payment Processor
 * Handles COD payment logic
 */

module.exports = {
    name: 'Cash on Delivery',
    description: 'Pay with cash when your order is delivered',
    enabled: true,

    /**
     * Process COD payment
     * For COD, we simply mark the order as pending payment
     * Payment is collected on delivery
     */
    async process(order, details = {}) {
        // COD doesn't require immediate payment processing
        // Payment is collected when order is delivered

        return {
            success: true,
            status: 'pending', // Will be marked 'paid' on delivery
            message: 'Order placed successfully. Payment will be collected on delivery.',
            transactionId: null, // No transaction for COD
            paymentMethod: 'cod'
        };
    },

    /**
     * Verify COD payment (called when delivery is completed)
     */
    async verify(data) {
        const { orderId, amountCollected } = data;

        return {
            success: true,
            verified: true,
            amountCollected
        };
    },

    /**
     * COD doesn't support refunds in the traditional sense
     * This would be handled manually
     */
    async refund(order, amount) {
        return {
            success: false,
            message: 'COD orders do not support automatic refunds. Please process manually.'
        };
    }
};
