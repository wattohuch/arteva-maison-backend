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
 *  3. Holdings are VERSIONED. Orders written before `stockHeld` existed carry
 *     a schema default of 0 on every line, which is indistinguishable from
 *     "this line holds nothing" — so refunding one reconciled 0 against 0 and
 *     restored nothing at all. `currentHoldings` below reads those orders'
 *     true holdings from their quantities instead, and stamps them so the
 *     guess is only ever made once.
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
                /* Read what IS on the shelf so the message can say so.
                 *
                 * Only on the failure path, so the happy path still costs one
                 * write per line and no reads. "Only 2 left" is actionable;
                 * "insufficient stock" makes the customer guess. */
                const current = await Product.findById(move.productId)
                    .select('stock name')
                    .lean()
                    .catch(() => null);

                const available = Math.max(0, current?.stock ?? 0);
                const name = move.name || current?.name || 'product';

                const err = new Error(
                    available === 0
                        ? `"${name}" is out of stock.`
                        : `Only ${available} left in stock for "${name}" — ${move.delta} requested.`
                );
                err.code = 'INSUFFICIENT_STOCK';
                err.statusCode = 409;
                err.product = String(move.productId);
                err.details = {
                    productId: String(move.productId),
                    name,
                    available,
                    requested: move.delta,
                };
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

/** Current stock accounting generation. See Order.stockLedgerVersion. */
const STOCK_LEDGER_VERSION = 1;

/**
 * What an order is ACTUALLY holding right now, as a baseline to reconcile from.
 *
 * For a version-1 order this is just `stockHeld` per line — recorded when the
 * stock moved, and therefore true.
 *
 * For a legacy order it has to be inferred, because `stockHeld` on those lines
 * is a schema default rather than a measurement. What is known about them:
 *
 *   · stock WAS deducted at creation (both the old checkout and the old
 *     receipt path did that, by quantity);
 *   · a cancelled order had its stock put back by the old cancel handlers;
 *   · a line already flagged `isRefunded` predates this fix, so whatever the
 *     old code did about it has already happened.
 *
 * So a legacy line is treated as holding its full quantity unless the order was
 * cancelled or the line was already refunded, in which case it holds nothing.
 * That is the conservative reading in both directions: it never restores stock
 * twice for a refund that was already settled, and never leaves a live line
 * holding nothing when the shelf is genuinely short.
 *
 * @returns {Array} items shaped for `buildTargets` as the "current" side.
 */
function currentHoldings(order, items) {
    const lines = items || order.items || [];
    const legacy = (order.stockLedgerVersion || 0) < STOCK_LEDGER_VERSION;
    const cancelled = order.orderStatus === 'cancelled';

    return lines.map(item => ({
        product: item.product,
        name: item.name,
        quantity: item.quantity,
        isRefunded: item.isRefunded,
        stockHeld: legacy
            ? (item.isRefunded || cancelled ? 0 : Math.max(0, Number(item.quantity) || 0))
            : (Number(item.stockHeld) || 0),
    }));
}

/**
 * Snapshot an order's lines before they are mutated.
 *
 * Callers used to hand-roll this map in four places and one of them forgot a
 * field, so the reconcile it fed read a holding of `undefined`.
 */
function snapshotItems(order) {
    return currentHoldings(order);
}

/**
 * Apply `heldForLine` across an order and write the resulting holdings back
 * onto the (unsaved) order document. The caller still has to `save()`.
 *
 * Used by manual receipt create/update, refunds, cancellations and deletions
 * alike, so every path shares one definition of "correct".
 *
 * @param {Object} order
 * @param {Array}  [previousItems] holdings before this edit. Defaults to the
 *        order's own current holdings, which is right for every caller that is
 *        flipping flags in place (refund, cancel) rather than replacing lines.
 */
async function syncOrderStock(order, { previousItems, session } = {}) {
    const current = previousItems || currentHoldings(order);
    const next = order.items || [];

    const targets = buildTargets(current, next, heldForLine);
    await reconcile(targets, { session });

    // Reflect the new holdings on the order so the next reconcile has an
    // accurate baseline, and stamp it so a legacy order is only ever inferred
    // about once.
    for (const item of next) {
        item.stockHeld = isTrackedLine(item) ? heldForLine(item) : 0;
    }
    order.stockLedgerVersion = STOCK_LEDGER_VERSION;
}

/**
 * Release everything an order is holding — used when an order is cancelled or
 * deleted.
 *
 * Idempotent: the second call sees holdings of 0 and moves nothing. That is
 * what stops a double-clicked Cancel, or a status set to `cancelled` twice,
 * from crediting the shelf twice.
 */
async function releaseOrderStock(order, { session } = {}) {
    const targets = buildTargets(currentHoldings(order), [], () => 0);
    await reconcile(targets, { session });
    for (const item of order.items || []) item.stockHeld = 0;
    order.stockLedgerVersion = STOCK_LEDGER_VERSION;
}

/**
 * Re-take the stock for an order being brought back from cancelled.
 *
 * The mirror of `releaseOrderStock`. Throws INSUFFICIENT_STOCK if the units
 * have been sold in the meantime, which is the honest answer — the order
 * cannot be un-cancelled if the goods are gone.
 */
async function reclaimOrderStock(order, { session } = {}) {
    const held = currentHoldings(order).map(i => ({ ...i, stockHeld: 0 }));
    const targets = buildTargets(held, order.items || [], heldForLine);
    await reconcile(targets, { session });
    for (const item of order.items || []) {
        item.stockHeld = isTrackedLine(item) ? heldForLine(item) : 0;
    }
    order.stockLedgerVersion = STOCK_LEDGER_VERSION;
}

module.exports = {
    STOCK_LEDGER_VERSION,
    deduct,
    restore,
    reconcile,
    buildTargets,
    heldForLine,
    currentHoldings,
    snapshotItems,
    syncOrderStock,
    releaseOrderStock,
    reclaimOrderStock,
    isTrackedLine,
};
