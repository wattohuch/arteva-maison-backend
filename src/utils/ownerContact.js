/**
 * Where mail meant for "the shop owner" should actually go.
 *
 * The address used to be written into the code — a different literal in each
 * feature that needed it. That works exactly until the owner changes their
 * email or the shop changes hands, and then it fails silently: a message sent
 * to a stale mailbox still reports success, so nobody finds out until someone
 * notices they stopped receiving something.
 *
 * The owner *account* is the source of truth instead: whoever holds the `owner`
 * role is who the shop's mail belongs to, and changing the email on that
 * account is all it takes to redirect it. OWNER_EMAIL overrides the lookup for
 * environments where the owner account is not the right mailbox — staging, or
 * a shared inbox the owner reads with staff.
 */
const User = require('../models/User');

// The owner changes about never, and this sits on the path of every contact
// form submission, so a short cache saves a query per message without being
// able to stay wrong for long.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = { email: null, at: 0 };

/**
 * @returns {Promise<string|null>} the owner's email, or null if the shop has no
 * owner account and no override is configured — callers must handle that
 * rather than mailing into the void.
 */
async function getOwnerEmail() {
    if (process.env.OWNER_EMAIL) return process.env.OWNER_EMAIL.trim();

    if (cached.email && Date.now() - cached.at < CACHE_TTL_MS) return cached.email;

    try {
        // Oldest owner account wins when there is more than one, so adding a
        // second owner cannot quietly redirect the shop's mail away from the
        // person who has been receiving it.
        const owner = await User.findOne({ role: 'owner' })
            .sort({ createdAt: 1 })
            .select('email')
            .lean();

        if (owner?.email) {
            cached = { email: owner.email, at: Date.now() };
            return owner.email;
        }
    } catch (err) {
        console.error('[OWNER] Could not resolve owner email:', err.message);
        // A database blip should not lose a customer's message: fall through to
        // the last address we successfully resolved, stale or not.
    }

    return cached.email || null;
}

/** Called after a role or email change so the next lookup re-reads the account. */
function clearOwnerEmailCache() {
    cached = { email: null, at: 0 };
}

module.exports = { getOwnerEmail, clearOwnerEmailCache };
