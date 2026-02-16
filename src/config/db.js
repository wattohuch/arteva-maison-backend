const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Use Google DNS - fixes Atlas SRV resolution on some networks
const mongoose = require('mongoose');

let _memoryServer = null; // keep ref so it doesn't get GC'd

// 1) Use MONGODB_URI from .env, or 2) local MongoDB, or 3) in-memory MongoDB (zero setup)
async function getMongoUri() {
    if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
    const local = 'mongodb://127.0.0.1:27017/arteva_maison';
    try {
        await mongoose.connect(local, { serverSelectionTimeoutMS: 3000 });
        await mongoose.disconnect();
        return local;
    } catch {
        // Local MongoDB not running - use in-memory server
        try {
            const { MongoMemoryServer } = require('mongodb-memory-server');
            _memoryServer = await MongoMemoryServer.create();
            const uri = _memoryServer.getUri();
            console.log('💾 Using in-memory MongoDB (data resets on restart)');
            return uri;
        } catch (e) {
            throw new Error('No MongoDB. Run: npm i mongodb-memory-server');
        }
    }
}

const connectDB = async () => {
    try {
        const uri = await getMongoUri();
        const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`MongoDB connection error: ${error.message}`);
        if (!process.env.MONGODB_URI) {
            console.error('Tip: Set MONGODB_URI in .env, or run: npm i mongodb-memory-server');
        }
        process.exit(1);
    }
};

module.exports = connectDB;
