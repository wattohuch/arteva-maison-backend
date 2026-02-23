/**
 * MyFatoorah Payment Gateway Integration
 * Supports: KNET, Credit Cards, Apple Pay
 * Documentation: https://myfatoorah.readme.io/docs
 */

const axios = require('axios');

class MyFatoorahService {
    constructor() {
        this.apiKey = process.env.MYFATOORAH_API_KEY;
        this.baseUrl = process.env.MYFATOORAH_MODE === 'live'
            ? 'https://api.myfatoorah.com'
            : 'https://apitest.myfatoorah.com';

        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };

        // Request timeout (10 seconds)
        this.timeout = 10000;
    }

    /**
     * Initialize payment - creates invoice and returns payment URL
     */
    async initiatePayment(orderData) {
        try {
            const payload = {
                CustomerName: orderData.customerName,
                InvoiceValue: orderData.amount,
                DisplayCurrencyIso: orderData.currency || 'KWD',
                CustomerEmail: orderData.customerEmail,
                CustomerMobile: orderData.customerPhone,
                CallBackUrl: `${process.env.FRONTEND_URL}/order-success`,
                ErrorUrl: `${process.env.FRONTEND_URL}/checkout?error=payment_failed`,
                Language: orderData.language || 'en',
                CustomerReference: orderData.orderNumber,
                UserDefinedField: orderData.orderId, // Store order ID for webhook
                InvoiceItems: orderData.items.map(item => ({
                    ItemName: item.name,
                    Quantity: item.quantity,
                    UnitPrice: item.price
                })),
                // Enable payment methods
                MobileCountryCode: '+965' // Kuwait
            };

            const response = await axios.post(
                `${this.baseUrl}/v2/SendPayment`,
                payload,
                { headers: this.headers, timeout: this.timeout }
            );

            if (response.data.IsSuccess) {
                return {
                    success: true,
                    paymentUrl: response.data.Data.PaymentURL,
                    invoiceId: response.data.Data.InvoiceId,
                    paymentMethods: response.data.Data.PaymentMethodId
                };
            } else {
                throw new Error(response.data.Message || 'Payment initiation failed');
            }
        } catch (error) {
            console.error('MyFatoorah initiate payment error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.Message || error.message);
        }
    }

    /**
     * Execute payment with specific method (KNET, Card, Apple Pay)
     */
    async executePayment(paymentData) {
        try {
            const payload = {
                PaymentMethodId: paymentData.paymentMethodId, // 1=KNET, 2=VISA/Master, 20=Apple Pay
                CustomerName: paymentData.customerName,
                DisplayCurrencyIso: 'KWD',
                MobileCountryCode: '+965',
                CustomerMobile: paymentData.customerPhone,
                CustomerEmail: paymentData.customerEmail,
                InvoiceValue: paymentData.amount,
                CallBackUrl: `${process.env.FRONTEND_URL}/order-success`,
                ErrorUrl: `${process.env.FRONTEND_URL}/checkout?error=payment_failed`,
                Language: paymentData.language || 'en',
                CustomerReference: paymentData.orderNumber,
                UserDefinedField: paymentData.orderId,
                InvoiceItems: paymentData.items.map(item => ({
                    ItemName: item.name,
                    Quantity: item.quantity,
                    UnitPrice: item.price
                }))
            };

            const response = await axios.post(
                `${this.baseUrl}/v2/ExecutePayment`,
                payload,
                { headers: this.headers, timeout: this.timeout }
            );

            if (response.data.IsSuccess) {
                return {
                    success: true,
                    paymentUrl: response.data.Data.PaymentURL,
                    invoiceId: response.data.Data.InvoiceId
                };
            } else {
                throw new Error(response.data.Message || 'Payment execution failed');
            }
        } catch (error) {
            console.error('MyFatoorah execute payment error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.Message || error.message);
        }
    }

    /**
     * Get payment status
     */
    async getPaymentStatus(paymentId) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/v2/GetPaymentStatus`,
                { Key: paymentId, KeyType: 'PaymentId' },
                { headers: this.headers, timeout: this.timeout }
            );

            if (response.data.IsSuccess) {
                const data = response.data.Data;
                return {
                    success: true,
                    status: data.InvoiceStatus, // 'Paid', 'Pending', 'Failed', 'Expired'
                    amount: data.InvoiceValue,
                    paidAmount: data.InvoiceDisplayValue,
                    paymentMethod: data.PaymentGateway,
                    transactionId: data.InvoiceTransactions[0]?.TransactionId,
                    customerReference: data.CustomerReference,
                    orderId: data.UserDefinedField
                };
            } else {
                throw new Error(response.data.Message || 'Failed to get payment status');
            }
        } catch (error) {
            console.error('MyFatoorah get status error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.Message || error.message);
        }
    }

    /**
     * Get available payment methods
     */
    async getPaymentMethods(amount = 1) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/v2/InitiatePayment`,
                { InvoiceAmount: amount, CurrencyIso: 'KWD' },
                { headers: this.headers, timeout: this.timeout }
            );

            if (response.data.IsSuccess) {
                return {
                    success: true,
                    methods: response.data.Data.PaymentMethods.map(method => ({
                        id: method.PaymentMethodId,
                        name: method.PaymentMethodEn,
                        nameAr: method.PaymentMethodAr,
                        code: method.PaymentMethodCode,
                        isDirectPayment: method.IsDirectPayment,
                        imageUrl: method.ImageUrl
                    }))
                };
            } else {
                throw new Error(response.data.Message || 'Failed to get payment methods');
            }
        } catch (error) {
            console.error('MyFatoorah get methods error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.Message || error.message);
        }
    }

    /**
     * Refund payment
     */
    async refundPayment(paymentId, amount, reason) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/v2/MakeRefund`,
                {
                    KeyType: 'PaymentId',
                    Key: paymentId,
                    RefundChargeOnCustomer: false,
                    ServiceChargeOnCustomer: false,
                    Amount: amount,
                    Comment: reason
                },
                { headers: this.headers, timeout: this.timeout }
            );

            if (response.data.IsSuccess) {
                return {
                    success: true,
                    refundId: response.data.Data.RefundId,
                    refundReference: response.data.Data.RefundReference
                };
            } else {
                throw new Error(response.data.Message || 'Refund failed');
            }
        } catch (error) {
            console.error('MyFatoorah refund error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.Message || error.message);
        }
    }
}

module.exports = new MyFatoorahService();
