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

        this.headers = {
            'Authorization': `Basic ${this.apiKey}`,
            'Content-Type': 'application/json'
        };

        this.timeout = 30000; // 30s

        if (this.apiKey && !this.apiKey.includes('your_')) {
            console.log(`[DEEMA] Service initialized (${this.mode} mode) → ${this.baseUrl}`);
        }
    }

    /**
     * Create a Deema BNPL purchase
     * Endpoint: POST /api/merchant/v1/purchase
     * Returns a redirect_link where customer approves the BNPL plan
     */
    async createPurchase(orderData) {
        try {
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

            console.log('[DEEMA] Creating purchase:', JSON.stringify(payload, null, 2));
            console.log('[DEEMA] API URL:', `${this.baseUrl}api/merchant/v1/purchase`);

            const response = await axios.post(
                `${this.baseUrl}api/merchant/v1/purchase`,
                payload,
                { headers: this.headers, timeout: this.timeout }
            );

            const data = response.data;
            console.log('[DEEMA] Purchase response:', JSON.stringify(data, null, 2));

            if (data.data && data.data.redirect_link) {
                return {
                    success: true,
                    redirectLink: data.data.redirect_link,
                    orderReference: data.data.order_reference,
                    purchaseId: data.data.purchase_id
                };
            }

            throw new Error(data.message || 'Deema purchase creation failed — no redirect link returned');

        } catch (error) {
            console.error('[DEEMA] Create purchase error:', error.response?.data || error.message);
            const errMsg = error.response?.data?.message
                || error.response?.data?.error
                || error.message;
            throw new Error(errMsg);
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
                { headers: this.headers, timeout: this.timeout }
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
