require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const seedUser = async () => {
    try {
        console.log('Connecting...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        console.log('Deleting users...');
        await User.deleteMany({});

        console.log('Creating admin...');
        const admin = await User.create({
            name: 'Admin',
            email: 'admin@arteva.com',
            password: 'admin123',
            role: 'admin'
        });

        console.log('SUCCESS: Created admin:', admin.email);
        process.exit(0);
    } catch (err) {
        console.error('FAIL:', err);
        process.exit(1);
    }
};

seedUser();
