/**
 * Frontend return URLs for payment gateway redirects.
 *
 * The storefront is a React SPA using client-side routes (`/order-success`,
 * `/payment-error`, `/payment-pending`). Every gateway redirect used to point at
 * the pre-migration static pages (`/order-success.html`, …), so shoppers landed
 * on a 404 immediately after paying. Building the URLs here keeps the routes in
 * one place and guarantees the query strings are encoded.
 */

function base() {
    const url = process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com';
    return url.replace(/\/+$/, '');
}

function build(path, params = {}) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    }
    const query = qs.toString();
    return `${base()}${path}${query ? `?${query}` : ''}`;
}

const frontendUrls = {
    orderSuccess: (orderNumber) => build('/order-success', { order: orderNumber }),

    paymentError: ({ error, status, order } = {}) =>
        build('/payment-error', { error, status, order }),

    paymentPending: (orderNumber) => build('/payment-pending', { order: orderNumber }),

    /** Generic error landing handed to gateways as their ErrorUrl. */
    gatewayErrorUrl: () => build('/payment-error', { error: 'gateway_error' }),

    home: () => build('/'),
};

module.exports = frontendUrls;
