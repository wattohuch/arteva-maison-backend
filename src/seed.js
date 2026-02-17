require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Category = require('./models/Category');
const Product = require('./models/Product');

const categories = [
    { name: 'New Arrivals', nameAr: 'جديد', slug: 'new' },
    { name: 'Crystals', nameAr: 'كريستال', slug: 'crystals' },
    { name: 'Glassware', nameAr: 'الزجاجيات', slug: 'glassware' },
    { name: 'Vases', nameAr: 'المزهريات', slug: 'vases' },
    { name: 'Bowls', nameAr: 'الأوعية', slug: 'bowls' },
    { name: 'Plates', nameAr: 'الأطباق', slug: 'plates' },
    { name: 'Serveware', nameAr: 'التقديم', slug: 'serveware' },
    { name: 'Décor', nameAr: 'ديكور', slug: 'decor' },
    { name: 'Candle Holders', nameAr: 'حاملات الشموع', slug: 'candles' },
    { name: 'Outlet', nameAr: 'التخفيضات', slug: 'outlet' }
];

const seedDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Clear existing data
        console.log('Deleting users...');
        await User.deleteMany({});
        console.log('Deleting categories...');
        await Category.deleteMany({});
        console.log('Deleting products...');
        await Product.deleteMany({});
        console.log('Cleared existing data');

        // Create admin user
        console.log('Creating admin user...');
        try {
            const adminUser = await User.create({
                name: 'Admin',
                email: 'admin@arteva.com',
                password: 'admin123',
                role: 'admin'
            });
            console.log('Created admin user:', adminUser.email);
        } catch (err) {
            console.error('Failed to create admin user:', err.message);
            // console.error(err);
        }

        // Create categories
        const createdCategories = await Category.insertMany(categories);
        console.log(`Created ${createdCategories.length} categories`);

        // Create sample products
        const products = [
            {
                name: 'Amber Crystal Candle Holder',
                nameAr: 'حامل شموع كريستال عنبري',
                description: 'Discover the exceptional craftsmanship of this exquisite amber crystal candle holder. Each piece is carefully curated to bring elegance and sophistication to your home. Handcrafted with attention to detail, this piece represents the finest in luxury home décor.',
                descriptionAr: 'اكتشف الحرفية الاستثنائية لحامل الشموع الكريستالي العنبري الرائع هذا. تم اختيار كل قطعة بعناية لإضفاء الأناقة والرقي على منزلك. مصنوعة يدوياً بعناية فائقة، تمثل هذه القطعة الأفضل في ديكور المنزل الفاخر.',
                price: 35.000,
                category: createdCategories.find(c => c.slug === 'candles')._id,
                images: [{ url: '/assets/images/products/product-01.png', isPrimary: true }],
                stock: 15,
                isFeatured: true,
                isNewArrival: true,
                sku: 'HJ38020-L'
            },
            {
                name: 'Murano Wine Glass Bowls Set',
                nameAr: 'طقم أوعية زجاج مورانو',
                description: 'Elegant Murano-style wine glass bowls set, perfect for serving or display. Each bowl features unique wave patterns and exceptional clarity. A stunning addition to any dining or living space.',
                descriptionAr: 'طقم أوعية زجاج مورانو الأنيق، مثالي للتقديم أو العرض. تتميز كل وعاء بأنماط موجية فريدة ووضوح استثنائي. إضافة مذهلة لأي مساحة طعام أو معيشة.',
                price: 55.000,
                category: createdCategories.find(c => c.slug === 'glassware')._id,
                images: [{ url: '/assets/images/products/product-02.png', isPrimary: true }],
                stock: 10,
                isFeatured: true,
                sku: 'HJ37854-28'
            },
            {
                name: 'Emerald Decorative Plate',
                nameAr: 'طبق ديكور زمردي',
                description: 'Stunning emerald decorative plate with intricate details. Perfect for wall display or as a centerpiece. The rich green tones add a touch of luxury to any room.',
                descriptionAr: 'طبق ديكور زمردي مذهل بتفاصيل معقدة. مثالي للعرض على الحائط أو كقطعة مركزية. تضيف الدرجات الخضراء الغنية لمسة من الفخامة لأي غرفة.',
                price: 45.000,
                category: createdCategories.find(c => c.slug === 'plates')._id,
                images: [{ url: '/assets/images/products/product-03.png', isPrimary: true }],
                stock: 20,
                isFeatured: true,
                sku: 'HJ38312-18'
            },
            {
                name: 'Botanical Relief Bowl',
                nameAr: 'وعاء نقش نباتي',
                description: 'Beautiful botanical relief bowl featuring delicate leaf patterns. Handcrafted with precision, this piece combines functionality with artistic beauty. Perfect for serving or display.',
                descriptionAr: 'وعاء نقش نباتي جميل يتميز بأنماط أوراق دقيقة. مصنوع يدوياً بدقة، تجمع هذه القطعة بين الوظيفة والجمال الفني. مثالي للتقديم أو العرض.',
                price: 38.000,
                category: createdCategories.find(c => c.slug === 'bowls')._id,
                images: [{ url: '/assets/images/products/product-04.png', isPrimary: true }],
                stock: 12,
                isFeatured: true,
                sku: 'HJ38372'
            },
            {
                name: 'Gilded Floral Decorative Vase',
                nameAr: 'مزهرية ذهبية زهرية',
                description: 'Exquisite gilded floral vase with golden accents. Features intricate floral patterns that catch the light beautifully. A statement piece for any elegant interior.',
                descriptionAr: 'مزهرية زهرية مذهبة رائعة بلمسات ذهبية. تتميز بأنماط زهرية معقدة تعكس الضوء بشكل جميل. قطعة مميزة لأي ديكور داخلي أنيق.',
                price: 28.000,
                category: createdCategories.find(c => c.slug === 'vases')._id,
                images: [{ url: '/assets/images/products/product-05.png', isPrimary: true }],
                stock: 8,
                isNewArrival: true,
                sku: 'HJ38316'
            },
            {
                name: 'Hand-Painted Golden Bowl',
                nameAr: 'وعاء ذهبي مرسوم يدوياً',
                description: 'Luxurious hand-painted golden bowl with artistic details. Each piece is unique, featuring hand-applied gold leaf and intricate patterns. A true work of art.',
                descriptionAr: 'وعاء ذهبي فاخر مرسوم يدوياً بتفاصيل فنية. كل قطعة فريدة من نوعها، تتميز بورق ذهبي مطبق يدوياً وأنماط معقدة. عمل فني حقيقي.',
                price: 32.000,
                category: createdCategories.find(c => c.slug === 'bowls')._id,
                images: [{ url: '/assets/images/products/product-06.png', isPrimary: true }],
                stock: 6,
                sku: 'HJ38378'
            },
            {
                name: 'Amber Ruffled Bowl Set',
                nameAr: 'طقم أوعية عنبرية مموجة',
                description: 'Elegant amber ruffled bowl set with distinctive wave edges. Perfect for serving salads, fruits, or as decorative pieces. The warm amber tones complement any table setting.',
                descriptionAr: 'طقم أوعية عنبرية مموجة أنيق بحواف موجية مميزة. مثالي لتقديم السلطات والفواكه أو كقطع ديكور. الدرجات العنبرية الدافئة تكمل أي ترتيب طاولة.',
                price: 65.000,
                category: createdCategories.find(c => c.slug === 'serveware')._id,
                images: [{ url: '/assets/images/products/product-07.png', isPrimary: true }],
                stock: 5,
                isFeatured: true,
                sku: 'HJ38312-19'
            },
            {
                name: 'Ocean Blue Artisan Bowls',
                nameAr: 'أوعية حرفية زرقاء',
                description: 'Stunning ocean blue artisan bowls with organic shapes. Each bowl is handcrafted by skilled artisans, featuring beautiful blue gradients reminiscent of ocean waves.',
                descriptionAr: 'أوعية حرفية زرقاء مذهلة بأشكال عضوية. كل وعاء مصنوع يدوياً من قبل حرفيين ماهرين، يتميز بتدرجات زرقاء جميلة تذكرنا بأمواج المحيط.',
                price: 48.000,
                category: createdCategories.find(c => c.slug === 'bowls')._id,
                images: [{ url: '/assets/images/products/product-08.png', isPrimary: true }],
                stock: 10,
                isNewArrival: true,
                sku: 'HJ38373'
            }
        ];

        // Create products one by one to ensure hooks run (for slugs)
        const createdProducts = [];
        for (const product of products) {
            const p = await Product.create(product);
            createdProducts.push(p);
        }
        console.log(`Created ${createdProducts.length} products`);

        console.log('\n✅ Database seeded successfully!');
        console.log('Admin credentials: admin@arteva.com / admin123');

        process.exit(0);
    } catch (error) {
        console.error('Error seeding database:', JSON.stringify(error, null, 2));
        console.error(error.message);
        console.error(error.stack);
        process.exit(1);
    }
};

seedDB();
