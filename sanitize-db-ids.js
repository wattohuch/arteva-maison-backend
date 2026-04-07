require('dotenv').config();
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

// Fix String ObjectIds across all collections
const sanitizeDatabaseIds = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const db = mongoose.connection.db;
        console.log('✅ Connected to MongoDB to sanitize data types');

        const collections = ['users', 'products', 'categories', 'orders', 'carts'];

        for (const collectionName of collections) {
            console.log(`\n🔄 Scanning collection: ${collectionName}...`);
            const collection = db.collection(collectionName);
            const docs = await collection.find({}).toArray();

            let convertedCount = 0;

            for (const doc of docs) {
                const updates = {};
                let hasUpdates = false;

                // Helper to validate and convert string to ObjectId securely
                const convertToObjectId = (value) => {
                    if (typeof value === 'string' && ObjectId.isValid(value) && value.length === 24) {
                        return new ObjectId(value);
                    }
                    return null;
                };

                // 1. Process root level _id, category, user
                if (typeof doc._id === 'string') {
                    updates._id = convertToObjectId(doc._id) || doc._id;
                    hasUpdates = true;
                }
                if (doc.category && typeof doc.category === 'string') {
                    updates.category = convertToObjectId(doc.category) || doc.category;
                    hasUpdates = true;
                }
                if (doc.user && typeof doc.user === 'string') {
                    updates.user = convertToObjectId(doc.user) || doc.user;
                    hasUpdates = true;
                }

                // 2. Process nested object IDs (like addresses._id, items.product, images._id)
                if (doc.addresses && Array.isArray(doc.addresses)) {
                    let addressChanged = false;
                    const cleanAddresses = doc.addresses.map(addr => {
                        if (typeof addr._id === 'string') {
                            addr._id = convertToObjectId(addr._id) || addr._id;
                            addressChanged = true;
                        }
                        return addr;
                    });
                    if (addressChanged) {
                        updates.addresses = cleanAddresses;
                        hasUpdates = true;
                    }
                }

                if (doc.images && Array.isArray(doc.images)) {
                    let imagesChanged = false;
                    const cleanImages = doc.images.map(img => {
                        if (typeof img._id === 'string') {
                            img._id = convertToObjectId(img._id) || img._id;
                            imagesChanged = true;
                        }
                        return img;
                    });
                    if (imagesChanged) {
                        updates.images = cleanImages;
                        hasUpdates = true;
                    }
                }

                if (doc.items && Array.isArray(doc.items)) {
                    let itemsChanged = false;
                    const cleanItems = doc.items.map(item => {
                        if (item.product && typeof item.product === 'string') {
                            item.product = convertToObjectId(item.product) || item.product;
                            itemsChanged = true;
                        }
                        if (item._id && typeof item._id === 'string') {
                            item._id = convertToObjectId(item._id) || item._id;
                            itemsChanged = true;
                        }
                        return item;
                    });
                    if (itemsChanged) {
                        updates.items = cleanItems;
                        hasUpdates = true;
                    }
                }

                // Execute the update
                if (hasUpdates) {
                    if (updates._id) {
                        // Dealing with _id requires creating a new document and deleting the old one
                        // since MongoDB does not allow mutating _id fields directly
                        const oldId = doc._id;
                        const newDoc = { ...doc, ...updates };
                        
                        await collection.deleteOne({ _id: oldId });
                        await collection.insertOne(newDoc);
                    } else {
                        // Normal update
                        await collection.updateOne({ _id: doc._id }, { $set: updates });
                    }
                    convertedCount++;
                }
            }

            if (convertedCount > 0) {
                console.log(`  ✅ Converted String IDs to ObjectIds in ${convertedCount} documents`);
            } else {
                console.log(`  👍 No string conversions needed`);
            }
        }

        console.log('\n🎉 ALL COLLECTIONS SANITIZED SUCCESSFULLY!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error sanitizing database:', error);
        process.exit(1);
    }
};

sanitizeDatabaseIds();
