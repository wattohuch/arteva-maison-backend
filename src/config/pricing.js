/**
 * ARTEVA Maison — prices the server decides, not the client
 *
 * Anything a customer could otherwise send us a number for lives here. The
 * browser may say whether it *wants* gift wrapping; it never says what that
 * costs. A checkout that trusts a client-supplied fee is a checkout where
 * anyone can wrap an order for nothing.
 *
 * Values are read at call time so a price change is an environment variable
 * and a restart, not a deploy.
 */

/** Gift wrapping, charged once per order however many items it contains. */
function giftWrapFee() {
    const raw = Number(process.env.GIFT_WRAP_FEE);
    return Number.isFinite(raw) && raw >= 0 ? raw : 3;
}

/** Longest gift message we will store and print on a receipt. */
const GIFT_MESSAGE_MAX = 300;

/**
 * Normalise whatever the client sent into the gift-wrap fields an order
 * stores. The fee is ours; only the intent and the message come from them.
 *
 * @param {object} [input] the client's `giftWrap`, in whatever shape it arrives
 * @returns {{enabled: boolean, fee: number, message: string}}
 */
function resolveGiftWrap(input) {
    const enabled = Boolean(input && (input.enabled === true || input.enabled === 'true'));
    if (!enabled) return { enabled: false, fee: 0, message: '' };

    const message = String((input && input.message) || '')
        .trim()
        .slice(0, GIFT_MESSAGE_MAX);

    return { enabled: true, fee: giftWrapFee(), message };
}

module.exports = { giftWrapFee, resolveGiftWrap, GIFT_MESSAGE_MAX };
