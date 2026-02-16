require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const testConnection = async () => {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/arteva_maison';
        console.log('Attempting to connect to:', uri.replace(/:([^:@]+)@/, ':****@'));
        await mongoose.connect(uri);
        console.log('✅ Connection SUCCESSFUL!');
        await mongoose.connection.close();
    } catch (error) {
        console.error('❌ Connection FAILED');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error codeName:', error.codeName);
    }
};

testConnection();
