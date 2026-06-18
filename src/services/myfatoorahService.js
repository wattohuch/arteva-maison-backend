/**
 * MyFatoorah Payment Gateway Integration
 * Supports: KNET, Credit Cards, Apple Pay, Deema (BNPL)
 * Documentation: https://myfatoorah.readme.io/docs
 *
 * NOTE: Deema uses a SEPARATE MyFatoorah API key.
 * Both instances share the same code but use different credentials.
 */

const axios = require('axios');

class MyFatoorahService {
    /**
     * @param {Object} config - Optional overrides
     * @param {string} config.apiKey - MyFatoorah API key (defaults to MYFATOORAH_API_KEY)
     * @param {string} config.mode - 'test' or 'live' (defaults to MYFATOORAH_MODE)
     * @param {string} config.label - Human-readable label for logs (e.g. 'Deema')
     */
    constructor(config = {}) {
        this.label = config.label || 'Main';
        this.apiKey = config.apiKey || process.env.MYFATOORAH_API_KEY;
        const mode = config.mode || process.env.MYFATOORAH_MODE || 'test';
        this.baseUrl = mode === 'live'
            ? 'https://api.myfatoorah.com'
            : 'https://apitest.myfatoorah.com';

        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };

        // Request timeout (10 seconds)
        this.timeout = 10000;

        if (this.apiKey && this.apiKey !== 'your_myfatoorah_api_key_here' && this.apiKey !== 'your_deema_test_api_key_here') {
            console.log(`[MYFATOORAH] ${this.label} service initialized (${mode} mode)`);
        }
    }

    /**
     * Initialize payment - creates invoice and returns payment URL
     */
    async initiatePayment(orderData) {
        try {
            console.log('MyFatoorah initiatePayment - Base URL:', this.baseUrl);
            console.log('MyFatoorah initiatePayment - Order Data:', JSON.stringify(orderData, null, 2));

            // Clean phone number - same logic as executePayment
            let rawPhone = (orderData.customerPhone || '').replace(/[\s\-\(\)\+]/g, '');
            rawPhone = rawPhone.replace(/^00/, '');
            if (!rawPhone || rawPhone.length < 4) {
                rawPhone = '96500000000';
            }
            let mobileCountryCode = '+965';
            let cleanPhone = rawPhone;
            const gccCodes = ['965', '966', '971', '974', '973', '968'];
            const matchedCode = gccCodes.find(code => rawPhone.startsWith(code));
            if (matchedCode) {
                mobileCountryCode = '+' + matchedCode;
                cleanPhone = rawPhone.substring(matchedCode.length);
            }
            if (!cleanPhone || cleanPhone.length < 4) {
                cleanPhone = '00000000';
            }

            const payload = {
                CustomerName: orderData.customerName,
                InvoiceValue: orderData.amount,
                DisplayCurrencyIso: orderData.currency || 'KWD',
                CustomerEmail: orderData.customerEmail,
                CustomerMobile: cleanPhone,
                CallBackUrl: `${process.env.BACKEND_URL || 'https://arteva-maison-backend-gy1x.onrender.com'}/api/payments/callback`,
                ErrorUrl: `${process.env.FRONTEND_URL}/payment-error.html`,
                Language: orderData.language || 'en',
                CustomerReference: orderData.orderNumber,
                UserDefinedField: orderData.orderId, // Store order ID for webhook
                InvoiceItems: orderData.items.map(item => ({
                    ItemName: item.name,
                    Quantity: item.quantity,
                    UnitPrice: item.price
                })),
                // Enable payment methods
                MobileCountryCode: mobileCountryCode
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
    async executePayment(paymentData, discount = 0) {
        try {
            console.log('MyFatoorah executePayment - Base URL:', this.baseUrl);
            console.log('MyFatoorah executePayment - Payment Data:', JSON.stringify(paymentData, null, 2));

            // Clean phone number - strip all formatting, then extract country code + local number
            let rawPhone = (paymentData.customerPhone || '').replace(/[\s\-\(\)\+]/g, '');
            // Remove leading zeros (international prefix like 00965)
            rawPhone = rawPhone.replace(/^00/, '');

            // If phone is empty after cleaning, use a placeholder (MyFatoorah requires a value)
            if (!rawPhone || rawPhone.length < 4) {
                rawPhone = '96500000000';
            }

            let mobileCountryCode = '+965'; // Default Kuwait
            let cleanPhone = rawPhone;

            // Known GCC country codes (3-digit)
            const gccCodes = ['965', '966', '971', '974', '973', '968'];
            const matchedCode = gccCodes.find(code => rawPhone.startsWith(code));
            if (matchedCode) {
                mobileCountryCode = '+' + matchedCode;
                cleanPhone = rawPhone.substring(matchedCode.length);
            }

            // Ensure cleanPhone has at least some digits (MyFatoorah validation)
            if (!cleanPhone || cleanPhone.length < 4) {
                cleanPhone = '00000000';
            }

            // Build InvoiceItems — MyFatoorah requires sum of (UnitPrice * Quantity) == InvoiceValue
            // When a promo discount is applied, we distribute the discount across items proportionally
            const invoiceItems = paymentData.items.map(item => ({
                ItemName: item.name,
                Quantity: item.quantity,
                UnitPrice: item.price
            }));

            // Add shipping as a separate item
            invoiceItems.push({
                ItemName: 'Shipping',
                Quantity: 1,
                UnitPrice: 2.0
            });

            // If there's a promo discount, distribute it across items proportionally
            // MyFatoorah does NOT accept negative UnitPrice values
            if (discount > 0) {
                const itemsTotal = invoiceItems.reduce((sum, item) => sum + (item.UnitPrice * item.Quantity), 0);
                let remainingDiscount = discount;

                for (let i = 0; i < invoiceItems.length && remainingDiscount > 0; i++) {
                    const item = invoiceItems[i];
                    const itemTotal = item.UnitPrice * item.Quantity;
                    // Distribute proportionally
                    const itemDiscount = Math.min(
                        parseFloat((discount * (itemTotal / itemsTotal)).toFixed(3)),
                        remainingDiscount,
                        itemTotal // Don't make price negative
                    );
                    if (itemDiscount > 0 && item.Quantity > 0) {
                        item.UnitPrice = parseFloat(((itemTotal - itemDiscount) / item.Quantity).toFixed(3));
                        remainingDiscount = parseFloat((remainingDiscount - itemDiscount).toFixed(3));
                    }
                }

                // Handle any rounding remainder by adjusting the first item
                if (remainingDiscount > 0.001 && invoiceItems.length > 0) {
                    const first = invoiceItems[0];
                    const maxDeduct = first.UnitPrice * first.Quantity;
                    const deduct = Math.min(remainingDiscount, maxDeduct);
                    first.UnitPrice = parseFloat(((first.UnitPrice * first.Quantity - deduct) / first.Quantity).toFixed(3));
                }

                console.log(`[MYFATOORAH] Discount ${discount} KWD distributed across ${invoiceItems.length} invoice items`);
            }

            const payload = {
                PaymentMethodId: paymentData.paymentMethodId, // 1=KNET, 2=VISA/Master, 20=Apple Pay
                CustomerName: paymentData.customerName,
                DisplayCurrencyIso: 'KWD',
                MobileCountryCode: mobileCountryCode,
                CustomerMobile: cleanPhone,
                CustomerEmail: paymentData.customerEmail,
                InvoiceValue: paymentData.amount,
                CallBackUrl: `${process.env.BACKEND_URL || 'https://arteva-maison-backend-gy1x.onrender.com'}/api/payments/callback`,
                ErrorUrl: `${process.env.FRONTEND_URL}/payment-error.html`,
                Language: paymentData.language === 'ar' ? 'AR' : 'EN',
                CustomerReference: paymentData.orderNumber,
                UserDefinedField: paymentData.orderId,
                InvoiceItems: invoiceItems
            };

            console.log('MyFatoorah payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/v2/ExecutePayment`,
                payload,
                { headers: this.headers, timeout: this.timeout }
            );

            console.log('MyFatoorah response:', JSON.stringify(response.data, null, 2));

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
            console.error('MyFatoorah execute payment error:', {
                message: error.message,
                response: error.response?.data,
                validationErrors: error.response?.data?.ValidationErrors,
                status: error.response?.status,
                headers: error.response?.headers
            });

            // Log validation errors in detail
            if (error.response?.data?.ValidationErrors) {
                console.error('Validation Errors Detail:', JSON.stringify(error.response.data.ValidationErrors, null, 2));
            }

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
     * NOTE: This initiates a refund request in MyFatoorah.
     * Refunds typically require MANUAL APPROVAL in MyFatoorah merchant dashboard.
     * The refund is not automatic - merchant must log in and approve it.
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
                console.log(`[MYFATOORAH] Refund request created: ${response.data.Data.RefundId}`);
                console.log(`[MYFATOORAH] ⚠️  IMPORTANT: Refund requires manual approval in MyFatoorah dashboard`);
                return {
                    success: true,
                    refundId: response.data.Data.RefundId,
                    refundReference: response.data.Data.RefundReference,
                    requiresApproval: true // Flag to indicate manual approval needed
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

// ═══════════════════════════════════════════════════
// SERVICE INSTANCE
// ═══════════════════════════════════════════════════

// Main MyFatoorah service (KNET, Card, Apple Pay)
// NOTE: Deema BNPL is now handled by a separate service (deemaService.js)
const defaultService = new MyFatoorahService({ label: 'Main' });

module.exports = defaultService;
module.exports.MyFatoorahService = MyFatoorahService;

