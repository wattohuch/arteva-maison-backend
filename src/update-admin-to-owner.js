require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const updateAdminToOwner = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Find admin@arteva.com and update role to owner
        const user = await User.findOne({ email: 'admin@arteva.com' });

        if (!user) {
            console.log('❌ User admin@arteva.com not found');
            process.exit(1);
        }

        console.log(`Found user: ${user.name} (${user.email})`);
        console.log(`Current role: ${user.role}`);

        user.role = 'owner';
        await user.save();

        console.log('✅ Successfully updated role to: owner');
        console.log('\nOwner credentials:');
        console.log('Email: admin@arteva.com');
        console.log('Role: owner');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
};

updateAdminToOwner();
