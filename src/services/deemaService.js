/**
 * Deema BNPL Payment Service
 * Based on the OFFICIAL Deema WooCommerce Plugin source code
 * 
 * API Docs: https://sandbox-merchant.deema.me (Deema Dashboard)
 * Sandbox: https://sandbox-api.deema.me/
 * Production: https://api.deema.me/
 * 
 * Flow:
 *  1. POST /api/merchant/v1/purchase → returns redirect_link
 *  2. Customer is redirected to Deema BNPL approval page
 *  3. After approval, Deema redirects to success URL with ?reference=XXX
 *  4. Backend verifies and confirms the order
 * 
 * Auth: Basic <API_KEY>
 */

const axios = require('axios');

class DeemaService {
    constructor() {
        this.apiKey = process.env.DEEMA_API_KEY;
        this.mode = process.env.DEEMA_MODE || 'test';

        this.baseUrl = this.mode === 'live'
            ? 'https://api.deema.me/'
            : 'https://sandbox-api.deema.me/';

        this.timeout = 30000; // 30s

        if (this.apiKey && !this.apiKey.includes('your_')) {
            console.log(`[DEEMA] Service initialized (${this.mode} mode) → ${this.baseUrl}`);
        }
    }

    /**
     * Build headers for a specific auth type
     */
    _headers(authType) {
        return {
            'Authorization': `${authType} ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Create a Deema BNPL purchase
     * Endpoint: POST /api/merchant/v1/purchase
     * Returns a redirect_link where customer approves the BNPL plan
     * 
     * Tries Bearer auth first, falls back to Basic auth
     */
    async createPurchase(orderData) {
        const backendUrl = process.env.BACKEND_URL || 'https://arteva-maison-backend-gy1x.onrender.com';

        const payload = {
            amount: orderData.amount,
            currency_code: 'KWD',
            merchant_order_id: orderData.orderNumber,
            merchant_urls: {
                success: `${backendUrl}/api/payments/deema/callback`,
                failure: `${backendUrl}/api/payments/deema/callback?status=failed`
            }
        };

        const url = `${this.baseUrl}api/merchant/v1/purchase`;
        console.log('[DEEMA] Creating purchase:', JSON.stringify(payload, null, 2));
        console.log('[DEEMA] API URL:', url);

        // Try Bearer first, then Basic
        const authTypes = ['Bearer', 'Basic'];

        for (const authType of authTypes) {
            try {
                console.log(`[DEEMA] Trying ${authType} auth...`);
                const response = await axios.post(url, payload, {
                    headers: this._headers(authType),
                    timeout: this.timeout
                });

                const data = response.data;
                console.log(`[DEEMA] ✅ ${authType} auth worked! Response:`, JSON.stringify(data, null, 2));

                if (data.data && data.data.redirect_link) {
                    return {
                        success: true,
                        redirectLink: data.data.redirect_link,
                        orderReference: data.data.order_reference,
                        purchaseId: data.data.purchase_id
                    };
                }

                throw new Error(data.message || 'No redirect link returned');

            } catch (error) {
                const status = error.response?.status;
                const errMsg = error.response?.data?.message || error.response?.data?.error || error.message;
                console.log(`[DEEMA] ${authType} auth failed (HTTP ${status}): ${errMsg}`);

                // If it's an auth error (401/403/Unauthenticated), try next auth type
                if ((status === 401 || status === 403 || errMsg.includes('nauthorized') || errMsg.includes('nauthenticated')) && authType !== authTypes[authTypes.length - 1]) {
                    continue;
                }

                // Last attempt or non-auth error — throw
                throw new Error(errMsg);
            }
        }
    }

    /**
     * Refund a Deema order
     * Endpoint: POST /api/merchant/v1/order/{reference}/refund
     */
    async refund(orderReference, amount, reason) {
        try {
            const response = await axios.post(
                `${this.baseUrl}api/merchant/v1/order/${encodeURIComponent(orderReference)}/refund`,
                {
                    amount: parseFloat(amount),
                    currency: 'KWD',
                    comment: reason || 'Order refund'
                },
                { headers: this._headers('Basic'), timeout: this.timeout }
            );

            console.log(`[DEEMA] Refund response:`, response.data);

            if (response.data.message === 'Refund released') {
                return {
                    success: true,
                    message: response.data.message
                };
            }

            throw new Error(response.data.message || 'Refund failed');
        } catch (error) {
            console.error('[DEEMA] Refund error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || error.message);
        }
    }
}

module.exports = new DeemaService();
