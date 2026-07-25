/**
 * MyFatoorah Payment Gateway Integration
 * Supports: KNET, Credit Cards, Apple Pay, Deema (BNPL)
 * Documentation: https://myfatoorah.readme.io/docs
 *
 * NOTE: Deema uses a SEPARATE MyFatoorah API key.
 * Both instances share the same code but use different credentials.
 */

const axios = require('axios');
const ApiError = require('../utils/ApiError');
const { isUsableKey } = require('../config/paymentConfig');
const frontendUrls = require('../utils/frontendUrls');

/**
 * Turns an axios failure from MyFatoorah into a typed ApiError.
 *
 * Every call site previously did `throw new Error(...)`, which the error
 * middleware could only report as a 500. Classifying here means the client
 * learns whether the problem is credentials, a timeout, a validation error in
 * our payload, or a genuine gateway outage.
 */
function toApiError(error, operation) {
    const status = error.response?.status;
    const data = error.response?.data;
    const gatewayMessage = data?.Message || data?.message;
    const validationErrors = data?.ValidationErrors;

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return ApiError.gatewayTimeout(
            'PAYMENT_GATEWAY_TIMEOUT',
            'The payment provider did not respond in time. Please try again.'
        );
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'EAI_AGAIN') {
        return ApiError.unavailable(
            'PAYMENT_GATEWAY_UNREACHABLE',
            'Could not reach the payment provider. Please try again shortly.'
        );
    }

    if (status === 401 || status === 403) {
        // Credentials rejected — an operator problem, never the shopper's fault.
        return ApiError.unavailable(
            'PAYMENT_GATEWAY_UNAUTHORIZED',
            'Online payments are temporarily unavailable. Please try again shortly.',
            { operation }
        );
    }

    if (status === 400 && validationErrors) {
        return ApiError.badGateway(
            'PAYMENT_GATEWAY_REJECTED_REQUEST',
            gatewayMessage || 'The payment provider rejected the request.',
            { operation, validationErrors }
        );
    }

    if (status >= 500) {
        return ApiError.badGateway(
            'PAYMENT_GATEWAY_ERROR',
            'The payment provider is having trouble. Please try again shortly.',
            { operation }
        );
    }

    return ApiError.badGateway(
        'PAYMENT_GATEWAY_ERROR',
        gatewayMessage || error.message || 'Payment request failed.',
        { operation }
    );
}

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

        // Request timeout (15 seconds — MyFatoorah's ExecutePayment can be slow)
        this.timeout = Number(process.env.MYFATOORAH_TIMEOUT_MS) || 15000;

        this.configured = isUsableKey(this.apiKey);

        if (this.configured) {
            console.log(`[MYFATOORAH] ${this.label} service initialized (${mode} mode)`);
        } else {
            console.error(
                `[MYFATOORAH] ${this.label} service NOT configured — API key is missing, ` +
                `truncated, or still the setup placeholder. Calls will fail fast with ` +
                `PAYMENT_GATEWAY_UNAVAILABLE rather than hitting the gateway.`
            );
        }
    }

    /**
     * Fail fast when the key is unusable. Without this every call spent the full
     * timeout budget getting a 401 back, then surfaced as an opaque 500.
     */
    assertConfigured(operation) {
        if (this.configured) return;
        throw ApiError.unavailable(
            'PAYMENT_GATEWAY_UNAVAILABLE',
            'Online payments are temporarily unavailable. Please try again shortly.',
            { operation, provider: this.label }
        );
    }

    /**
     * Initialize payment - creates invoice and returns payment URL
     */
    async initiatePayment(orderData) {
        this.assertConfigured('initiatePayment');
        try {
            console.log(`[MYFATOORAH] initiatePayment order=${orderData.orderNumber} amount=${orderData.amount}`);

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
                ErrorUrl: frontendUrls.gatewayErrorUrl(),
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

            if (!response.data?.IsSuccess || !response.data?.Data?.PaymentURL) {
                throw ApiError.badGateway(
                    'PAYMENT_GATEWAY_REJECTED_REQUEST',
                    response.data?.Message || 'Payment initiation failed',
                    { operation: 'initiatePayment', validationErrors: response.data?.ValidationErrors }
                );
            }

            return {
                success: true,
                paymentUrl: response.data.Data.PaymentURL,
                invoiceId: response.data.Data.InvoiceId,
                paymentMethods: response.data.Data.PaymentMethodId
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            console.error('[MYFATOORAH] initiatePayment failed:', error.response?.data || error.message);
            throw toApiError(error, 'initiatePayment');
        }
    }

    /**
     * Execute payment with specific method (KNET, Card, Apple Pay)
     */
    async executePayment(paymentData, discount = 0) {
        this.assertConfigured('executePayment');
        try {
            console.log(
                `[MYFATOORAH] executePayment order=${paymentData.orderNumber} ` +
                `method=${paymentData.paymentMethodId} amount=${paymentData.amount}`
            );

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
            // If there's a promo discount, calculating exact unit prices per item
            // causes floating-point validation errors in MyFatoorah since
            // Sum(UnitPrice * Quantity) must equal InvoiceValue EXACTLY.
            // Therefore, we collapse the invoice into a single line item for discounted orders.
            if (discount > 0) {
                invoiceItems.length = 0;
                invoiceItems.push({
                    ItemName: 'Order Total (Discount Applied)',
                    Quantity: 1,
                    UnitPrice: paymentData.amount
                });
                console.log(`[MYFATOORAH] Discount ${discount} KWD applied. Collapsed invoice items to a single line item.`);
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
                ErrorUrl: frontendUrls.gatewayErrorUrl(),
                Language: paymentData.language === 'ar' ? 'AR' : 'EN',
                CustomerReference: paymentData.orderNumber,
                UserDefinedField: paymentData.orderId,
                InvoiceItems: invoiceItems
            };

            // Guard the invariant MyFatoorah enforces server-side:
            // Sum(UnitPrice × Quantity) must equal InvoiceValue exactly.
            const lineSum = invoiceItems.reduce((s, i) => s + i.UnitPrice * i.Quantity, 0);
            if (Math.abs(lineSum - paymentData.amount) > 0.001) {
                console.error(
                    `[MYFATOORAH] Invoice line sum ${lineSum.toFixed(3)} ≠ InvoiceValue ` +
                    `${paymentData.amount} — collapsing to a single line to stay valid.`
                );
                invoiceItems.length = 0;
                invoiceItems.push({ ItemName: 'Order Total', Quantity: 1, UnitPrice: paymentData.amount });
            }

            const response = await axios.post(
                `${this.baseUrl}/v2/ExecutePayment`,
                payload,
                { headers: this.headers, timeout: this.timeout }
            );

            if (!response.data?.IsSuccess || !response.data?.Data?.PaymentURL) {
                console.error('[MYFATOORAH] executePayment rejected:', {
                    message: response.data?.Message,
                    validationErrors: response.data?.ValidationErrors,
                });
                throw ApiError.badGateway(
                    'PAYMENT_GATEWAY_REJECTED_REQUEST',
                    response.data?.Message || 'Payment execution failed',
                    { operation: 'executePayment', validationErrors: response.data?.ValidationErrors }
                );
            }

            return {
                success: true,
                paymentUrl: response.data.Data.PaymentURL,
                invoiceId: response.data.Data.InvoiceId
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;

            console.error('[MYFATOORAH] executePayment failed:', {
                message: error.message,
                status: error.response?.status,
                gatewayMessage: error.response?.data?.Message,
                validationErrors: error.response?.data?.ValidationErrors,
            });

            throw toApiError(error, 'executePayment');
        }
    }

    /**
     * Get payment status
     */
    async getPaymentStatus(paymentId) {
        this.assertConfigured('getPaymentStatus');
        try {
            const response = await axios.post(
                `${this.baseUrl}/v2/GetPaymentStatus`,
                { Key: paymentId, KeyType: 'PaymentId' },
                { headers: this.headers, timeout: this.timeout }
            );

            if (!response.data?.IsSuccess || !response.data?.Data) {
                throw ApiError.badGateway(
                    'PAYMENT_STATUS_UNAVAILABLE',
                    response.data?.Message || 'Failed to get payment status',
                    { operation: 'getPaymentStatus' }
                );
            }

            const data = response.data.Data;
            return {
                success: true,
                status: data.InvoiceStatus, // 'Paid' | 'Pending' | 'Failed' | 'Expired'
                amount: data.InvoiceValue,
                paidAmount: data.InvoiceDisplayValue,
                paymentMethod: data.PaymentGateway,
                // InvoiceTransactions can be absent on a pending invoice
                transactionId: data.InvoiceTransactions?.[0]?.TransactionId,
                customerReference: data.CustomerReference,
                orderId: data.UserDefinedField
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            console.error('[MYFATOORAH] getPaymentStatus failed:', error.response?.data || error.message);
            throw toApiError(error, 'getPaymentStatus');
        }
    }

    /**
     * Get available payment methods
     */
    async getPaymentMethods(amount = 1) {
        this.assertConfigured('getPaymentMethods');
        try {
            const response = await axios.post(
                `${this.baseUrl}/v2/InitiatePayment`,
                { InvoiceAmount: amount, CurrencyIso: 'KWD' },
                { headers: this.headers, timeout: this.timeout }
            );

            if (!response.data?.IsSuccess || !Array.isArray(response.data?.Data?.PaymentMethods)) {
                throw ApiError.badGateway(
                    'PAYMENT_METHODS_UNAVAILABLE',
                    response.data?.Message || 'Failed to get payment methods',
                    { operation: 'getPaymentMethods' }
                );
            }

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
        } catch (error) {
            if (error instanceof ApiError) throw error;
            console.error('[MYFATOORAH] getPaymentMethods failed:', error.response?.data || error.message);
            throw toApiError(error, 'getPaymentMethods');
        }
    }

    /**
     * Refund payment
     * NOTE: This initiates a refund request in MyFatoorah.
     * Refunds typically require MANUAL APPROVAL in MyFatoorah merchant dashboard.
     * The refund is not automatic - merchant must log in and approve it.
     */
    async refundPayment(paymentId, amount, reason) {
        this.assertConfigured('refundPayment');
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

            if (!response.data?.IsSuccess) {
                throw ApiError.badGateway(
                    'REFUND_REJECTED',
                    response.data?.Message || 'Refund failed',
                    { operation: 'refundPayment' }
                );
            }

            console.log(`[MYFATOORAH] Refund request created: ${response.data.Data.RefundId}`);
            console.log('[MYFATOORAH] ⚠️  Refund requires manual approval in the MyFatoorah dashboard');
            return {
                success: true,
                refundId: response.data.Data.RefundId,
                refundReference: response.data.Data.RefundReference,
                requiresApproval: true
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            console.error('[MYFATOORAH] refundPayment failed:', error.response?.data || error.message);
            throw toApiError(error, 'refundPayment');
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

