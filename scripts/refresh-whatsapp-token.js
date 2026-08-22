#!/usr/bin/env node
/**
 * Check the WhatsApp token and renew it if it is running out.
 *
 *   npm run wa:token              # check, renew only if due
 *   npm run wa:token -- --force   # renew now regardless
 *
 * The server does this automatically once a day. This exists for the two cases
 * automation cannot cover: verifying by hand that renewal works before trusting
 * it, and forcing a renewal after pasting in a fresh token.
 *
 * Exit codes are meaningful so a cron wrapper can alert on them:
 *   0  fine (renewed, or nothing needed)
 *   1  needs a human (invalid token, renewal failed)
 */

require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
    const force = process.argv.includes('--force');

    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set — the token is stored in the database.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const refresher = require('../src/services/whatsappTokenRefresher');
    await refresher.loadStoredToken();

    const result = await refresher.checkAndRefresh({ force });

    console.log('');
    console.log('  status   :', result.status);
    if (result.daysLeft !== undefined) console.log('  days left:', result.daysLeft);
    if (result.message) console.log('  detail   :', result.message);
    console.log('');

    await mongoose.disconnect();

    const bad = ['invalid', 'renew-failed', 'no-token', 'check-failed'];
    process.exit(bad.includes(result.status) ? 1 : 0);
})().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});
