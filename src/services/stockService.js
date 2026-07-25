/**
 * ARTÉVA Maison — Stock Service
 *
 * Every stock mutation in the app funnels through here. Two rules make the
 * whole thing safe:
 *
 *  1. Deductions are CONDITIONAL. We never read a stock number, subtract in
 *     JavaScript and write it back — two admins saving the same receipt at the
 *     same time would both read 5, both write 3, and one sale would vanish.
 *     Instead every deduction is a single `updateOne({ stock: { $gte: n } },
 *     { $inc: { stock: -n } })`. Mongo evaluates the guard and the increment
 *     atomically, so a losing racer sees matchedCount === 0 and is told the
 *     item is out of stock.
 *
 *  2. Mutations are RECONCILING, not incremental. Callers describe the stock
 *     they want an order to hold (`stockHeld` per line) and this module works
 *     out the delta. Replaying the same save is therefore a no-op, which is
 *     what keeps webhook retries and double-clicked Save buttons harmless.
 *
 * Partial failures roll back: if line 3 of 5 cannot be deducted, the two
 * already-applied deductions are put back before the error propagates.
 */

const mongoose = require('mongoose');
const Product = require('../models/Product');

/** Products are optional on manual receipt lines (free-text items). */
function isTrackedLine(item) {
    const id = item && (item.product?._id || item.product);
    return !!id && mongoose.Types.ObjectId.isValid(String(id));
}

function productIdOf(item) {
    const id = item.product?._id || item.product;
    return new mongoose.Types.ObjectId(String(id));
}

/**
 * Take `quantity` units out of a product, but only if that many exist.
 * @returns {Promise<boolean>} false when stock was insufficient.
 */
async function deduct(productId, quantity, session) {
    if (quantity <= 0) return true;
    const res = await Product.updateOne(
        { _id: productId, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        session ? { session } : {}
    );
    return res.matchedCount > 0;
}

/** Put `quantity` units back. Always succeeds — restoring cannot go negative. */
async function restore(productId, quantity, session) {
    if (quantity <= 0) return;
    await Product.updateOne(
        { _id: productId },
        { $inc: { stock: quantity } },
        session ? { session } : {}
    );
}

/**
 * Reconcile an order's stock holdings against a target.
 *
 * `targets` is a list of `{ productId, desiredHeld, currentHeld, name }`. For
 * each entry the service moves stock by `desiredHeld - currentHeld`:
 * positive means take more out of inventory, negative means give some back.
 *
 * All restores are applied first so that an edit which swaps one product for
 * another (or reduces A while increasing B) frees inventory before trying to
 * claim it — otherwise a same-product quantity shuffle could fail against
 * stock it is itself holding.
 *
 * @returns {Promise<Array<{ productId, applied }>>} the delta actually applied
 *          per product, so the caller can write `stockHeld` back onto the order.
 * @throws  {Error} with `.code = 'INSUFFICIENT_STOCK'` and `.product` set.
 */
async function reconcile(targets, { session } = {}) {
    const moves = targets
        .map(t => ({
            ...t,
            delta: Math.round((t.desiredHeld || 0) - (t.currentHeld || 0)),
        }))
        .filter(t => t.delta !== 0);

    if (moves.length === 0) return [];

    // Restores first — they can only make the deductions below more likely to
    // succeed, and they never fail.
    const restores = moves.filter(m => m.delta < 0);
    const deducts = moves.filter(m => m.delta > 0);

    for (const move of restores) {
        await restore(move.productId, -move.delta, session);
    }

    /** Deductions already applied, so we can undo them if a later one fails. */
    const applied = [];

    try {
        for (const move of deducts) {
            const ok = await deduct(move.productId, move.delta, session);
            if (!ok) {
                const err = new Error(
                    `Insufficient stock for "${move.name || 'product'}" — ` +
                    `${move.delta} more unit(s) required.`
                );
                err.code = 'INSUFFICIENT_STOCK';
                err.statusCode = 409;
                err.product = String(move.productId);
                throw err;
            }
            applied.push(move);
        }
    } catch (err) {
        // Roll back this call's deductions AND the restores, leaving inventory
        // exactly as we found it. Without the restore rollback a failed edit
        // would silently hand stock back for lines it never actually changed.
        for (const move of applied) {
            await restore(move.productId, move.delta, session).catch(() => {});
        }
        for (const move of restores) {
            await deduct(move.productId, -move.delta, session).catch(() => {});
        }
        throw err;
    }

    return moves.map(m => ({ productId: String(m.productId), applied: m.delta }));
}

/**
 * Build reconcile targets for an order whose lines are being replaced.
 *
 * Aggregates by product because the same product can legitimately appear on
 * two lines of a receipt; stock has to be evaluated per product, not per row.
 *
 * @param {Array} currentItems items as they are stored right now (carry stockHeld)
 * @param {Array} nextItems    items the caller wants to save
 * @param {(item) => number} desiredFor how many units each next-line should hold
 */
function buildTargets(currentItems, nextItems, desiredFor) {
    const byProduct = new Map();

    const bump = (item, field, amount) => {
        if (!isTrackedLine(item)) return;
        const key = String(productIdOf(item));
        if (!byProduct.has(key)) {
            byProduct.set(key, {
                productId: productIdOf(item),
                name: item.name,
                currentHeld: 0,
                desiredHeld: 0,
            });
        }
        const entry = byProduct.get(key);
        entry[field] += amount;
        if (!entry.name && item.name) entry.name = item.name;
    };

    (currentItems || []).forEach(item => bump(item, 'currentHeld', Number(item.stockHeld) || 0));
    (nextItems || []).forEach(item => bump(item, 'desiredHeld', Math.max(0, Number(desiredFor(item)) || 0)));

    return [...byProduct.values()];
}

/**
 * How much stock a line should be holding: its full quantity, unless it has
 * been refunded — a refunded line has gone back on the shelf.
 */
function heldForLine(item) {
    if (item.isRefunded) return 0;
    return Math.max(0, Number(item.quantity) || 0);
}

/**
 * Apply `heldForLine` across an order and write the resulting holdings back
 * onto the (unsaved) order document. The caller still has to `save()`.
 *
 * Used by manual receipt create/update, refunds and deletions alike, so all
 * four paths share one definition of "correct".
 */
async function syncOrderStock(order, { previousItems, session } = {}) {
    const current = previousItems || [];
    const next = order.items || [];

    const targets = buildTargets(current, next, heldForLine);
    await reconcile(targets, { session });

    // Reflect the new holdings on the order so the next reconcile has an
    // accurate baseline.
    for (const item of next) {
        item.stockHeld = isTrackedLine(item) ? heldForLine(item) : 0;
    }
}

/**
 * Release everything an order is holding — used when an order is deleted.
 * Safe to call twice: the second call sees stockHeld = 0 and does nothing.
 */
async function releaseOrderStock(order, { session } = {}) {
    const targets = buildTargets(order.items || [], [], () => 0);
    await reconcile(targets, { session });
    for (const item of order.items || []) item.stockHeld = 0;
}

module.exports = {
    deduct,
    restore,
    reconcile,
    buildTargets,
    heldForLine,
    syncOrderStock,
    releaseOrderStock,
    isTrackedLine,
};
