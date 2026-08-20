/**
 * ARTÉVA Maison — transaction helper.
 *
 * Stock movements and the order write that justifies them have to land
 * together. If a refund flags a line as refunded but the restore that follows
 * fails, the shelf is short a unit and nothing in the data says so.
 *
 * MongoDB only offers multi-document transactions on a replica set or a
 * sharded cluster. Atlas — which is what production runs on — is a replica set,
 * so transactions are available there. A bare `mongod` started for a local
 * checkout is not, and neither is mongodb-memory-server in its default
 * single-node mode.
 *
 * Rather than force every developer onto a replica set, or drop the guarantee
 * in production to match the weakest environment, this detects support once and
 * takes the strongest path available:
 *
 *   · transactions supported → the callback runs in a session, and either all
 *     of it commits or none of it does;
 *   · not supported → the callback runs with `session: null`. Every write it
 *     makes is still individually atomic (the stock service uses conditional
 *     `$inc` updates), and the callers all carry explicit compensating
 *     rollbacks for the multi-step case. Weaker, but not unsafe.
 *
 * The result is logged once at startup so it is never a surprise which mode a
 * deployment is in.
 */

const mongoose = require('mongoose');

/** null until probed; true/false afterwards. */
let transactionsSupported = null;

/**
 * Ask the server whether it can run a transaction, once.
 *
 * Asks `hello` and looks for a replica set name or a mongos, which is what the
 * server documents as the requirement.
 *
 * Starting and aborting an EMPTY transaction is not a valid probe — a
 * standalone mongod accepts both and only rejects the first write inside,
 * with "This MongoDB deployment does not support retryable writes". So the
 * probe passed, real work then failed, and the failure surfaced as a 500 on a
 * refund.
 */
async function supportsTransactions() {
    if (transactionsSupported !== null) return transactionsSupported;

    // Not connected yet — do not cache a "no" that only reflects the timing.
    if (mongoose.connection.readyState !== 1) return false;

    try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        // `setName` => replica set member. `msg: 'isdbgrid'` => mongos.
        transactionsSupported = Boolean(hello.setName) || hello.msg === 'isdbgrid';
    } catch {
        transactionsSupported = false;
    }

    console.log(
        transactionsSupported
            ? '[DB] Transactions available — stock and order writes are atomic together.'
            : '[DB] Transactions unavailable (standalone mongod). Stock writes remain ' +
              'individually atomic and callers compensate on failure.'
    );

    return transactionsSupported;
}

/**
 * Run `fn(session)` inside a transaction when the deployment supports one.
 *
 * `session` is null when it does not — every caller must accept that and pass
 * it straight through to Mongoose, which ignores a null session.
 *
 * @param {(session: import('mongoose').ClientSession|null) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withTransaction(fn) {
    if (!(await supportsTransactions())) {
        return fn(null);
    }

    const session = await mongoose.startSession();
    try {
        let result;
        // withTransaction retries on transient commit errors for us, which is
        // the part that is easy to get wrong by hand.
        await session.withTransaction(async () => {
            result = await fn(session);
        });
        return result;
    } finally {
        await session.endSession().catch(() => {});
    }
}

/** Test seam: forget the probe result. */
function _resetProbe() {
    transactionsSupported = null;
}

module.exports = { withTransaction, supportsTransactions, _resetProbe };
