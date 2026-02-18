require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');
const Category = require('./models/Category');

const addProduct14 = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        // Find Category - preferring 'New Arrivals' or 'Decor'
        let category = await Category.findOne({ slug: 'new' });
        if (!category) {
            console.log("New Arrivals category not found, checking 'decor'...");
            category = await Category.findOne({ slug: 'decor' });
        }

        if (!category) {
            console.error("Could not find suitable category (new or decor). Aborting.");
            process.exit(1);
        }

        console.log(`Using category: ${category.name} (${category._id})`);

        const productData = {
            name: 'Royal Azure Centerpiece',
            nameAr: 'تحفة أزرق ملكي',
            description: 'A stunning centerpiece featuring deep azure hues and intricate gold detailing. Perfect for adding a touch of royalty to your dining experience.',
            descriptionAr: 'قطعة مركزية مذهلة تتميز بألوان زرقاء عميقة وتفاصيل ذهبية دقيقة. مثالية لإضفاء لمسة ملكية على تجربة تناول الطعام الخاصة بك.',
            price: 120.000,
            category: category._id,
            images: [{ url: '/assets/images/products/product-14.jpeg', isPrimary: true }],
            stock: 5,
            isActive: true,
            isNewArrival: true,
            sku: 'PROD-14-' + Date.now() // Unique SKU
        };

        const newProduct = await Product.create(productData);
        console.log(`Successfully created product: ${newProduct.name}`);
        console.log(newProduct);

        process.exit(0);
    } catch (error) {
        console.error('Error adding product:', error);
        process.exit(1);
    }
};

addProduct14();
