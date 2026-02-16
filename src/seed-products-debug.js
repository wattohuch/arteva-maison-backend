require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const Category = require('./models/Category');
const Product = require('./models/Product');

const log = (msg) => {
    console.log(msg);
    fs.appendFileSync('seed-log.txt', msg + '\n');
};

const categories = [
    { name: 'Candles', nameAr: 'شموع', slug: 'candles' } // Simplified
];

const seedProducts = async () => {
    try {
        fs.writeFileSync('seed-log.txt', 'Starting...\n');
        log('Connecting...');
        await mongoose.connect(process.env.MONGODB_URI);
        log('Connected.');

        log('Deleting old data...');
        await Category.deleteMany({});
        await Product.deleteMany({});

        log('Creating category...');
        const createdCategories = await Category.insertMany(categories);
        log(`Created category: ${createdCategories[0].name} (${createdCategories[0]._id})`);

        log('Creating product...');
        const product = {
            name: 'Amber Crystal Candle Holder',
            nameAr: 'حامل شموع كريستال عنبري',
            price: 35.000,
            category: createdCategories[0]._id,
            images: [{ url: '/assets/images/products/product-01.png', isPrimary: true }],
            stock: 15,
            isFeatured: true,
            isNewArrival: true,
            sku: 'HJ38020-L'
        };

        log('Product data: ' + JSON.stringify(product));

        await Product.create(product);
        log('SUCCESS: Created product.');
        process.exit(0);
    } catch (err) {
        log('FAIL: ' + err.message);
        if (err.errors) {
            Object.keys(err.errors).forEach(key => {
                log(`Validation Error [${key}]: ${err.errors[key].message}`);
            });
        }
        process.exit(1);
    }
};

seedProducts();
