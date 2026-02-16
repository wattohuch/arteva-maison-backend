require('dotenv').config();
const mongoose = require('mongoose');
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

// Products matching exactly the client-side cart.js PRODUCTS array
const productData = [
    {
        name: 'Amber Crystal Candle Holder',
        nameAr: 'حامل شموع كريستال العنبر',
        price: 35.000,
        categorySlug: 'crystals',
        image: '/assets/images/products/product-01.png',
        stock: 15,
        isFeatured: true,
        isNewArrival: true
    },
    {
        name: 'Murano Wave Glass Bowls Set',
        nameAr: 'طقم أوعية زجاج مورانو',
        price: 55.000,
        categorySlug: 'glassware',
        image: '/assets/images/products/product-02.png',
        stock: 10,
        isFeatured: true
    },
    {
        name: 'Emerald Decorative Plate',
        nameAr: 'طبق ديكور زمردي',
        price: 45.000,
        categorySlug: 'plates',
        image: '/assets/images/products/product-06.png',
        stock: 12,
        isFeatured: true
    },
    {
        name: 'Botanical Relief Bowl',
        nameAr: 'وعاء بنقش نباتي',
        price: 38.000,
        categorySlug: 'bowls',
        image: '/assets/images/products/product-11.png',
        stock: 8
    },
    {
        name: 'Gilded Floral Decorative Vase',
        nameAr: 'مزهربة مذهبة بنقش زهور',
        price: 28.000,
        categorySlug: 'vases',
        image: '/assets/images/products/product-03.png',
        stock: 20,
        isFeatured: true
    },
    {
        name: 'Hand-Painted Golden Bowl',
        nameAr: 'وعاء ذهبي مرسوم يدوياً',
        price: 32.000,
        categorySlug: 'bowls',
        image: '/assets/images/products/product-04.png',
        stock: 15
    },
    {
        name: 'Amber Ruffled Bowl Set',
        nameAr: 'طقم أوعية عنبرية مموجة',
        price: 65.000,
        categorySlug: 'bowls',
        image: '/assets/images/products/product-07.png',
        stock: 6,
        isFeatured: true
    },
    {
        name: 'Ocean Blue Artisan Bowls',
        nameAr: 'أوعية فنية زرقاء',
        price: 48.000,
        categorySlug: 'bowls',
        image: '/assets/images/products/product-08.png',
        stock: 10
    },
    {
        name: 'Sunset Gradient Vase Set',
        nameAr: 'طقم مزهريات متدرجة',
        price: 85.000,
        categorySlug: 'vases',
        image: '/assets/images/products/product-09.png', // Switched to PNG
        stock: 5,
        isFeatured: true,
        isNewArrival: true
    },
    {
        name: 'Organic Form Art Bowl',
        nameAr: 'وعاء فني عضوي',
        price: 52.000,
        categorySlug: 'bowls',
        image: '/assets/images/products/product-10.png',
        stock: 7
    },
    {
        name: 'Cobalt Sunburst Plate',
        nameAr: 'طبق أشعة الشمس الأزرق',
        price: 42.000,
        categorySlug: 'plates',
        image: '/assets/images/products/product-12.jpeg', // No PNG available
        stock: 12,
        isNewArrival: true
    },
    {
        name: 'Autumn Leaves Vase Collection',
        nameAr: 'مجموعة مزهريات أوراق الخريف',
        price: 68.000,
        categorySlug: 'vases',
        image: '/assets/images/products/product-13.jpeg', // No PNG available
        stock: 4
    },
    {
        name: 'Floral Cylinder Vase',
        nameAr: 'مزهربة أسطوانية بنقش زهور',
        price: 24.000,
        categorySlug: 'vases',
        image: '/assets/images/products/product-05.png',
        stock: 18
    },
    {
        name: 'Artisan Glassware Collection',
        nameAr: 'مجموعة الأواني الزجاجية الفنية',
        price: 75.000,
        categorySlug: 'glassware',
        image: '/assets/images/hero/hero-bg.png',
        stock: 3,
        isFeatured: true
    }
];

const seedProducts = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        console.log('Deleting old data...');
        await Category.deleteMany({});
        await Product.deleteMany({});

        console.log('Creating categories...');
        const createdCategories = await Category.insertMany(categories);
        console.log(`Created ${createdCategories.length} categories.`);

        console.log('Creating products...');
        const createdProducts = [];

        for (const pd of productData) {
            const category = createdCategories.find(c => c.slug === pd.categorySlug);
            if (!category) {
                console.warn(`Category '${pd.categorySlug}' not found for product '${pd.name}', skipping...`);
                continue;
            }

            const product = await Product.create({
                name: pd.name,
                nameAr: pd.nameAr,
                price: pd.price,
                category: category._id,
                images: [{ url: pd.image, isPrimary: true }],
                stock: pd.stock || 10,
                isFeatured: pd.isFeatured || false,
                isNewArrival: pd.isNewArrival || false,
                isActive: true
            });
            createdProducts.push(product);
            console.log(`  ✓ Created: ${product.name}`);
        }

        console.log(`\nSUCCESS: Created ${createdProducts.length} products.`);
        console.log('\nProducts in database:');
        createdProducts.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p._id})`));

        process.exit(0);
    } catch (err) {
        console.error('FAIL:', err);
        process.exit(1);
    }
};

seedProducts();
