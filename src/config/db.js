const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

let _memoryServer = null;

async function getMongoUri() {
    if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
    const local = 'mongodb://127.0.0.1:27017/arteva_maison';
    try {
        await mongoose.connect(local, { serverSelectionTimeoutMS: 3000 });
        await mongoose.disconnect();
        return local;
    } catch {
        try {
            const { MongoMemoryServer } = require('mongodb-memory-server');
            _memoryServer = await MongoMemoryServer.create();
            return _memoryServer.getUri();
        } catch (e) {
            throw new Error('No MongoDB. Run: npm i mongodb-memory-server');
        }
    }
}

const connectDB = async () => {
    try {
        const uri = await getMongoUri();
        // Optimized for low resources (512MB RAM, 0.1 CPU)
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 10000,
            maxPoolSize: 5, // Limit connection pool (default 100)
            minPoolSize: 1,
            socketTimeoutMS: 45000,
            family: 4, // Use IPv4
            maxIdleTimeMS: 30000, // Close idle connections faster
            compressors: 'zlib', // Enable compression
        });
    } catch (error) {
        process.exit(1);
    }
};

module.exports = connectDB;
