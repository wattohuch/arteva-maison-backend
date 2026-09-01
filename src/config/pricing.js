/**
 * ARTEVA Maison — prices the server decides, not the client
 *
 * Anything a customer could otherwise send us a number for lives here. The
 * browser may say *which items* it wants wrapped; it never says what that
 * costs. A checkout that trusts a client-supplied fee is a checkout where
 * anyone can wrap an order for nothing.
 *
 * Values are read at call time so a price change is an environment variable
 * and a restart, not a deploy.
 */

/**
 * Gift wrapping, charged once per wrapped line.
 *
 * Per line, not per unit: two of the same candle ticked for wrapping is one
 * gift and one fee. Quantity is deliberately not a multiplier here — see
 * summariseGiftWrap.
 */
function giftWrapFee() {
    const raw = process.env.GIFT_WRAP_FEE;

    /* An unset variable is the normal case and falls back to 3. A variable
       that is present but empty is a misconfiguration — a blank field in a
       hosting dashboard — and Number('') is 0, which would quietly make gift
       wrapping free. Treat blank as unset rather than as zero. */
    if (raw === undefined || String(raw).trim() === '') return 3;

    const fee = Number(raw);
    return Number.isFinite(fee) && fee >= 0 ? fee : 3;
}

/** Longest gift message we will store and print on a receipt. */
const GIFT_MESSAGE_MAX = 300;

/** Whether a value the client sent means "yes, wrap this". */
function wantsWrap(value) {
    return value === true || value === 'true';
}

/**
 * Clean up a card message. Only ever a string, only ever ours to truncate.
 *
 * Guards the type as well as the length: an object arriving here used to be
 * stringified into "[object Object]" and printed on the receipt.
 */
function cleanGiftMessage(value) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, GIFT_MESSAGE_MAX);
}

/**
 * Price the wrapping for a set of order lines.
 *
 * The lines are the server's own — read from the cart or from an existing
 * order — so the count being charged for is never a number the client sent.
 * Each line whose `giftWrap` flag is set costs one `giftWrapFee()`.
 *
 * The aggregate is stored on the order as well as the per-line flags, so that
 * every receipt, email and print renderer can keep reading `order.giftWrap`
 * exactly as it did when wrapping applied to a whole order. Orders placed
 * before per-item wrapping still render correctly for the same reason.
 *
 * @param {Array<{giftWrap?: boolean}>} lines the order's items
 * @param {string} [message] the card message, if any
 * @returns {{enabled: boolean, fee: number, message: string, count: number}}
 */
function summariseGiftWrap(lines, message) {
    /* A refunded line is not charged for its wrapping.
     *
     * Only reachable from the admin edit path, where a line can be sent back
     * after the fact — a new order has nothing refunded on it. The order total
     * already subtracts a refunded line's price, so leaving its wrapping fee
     * standing would bill the customer 3 KD for wrapping a thing they
     * returned. */
    const wrapped = (Array.isArray(lines) ? lines : [])
        .filter(line => line && line.giftWrap === true && line.isRefunded !== true);
    if (wrapped.length === 0) return { enabled: false, fee: 0, message: '', count: 0 };

    return {
        enabled: true,
        fee: parseFloat((wrapped.length * giftWrapFee()).toFixed(3)),
        message: cleanGiftMessage(message),
        count: wrapped.length
    };
}

/**
 * Apply a client's per-item wrapping choice to lines the server already has.
 *
 * Matches on product id, so the client says *which* of its own cart lines to
 * wrap and nothing else. A line the client did not mention is left unwrapped
 * rather than inheriting anything.
 *
 * @param {Array} lines server-held lines, each with a `product`
 * @param {Array<{productId: string, giftWrap: boolean}>} [choices] what the client asked for
 * @returns {Array} the same lines, with `giftWrap` set
 */
function applyGiftWrapChoices(lines, choices) {
    const wanted = new Set(
        (Array.isArray(choices) ? choices : [])
            .filter(c => c && wantsWrap(c.giftWrap))
            .map(c => String(c.productId))
    );

    return (Array.isArray(lines) ? lines : []).map(line => {
        const id = line && line.product
            ? String(line.product._id || line.product)
            : null;
        return Object.assign(line, { giftWrap: id !== null && wanted.has(id) });
    });
}

/**
 * Legacy whole-order wrapping.
 *
 * Kept because orders created before per-item wrapping stored their choice
 * this way, and because an admin editing such an order still sends it in that
 * shape. New paths use summariseGiftWrap.
 */
function resolveGiftWrap(input) {
    const enabled = Boolean(input && wantsWrap(input.enabled));
    if (!enabled) return { enabled: false, fee: 0, message: '' };

    return {
        enabled: true,
        fee: giftWrapFee(),
        message: cleanGiftMessage(input && input.message)
    };
}

module.exports = {
    giftWrapFee,
    resolveGiftWrap,
    summariseGiftWrap,
    applyGiftWrapChoices,
    cleanGiftMessage,
    wantsWrap,
    GIFT_MESSAGE_MAX
};
