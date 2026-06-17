/**
 * Deema BNPL Payment Service
 * 
 * The sk_test_ / sk_live_ keys are TAP PAYMENTS keys.
 * Deema is available as a payment source through Tap Payments.
 * 
 * URL: https://api.tap.company/v2/charges (same for test & live)
 * Auth: Bearer <sk_test_ or sk_live_ key>
 * Source: { id: "src_deema" }
 * 
 * Flow:
 *  1. POST /v2/charges with source.id = "src_deema"
 *  2. Customer redirected to Deema BNPL approval page (transaction.url)
 *  3. After approval, customer redirected to redirect.url
 *  4. Webhook fires to post.url
 */

const axios = require('axios');

class DeemaService {
    constructor() {
        this.apiKey = process.env.DEEMA_API_KEY;
        this.mode = process.env.DEEMA_MODE || 'test';

        // Tap Payments uses the SAME URL for test and live
        // The API key (sk_test_ vs sk_live_) determines the mode
        this.baseUrl = 'https://api.tap.company';

        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };

        this.timeout = 30000;

        if (this.apiKey && !this.apiKey.includes('your_')) {
            console.log(`[DEEMA] Service initialized (${this.mode} mode) via Tap Payments → ${this.baseUrl}`);
        }
    }

    /**
     * Create a Deema BNPL charge via Tap Payments
     * POST /v2/charges with source.id = "src_deema"
     */
    async createCharge(orderData) {
        try {
            // Parse phone
            let phone = (orderData.customerPhone || '').replace(/[\s\-\(\)\+]/g, '');
            phone = phone.replace(/^00/, '');
            let countryCode = '965';
            const gccCodes = ['965', '966', '971', '974', '973', '968'];
            const matched = gccCodes.find(c => phone.startsWith(c));
            if (matched) { countryCode = matched; phone = phone.substring(matched.length); }
            if (!phone || phone.length < 4) phone = '00000000';

            const backendUrl = process.env.BACKEND_URL || 'https://arteva-maison-backend-gy1x.onrender.com';

            const payload = {
                amount: orderData.amount,
                currency: 'KWD',
                customer_initiated: true,
                threeDSecure: false,
                description: `ARTÉVA Maison Order ${orderData.orderNumber}`,
                metadata: {
                    orderId: orderData.orderId,
                    orderNumber: orderData.orderNumber
                },
                reference: {
                    transaction: orderData.orderNumber,
                    order: orderData.orderId
                },
                customer: {
                    first_name: orderData.customerName || 'Customer',
                    email: orderData.customerEmail || '',
                    phone: {
                        country_code: countryCode,
                        number: phone
                    }
                },
                source: {
                    id: 'src_deema'
                },
                post: {
                    url: `${backendUrl}/api/payments/deema/webhook`
                },
                redirect: {
                    url: `${backendUrl}/api/payments/deema/callback`
                }
            };

            console.log('[DEEMA] Creating Tap charge with src_deema:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/v2/charges`,
                payload,
                { headers: this.headers, timeout: this.timeout }
            );

            const data = response.data;
            console.log('[DEEMA] Tap charge created:', data.id, '→ status:', data.status);

            // Tap returns transaction.url for redirect-based payments
            if (data.transaction && data.transaction.url) {
                return {
                    success: true,
                    chargeId: data.id,
                    paymentUrl: data.transaction.url,
                    status: data.status
                };
            }

            // If already captured (unlikely for BNPL)
            if (data.status === 'CAPTURED') {
                return {
                    success: true,
                    chargeId: data.id,
                    paymentUrl: null,
                    status: 'CAPTURED'
                };
            }

            throw new Error(data.message || 'No redirect URL returned from Tap/Deema');

        } catch (error) {
            console.error('[DEEMA] Create charge error:', error.response?.data || error.message);
            const errMsg = error.response?.data?.errors?.[0]?.description
                || error.response?.data?.message
                || error.message;
            throw new Error(errMsg);
        }
    }

    /**
     * Get charge status from Tap
     * GET /v2/charges/{charge_id}
     */
    async getChargeStatus(chargeId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/v2/charges/${chargeId}`,
                { headers: this.headers, timeout: this.timeout }
            );

            const data = response.data;
            return {
                success: true,
                chargeId: data.id,
                status: data.status,
                amount: data.amount,
                currency: data.currency,
                orderId: data.metadata?.orderId || data.reference?.order,
                orderNumber: data.metadata?.orderNumber || data.reference?.transaction,
                customerEmail: data.customer?.email
            };
        } catch (error) {
            console.error('[DEEMA] Get charge status error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || error.message);
        }
    }

    /**
     * Refund a Tap/Deema charge
     * POST /v2/refunds
     */
    async refund(chargeId, amount, reason) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/v2/refunds`,
                {
                    charge_id: chargeId,
                    amount: amount,
                    currency: 'KWD',
                    description: reason || 'Order refund',
                    reason: 'requested_by_customer'
                },
                { headers: this.headers, timeout: this.timeout }
            );

            console.log(`[DEEMA] Refund created: ${response.data.id}`);
            return {
                success: true,
                refundId: response.data.id,
                status: response.data.status
            };
        } catch (error) {
            console.error('[DEEMA] Refund error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || error.message);
        }
    }
}

module.exports = new DeemaService();
