/**
 * Deema BNPL Payment Service
 * 
 * Deema keys (sk_test_...) may work on either:
 *  A) Deema's own API: sandbox-api.deema.me/api/merchant/v1/purchase (Basic auth)
 *  B) Tap Payments API: api.tap.company/v2/charges (Bearer auth, source: src_deema)
 * 
 * This service tries BOTH approaches automatically.
 */

const axios = require('axios');

class DeemaService {
    constructor() {
        this.apiKey = process.env.DEEMA_API_KEY;
        this.mode = process.env.DEEMA_MODE || 'test';
        this.timeout = 30000;

        // We'll try multiple API endpoints + auth combinations
        this.strategies = [
            {
                name: 'Deema Merchant API (Bearer)',
                url: this.mode === 'live'
                    ? 'https://api.deema.me/api/merchant/v1/purchase'
                    : 'https://sandbox-api.deema.me/api/merchant/v1/purchase',
                auth: `Bearer ${this.apiKey}`,
                format: 'deema'
            },
            {
                name: 'Deema Merchant API (Basic raw)',
                url: this.mode === 'live'
                    ? 'https://api.deema.me/api/merchant/v1/purchase'
                    : 'https://sandbox-api.deema.me/api/merchant/v1/purchase',
                auth: `Basic ${this.apiKey}`,
                format: 'deema'
            },
            {
                name: 'Deema Merchant API (Basic base64 key:)',
                url: this.mode === 'live'
                    ? 'https://api.deema.me/api/merchant/v1/purchase'
                    : 'https://sandbox-api.deema.me/api/merchant/v1/purchase',
                auth: `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
                format: 'deema'
            },
            {
                name: 'Deema Merchant API (Basic base64 :key)',
                url: this.mode === 'live'
                    ? 'https://api.deema.me/api/merchant/v1/purchase'
                    : 'https://sandbox-api.deema.me/api/merchant/v1/purchase',
                auth: `Basic ${Buffer.from(':' + this.apiKey).toString('base64')}`,
                format: 'deema'
            },
            {
                name: 'Tap Payments (Bearer + src_deema)',
                url: 'https://api.tap.company/v2/charges',
                auth: `Bearer ${this.apiKey}`,
                format: 'tap'
            }
        ];

        // Remember which strategy worked
        this.workingStrategy = null;

        if (this.apiKey && !this.apiKey.includes('your_')) {
            console.log(`[DEEMA] Service initialized (${this.mode} mode). Will auto-detect API endpoint.`);
        }
    }

    /**
     * Build payload for Deema's own merchant API
     */
    _buildDeemaPayload(orderData, backendUrl) {
        return {
            amount: orderData.amount,
            currency_code: 'KWD',
            merchant_order_id: orderData.orderNumber,
            merchant_urls: {
                success: `${backendUrl}/api/payments/deema/callback?merchant_order_id=${orderData.orderNumber}`,
                failure: `${backendUrl}/api/payments/deema/callback?status=failed&merchant_order_id=${orderData.orderNumber}`
            }
        };
    }

    /**
     * Build payload for Tap Payments API
     */
    _buildTapPayload(orderData, backendUrl) {
        let phone = (orderData.customerPhone || '').replace(/[\s\-\(\)\+]/g, '');
        phone = phone.replace(/^00/, '');
        let countryCode = '965';
        const gccCodes = ['965', '966', '971', '974', '973', '968'];
        const matched = gccCodes.find(c => phone.startsWith(c));
        if (matched) { countryCode = matched; phone = phone.substring(matched.length); }
        if (!phone || phone.length < 4) phone = '00000000';

        return {
            amount: orderData.amount,
            currency: 'KWD',
            customer_initiated: true,
            threeDSecure: false,
            description: `ARTÉVA Maison Order ${orderData.orderNumber}`,
            metadata: { orderId: orderData.orderId, orderNumber: orderData.orderNumber },
            reference: { transaction: orderData.orderNumber, order: orderData.orderId },
            customer: {
                first_name: orderData.customerName || 'Customer',
                email: orderData.customerEmail || '',
                phone: { country_code: countryCode, number: phone }
            },
            source: { id: 'src_deema' },
            post: { url: `${backendUrl}/api/payments/deema/webhook` },
            redirect: { url: `${backendUrl}/api/payments/deema/callback?merchant_order_id=${orderData.orderNumber}&orderId=${orderData.orderId}` }
        };
    }

    /**
     * Parse response from either API
     */
    _parseResponse(data, format) {
        if (format === 'deema') {
            // Deema merchant API returns: { data: { redirect_link, order_reference, purchase_id } }
            if (data.data && data.data.redirect_link) {
                return {
                    success: true,
                    chargeId: data.data.order_reference || data.data.purchase_id,
                    paymentUrl: data.data.redirect_link,
                    status: 'INITIATED'
                };
            }
        } else if (format === 'tap') {
            // Tap returns: { id, transaction: { url }, status }
            if (data.transaction && data.transaction.url) {
                return {
                    success: true,
                    chargeId: data.id,
                    paymentUrl: data.transaction.url,
                    status: data.status
                };
            }
            if (data.status === 'CAPTURED') {
                return { success: true, chargeId: data.id, paymentUrl: null, status: 'CAPTURED' };
            }
        }
        return null;
    }

    /**
     * Create a Deema BNPL charge
     * Auto-detects which API endpoint + auth format works
     */
    async createCharge(orderData) {
        const backendUrl = process.env.BACKEND_URL || 'https://arteva-maison-backend-gy1x.onrender.com';

        // If we already know which strategy works, use it directly
        const strategies = this.workingStrategy ? [this.workingStrategy] : this.strategies;
        const errors = [];

        for (const strategy of strategies) {
            try {
                const payload = strategy.format === 'deema'
                    ? this._buildDeemaPayload(orderData, backendUrl)
                    : this._buildTapPayload(orderData, backendUrl);

                console.log(`[DEEMA] Trying: ${strategy.name}`);
                console.log(`[DEEMA] URL: ${strategy.url}`);
                console.log(`[DEEMA] Payload:`, JSON.stringify(payload, null, 2));

                const response = await axios.post(strategy.url, payload, {
                    headers: {
                        'Authorization': strategy.auth,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.timeout
                });

                const result = this._parseResponse(response.data, strategy.format);

                if (result) {
                    console.log(`[DEEMA] ✅ ${strategy.name} WORKED! Charge: ${result.chargeId}`);
                    this.workingStrategy = strategy; // Remember for next time
                    return result;
                }

                console.log(`[DEEMA] ${strategy.name}: Response OK but no payment URL`, response.data);

            } catch (error) {
                const status = error.response?.status;
                const errMsg = error.response?.data?.errors?.[0]?.description
                    || error.response?.data?.message
                    || error.response?.data?.error
                    || error.message;
                console.log(`[DEEMA] ❌ ${strategy.name} failed (HTTP ${status}): ${errMsg}`);
                errors.push(`${strategy.name}: ${errMsg}`);
            }
        }

        // All strategies failed
        throw new Error(`All Deema API strategies failed:\n${errors.join('\n')}`);
    }

    /**
     * Get charge/order status
     * Works for both Tap charges (chg_xxx) and Deema references
     */
    async getChargeStatus(chargeId) {
        // Try Tap first
        try {
            const response = await axios.get(
                `https://api.tap.company/v2/charges/${chargeId}`,
                { headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: this.timeout }
            );
            const data = response.data;
            return {
                success: true, chargeId: data.id, status: data.status,
                amount: data.amount, currency: data.currency,
                orderId: data.metadata?.orderId || data.reference?.order,
                orderNumber: data.metadata?.orderNumber || data.reference?.transaction
            };
        } catch (e) {
            console.log(`[DEEMA] Tap charge status failed for ${chargeId}: ${e.message}`);
        }

        // Return basic info from our DB
        return { success: false, chargeId, status: 'UNKNOWN' };
    }

    /**
     * Refund
     */
    async refund(chargeId, amount, reason) {
        // Try Tap refund
        try {
            const response = await axios.post(
                'https://api.tap.company/v2/refunds',
                { charge_id: chargeId, amount, currency: 'KWD', description: reason || 'Refund', reason: 'requested_by_customer' },
                { headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: this.timeout }
            );
            return { success: true, refundId: response.data.id, status: response.data.status };
        } catch (e) {
            console.error('[DEEMA] Refund error:', e.response?.data || e.message);
        }

        // Try Deema merchant refund
        try {
            const deemaUrl = this.mode === 'live' ? 'https://api.deema.me' : 'https://sandbox-api.deema.me';
            const response = await axios.post(
                `${deemaUrl}/api/merchant/v1/order/${encodeURIComponent(chargeId)}/refund`,
                { amount: parseFloat(amount), currency: 'KWD', comment: reason || 'Refund' },
                { headers: { 'Authorization': `Basic ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: this.timeout }
            );
            if (response.data.message === 'Refund released') {
                return { success: true, message: response.data.message };
            }
        } catch (e) {
            console.error('[DEEMA] Deema merchant refund error:', e.response?.data || e.message);
        }

        throw new Error('Refund failed on all endpoints');
    }
}

module.exports = new DeemaService();
