/**
 * Deema BNPL Payment Service
 * Deema uses the Tap Payments API with source.id = "src_deema"
 * 
 * API Docs: https://tap.company/developers
 * Sandbox: https://sandbox-api.deema.me
 * Production: https://api.tap.company
 * 
 * Flow:
 *  1. Backend creates a Charge via POST /v2/charges
 *  2. Customer is redirected to Deema's BNPL approval page
 *  3. After approval, customer redirected back to redirect.url
 *  4. Backend verifies charge status via GET /v2/charges/{charge_id}
 *  5. Webhook (post.url) also fires server-to-server
 */

const axios = require('axios');

class DeemaService {
    constructor() {
        this.apiKey = process.env.DEEMA_API_KEY; // sk_test_... or sk_live_...
        this.mode = process.env.DEEMA_MODE || 'test';

        // Deema sandbox uses its own host; production uses Tap
        this.baseUrl = this.mode === 'live'
            ? 'https://api.tap.company'
            : 'https://sandbox-api.deema.me';

        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };

        this.timeout = 15000; // 15s

        if (this.apiKey && !this.apiKey.includes('your_')) {
            console.log(`[DEEMA] Service initialized (${this.mode} mode) → ${this.baseUrl}`);
        }
    }

    /**
     * Create a Deema BNPL charge
     * Returns a redirect URL where customer approves the BNPL plan
     */
    async createCharge(orderData) {
        try {
            // Clean phone
            let phone = (orderData.customerPhone || '').replace(/[\s\-\(\)\+]/g, '');
            phone = phone.replace(/^00/, '');
            let countryCode = '965';
            const gccCodes = ['965', '966', '971', '974', '973', '968'];
            const matched = gccCodes.find(c => phone.startsWith(c));
            if (matched) { countryCode = matched; phone = phone.substring(matched.length); }
            if (!phone || phone.length < 4) phone = '00000000';

            const backendUrl = process.env.BACKEND_URL || 'https://arteva-maison-backend-gy1x.onrender.com';
            const frontendUrl = process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com';

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
                    id: 'src_deema' // This tells Tap to use Deema BNPL
                },
                post: {
                    url: `${backendUrl}/api/payments/deema/webhook`
                },
                redirect: {
                    url: `${backendUrl}/api/payments/deema/callback`
                }
            };

            console.log('[DEEMA] Creating charge:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/v2/charges`,
                payload,
                { headers: this.headers, timeout: this.timeout }
            );

            const data = response.data;
            console.log('[DEEMA] Charge created:', data.id, '→ status:', data.status);

            if (data.transaction && data.transaction.url) {
                return {
                    success: true,
                    chargeId: data.id,
                    paymentUrl: data.transaction.url,
                    status: data.status
                };
            }

            // If no redirect URL, check if already captured
            if (data.status === 'CAPTURED') {
                return {
                    success: true,
                    chargeId: data.id,
                    paymentUrl: null,
                    status: 'CAPTURED'
                };
            }

            throw new Error(data.message || 'Deema charge creation failed — no redirect URL returned');

        } catch (error) {
            console.error('[DEEMA] Create charge error:', error.response?.data || error.message);
            const errMsg = error.response?.data?.errors?.[0]?.description
                || error.response?.data?.message
                || error.message;
            throw new Error(errMsg);
        }
    }

    /**
     * Get charge status (verify payment)
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
                status: data.status, // INITIATED, CAPTURED, FAILED, CANCELLED, etc.
                amount: data.amount,
                currency: data.currency,
                orderId: data.metadata?.orderId || data.reference?.order,
                orderNumber: data.metadata?.orderNumber || data.reference?.transaction,
                receiptId: data.receipt?.id,
                customerEmail: data.customer?.email
            };
        } catch (error) {
            console.error('[DEEMA] Get charge status error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || error.message);
        }
    }

    /**
     * Refund a Deema charge
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
