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
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 5000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const uri = await getMongoUri();

            // Minimal options — let the driver handle Flex cluster topology discovery
            // Atlas Flex clusters use a different replica set architecture;
            // over-constraining options causes electionId/setVersion mismatches
            await mongoose.connect(uri, {
                serverSelectionTimeoutMS: 30000,   // 30s — Flex clusters can be slower to elect
                heartbeatFrequencyMS: 10000,       // Check topology every 10s (default 10s)
                maxPoolSize: 10,                   // Reasonable pool for low-resource tier
                minPoolSize: 2,                    // Keep 2 warm connections
                socketTimeoutMS: 60000,            // 60s socket timeout
                family: 4,                         // IPv4 only
                retryWrites: true,                 // Retry transient write failures
                retryReads: true,                  // Retry transient read failures
                maxIdleTimeMS: 60000,              // Close idle connections after 60s
            });

            // Connection event listeners
            mongoose.connection.on('disconnected', () => {
                console.warn('⚠️ MongoDB disconnected — driver will auto-reconnect');
            });

            mongoose.connection.on('reconnected', () => {
                console.log('✅ MongoDB reconnected');
            });

            mongoose.connection.on('error', (err) => {
                console.error('❌ MongoDB connection error:', err.message);
            });

            console.log(`✅ MongoDB connected (attempt ${attempt}/${MAX_RETRIES})`);
            return; // Success — exit retry loop

        } catch (error) {
            console.error(`❌ Database connection attempt ${attempt}/${MAX_RETRIES} failed:`);
            console.error(error.message);

            if (attempt < MAX_RETRIES) {
                console.log(`⏳ Retrying in ${RETRY_DELAY_MS / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                // Ensure clean state before retry
                try { await mongoose.disconnect(); } catch {}
            } else {
                console.error('❌ All connection attempts exhausted — exiting');
                process.exit(1);
            }
        }
    }
};

module.exports = connectDB;
