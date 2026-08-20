/**
 * Backfill `items.stockHeld` and `stockLedgerVersion` on existing orders.
 *
 *   node scripts/backfill-stock-ledger.js            # dry run, changes nothing
 *   node scripts/backfill-stock-ledger.js --apply    # write it
 *
 * ── Why this exists ──
 *
 * Orders written before the stock ledger deducted inventory without recording
 * how much each line had taken. Every line therefore stores `stockHeld: 0` —
 * the schema default — which is indistinguishable from "this line is holding
 * nothing". Refunds reconcile against that number, so refunding an old order
 * computed a delta of 0 and put nothing back on the shelf.
 *
 * The application no longer depends on this script: `stockService.currentHoldings`
 * infers a legacy order's true holdings on the fly and stamps it the first time
 * its stock is touched. Running this is still worth doing, because it:
 *
 *   · converts the whole collection in one pass instead of one order at a time,
 *     so the inference is made once and then never again;
 *   · prints exactly what it would change before it changes anything;
 *   · reports how far stock has already drifted, which is the number the shop
 *     needs in order to decide whether a stocktake is due.
 *
 * ── What it assumes ──
 *
 * For a legacy order, a line is treated as still holding its full quantity
 * unless the order was cancelled or the line was already flagged refunded — in
 * which case the old code had its chance to restore and whatever it did has
 * already happened. That is the conservative reading in both directions: it
 * never restores stock twice for a refund that was already settled, and never
 * leaves a live line recorded as holding nothing.
 *
 * ── What it deliberately does NOT do ──
 *
 * It does not correct stock for refunds that the old code failed to restore.
 * Those units were never credited back, so the recorded stock for the affected
 * products is lower than what is physically on the shelf. Correcting that
 * automatically would mean inventing inventory from an assumption about what
 * happened months ago. The drift is REPORTED instead (see the summary at the
 * end) so it can be settled against a real count.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Check the .env file.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

    const Order = require('../src/models/Order');
    const { STOCK_LEDGER_VERSION } = require('../src/services/stockService');

    const legacy = await Order.find({
        $or: [
            { stockLedgerVersion: { $exists: false } },
            { stockLedgerVersion: { $lt: STOCK_LEDGER_VERSION } },
        ],
    }).select('orderNumber orderStatus orderSource items createdAt').lean();

    console.log(
        `\n${legacy.length} order(s) predate the stock ledger.` +
        (APPLY ? '' : '  (dry run — pass --apply to write)\n')
    );

    if (!legacy.length) {
        await mongoose.disconnect();
        return;
    }

    let updated = 0;
    /** productId -> units that a past refund should have restored but did not. */
    const unrestored = new Map();

    for (const order of legacy) {
        const cancelled = order.orderStatus === 'cancelled';

        const holdings = (order.items || []).map(item => {
            const qty = Math.max(0, Number(item.quantity) || 0);
            const held = (item.isRefunded || cancelled) ? 0 : qty;

            // A refunded line on a legacy order is where stock went missing:
            // the old refund path never credited it back.
            if (item.isRefunded && item.product && !cancelled) {
                const key = String(item.product);
                unrestored.set(key, (unrestored.get(key) || 0) + qty);
            }

            return { _id: item._id, stockHeld: held };
        });

        if (APPLY) {
            const doc = await Order.findById(order._id);
            if (!doc) continue;
            for (const holding of holdings) {
                const line = doc.items.id(holding._id);
                if (line) line.stockHeld = holding.stockHeld;
            }
            doc.stockLedgerVersion = STOCK_LEDGER_VERSION;
            await doc.save({ validateBeforeSave: false });
        }

        updated++;

        if (updated <= 10) {
            const summary = holdings.map(h => h.stockHeld).join(', ');
            console.log(
                `  ${order.orderNumber || order._id}  ${String(order.orderSource || 'online').padEnd(6)}` +
                `  ${String(order.orderStatus || '').padEnd(16)}  holds [${summary}]`
            );
        }
    }

    if (updated > 10) console.log(`  … and ${updated - 10} more`);

    console.log(`\n${APPLY ? 'Stamped' : 'Would stamp'} ${updated} order(s) at ledger version ${STOCK_LEDGER_VERSION}.`);

    if (unrestored.size) {
        const Product = require('../src/models/Product');
        const products = await Product.find({ _id: { $in: [...unrestored.keys()] } })
            .select('name sku stock')
            .lean();

        console.log(
            `\n── Stock never returned by past refunds ──\n` +
            `These units were refunded before the fix, so they were taken off the\n` +
            `shelf and never credited back. Recorded stock is lower than reality by:\n`
        );
        for (const product of products) {
            const missing = unrestored.get(String(product._id));
            console.log(
                `  ${(product.sku || '—').padEnd(12)} ${(product.name || '').slice(0, 40).padEnd(42)}` +
                ` recorded ${String(product.stock).padStart(4)}  short by ${missing}`
            );
        }
        console.log(
            `\nNot corrected automatically: that would be inventing inventory from an\n` +
            `assumption. Settle it against a physical count and adjust the stock\n` +
            `figures from the Products screen.\n`
        );
    } else {
        console.log('\nNo refunds went unrestored — nothing to reconcile.\n');
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
