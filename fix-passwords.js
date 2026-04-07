require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const fixPasswords = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const User = require('./src/models/User');

        const users = await User.find({}).select('+password');
        let updatedCount = 0;

        const defaultPassword = 'ArtevaPassword123!';
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(defaultPassword, salt);

        for (const user of users) {
            if (!user.password) {
                console.log(`Setting default password for user: ${user.email} (${user.role})`);
                
                await User.collection.updateOne(
                    { _id: user._id },
                    { $set: { password: hashedPassword } }
                );
                updatedCount++;
            }
        }

        console.log(`\n✅ Fixed passwords for ${updatedCount} users.`);
        console.log(`The temporary password for these accounts is: ${defaultPassword}`);
        console.log(`Please login and change your password in the dashboard or checkout.`);
        
        process.exit(0);
    } catch (error) {
        console.error('Error fixing passwords:', error);
        process.exit(1);
    }
};

fixPasswords();
