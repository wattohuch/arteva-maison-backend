/**
 * Set an account's role, out of band.
 *
 *   node src/set-role.js <email> <role>
 *   node src/set-role.js --list
 *
 * This replaces fix-owner-role.js and update-admin-to-owner.js, which each did
 * the same thing for one email address written into the file. That address is
 * not a constant — an owner can change their email, and a shop can change
 * hands — so it is an argument here and nothing is assumed about who the owner
 * is.
 *
 * Two things still need this script rather than the Users screen in the
 * dashboard:
 *
 *   - appointing the FIRST owner or superuser, when no account holds that role
 *     yet and so nobody has the standing to grant it;
 *   - `superuser`, which the API only lets an existing superuser hand out.
 *
 * Everything else — moving people between user/driver/admin/owner — is done
 * from /admin/users by an owner or superuser.
 *
 * The role is set through Mongoose (`.save()`) rather than edited by hand in
 * Atlas or Compass on purpose: a raw document edit skips schema validation, so
 * a typo like "Owner" saves without complaint and then silently fails every
 * `role === 'owner'` check in the app. The account looks right in the database
 * while revenue access and the admin sidebar stay locked.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const ROLES = User.schema.path('role').enumValues;

async function main() {
    const [emailArg, roleArg] = process.argv.slice(2);

    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI is not set. Check the .env file.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

    // `--list` is the reason this script gets run at all half the time: "who
    // holds what right now" is the question behind every role problem.
    if (emailArg === '--list') {
        const staff = await User.find({ role: { $ne: 'user' } })
            .select('name email role createdAt')
            .sort({ role: 1, createdAt: 1 })
            .lean();

        if (!staff.length) {
            console.log('No account holds a role above "user".');
        } else {
            console.log(`\n${staff.length} account(s) with a role above "user":\n`);
            for (const u of staff) {
                console.log(`  ${u.role.padEnd(10)} ${u.email.padEnd(36)} ${u.name || ''}`);
            }
        }
        await mongoose.disconnect();
        return;
    }

    if (!emailArg || !roleArg) {
        console.error('Usage: node src/set-role.js <email> <role>');
        console.error('       node src/set-role.js --list');
        console.error(`\nRoles: ${ROLES.join(', ')}`);
        process.exit(1);
    }

    if (!ROLES.includes(roleArg)) {
        console.error(`❌ "${roleArg}" is not a role. Roles: ${ROLES.join(', ')}`);
        process.exit(1);
    }

    const user = await User.findOne({ email: emailArg.toLowerCase().trim() });

    if (!user) {
        console.error(`❌ No account with email ${emailArg}. The person must register first.`);
        process.exit(1);
    }

    if (user.role === roleArg) {
        console.log(`✅ ${user.email} is already "${roleArg}" — nothing to change.`);
        await mongoose.disconnect();
        return;
    }

    // Losing the last owner locks revenue away behind a role nobody holds, so
    // say so rather than letting it happen quietly.
    if (user.role === 'owner' && roleArg !== 'owner') {
        const remaining = await User.countDocuments({ role: 'owner', _id: { $ne: user._id } });
        if (remaining === 0) {
            console.error(`❌ ${user.email} is the only owner. Appoint the new owner first, then run this again.`);
            process.exit(1);
        }
    }

    const previous = user.role;
    user.role = roleArg;
    await user.save();

    console.log(`✅ ${user.email}: ${previous} → ${roleArg}`);

    if (roleArg === 'owner') {
        console.log('\n   Revenue now belongs to this account. The first time it opens Revenue');
        console.log('   in the dashboard it will be asked to choose a revenue password.');
    }
    console.log('\n   A browser already signed in as this account cached the old role at login —');
    console.log('   log out and back in there for the change to take effect.');

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
