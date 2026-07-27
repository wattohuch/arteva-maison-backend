require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

// Usage: node src/update-admin-to-owner.js [email]
// Defaults to the shop owner's account if no email is given.
//
// Set through Mongoose (`.save()`) rather than edited by hand in Atlas/Compass
// on purpose: a raw document edit skips schema validation entirely, so a typo
// like "Owner" (wrong case) or a trailing space saves without complaint and
// then silently fails every `role === 'owner'` check in the app — the account
// looks right in the DB but revenue access, the admin sidebar, etc. all stay
// locked. Going through the model guarantees the stored value is exactly one
// of the enum's literal strings.
const email = process.argv[2] || 'mohammadalawaji2@gmail.com';

const updateToOwner = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            console.log(`❌ User ${email} not found`);
            process.exit(1);
        }

        console.log(`Found user: ${user.name} (${user.email})`);
        console.log(`Current role: ${JSON.stringify(user.role)}`);

        if (user.role === 'owner') {
            console.log('✅ Role is already exactly "owner" — nothing to change.');
            console.log('   If revenue access still won\'t unlock, the account needs a fresh');
            console.log('   login (log out and back in) so the browser stops using a cached role.');
            process.exit(0);
        }

        user.role = 'owner';
        await user.save();

        console.log('✅ Successfully updated role to: owner');
        console.log(`\nEmail: ${user.email}`);
        console.log('Role: owner');
        console.log('\nNote: an already-open browser session cached the old role at login —');
        console.log('log out and back in on that account for the change to take effect there.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
};

updateToOwner();
