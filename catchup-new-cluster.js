/**
 * ============================================================
 * ARTEVA Maison — Post-Migration Catch-Up Script
 * ============================================================
 * 
 * Applies ALL changes that happened after the Feb 18 backup:
 * 
 *   1. Fix product image paths (hero-bg → product-14, .jpeg → .png)
 *   2. Upload ALL product images to Cloudinary (persistent CDN)
 *   3. Update all product image URLs to Cloudinary
 *   4. Update order item images to Cloudinary
 *   5. Update user roles (admin@arteva.com → owner, mohammadalawaji2 → owner)
 *   6. Add missing Arabic descriptions to products
 *   7. Add missing SKUs to products
 * 
 * Usage: node catchup-new-cluster.js
 * ============================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');

// ============================================================
// CONFIGURATION
// ============================================================

const NEW_URI = process.env.MONGODB_URI;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const LOCAL_IMAGES_DIR = path.join(__dirname, 'arteva-maison-frontend', 'assets', 'images', 'products');
// Try alternative path if first doesn't exist
const ALT_IMAGES_DIR = path.join(__dirname, '..', 'arteva-maison-frontend', 'assets', 'images', 'products');

function getImagesDir() {
    if (fs.existsSync(LOCAL_IMAGES_DIR)) return LOCAL_IMAGES_DIR;
    if (fs.existsSync(ALT_IMAGES_DIR)) return ALT_IMAGES_DIR;
    return null;
}

// SKU mapping for products (by name)
const SKU_MAP = {
    'Amber Crystal Candle Holder': 'HJ38020-L',
    'Murano Wave Glass Bowls Set': 'HJ37854-28',
    'Emerald Decorative Plate': 'HJ38312-18',
    'Botanical Relief Bowl': 'HJ38312-19',
    'Gilded Floral Decorative Vase': 'HJ38312-20',
    'Hand-Painted Golden Bowl': 'HJ38312-21',
    'Amber Ruffled Bowl Set': 'HJ38312-22',
    'Ocean Blue Artisan Bowls': 'HJ38312-23',
};

// Arabic descriptions (by SKU)
const ARABIC_UPDATES = {
    'HJ38020-L': {
        nameAr: 'حامل شموع كريستال عنبري',
        descriptionAr: 'اكتشف الحرفية الاستثنائية لحامل الشموع الكريستالي العنبري الرائع هذا. تم اختيار كل قطعة بعناية لإضفاء الأناقة والرقي على منزلك. مصنوعة يدوياً بعناية فائقة، تمثل هذه القطعة الأفضل في ديكور المنزل الفاخر.'
    },
    'HJ37854-28': {
        nameAr: 'طقم أوعية زجاج مورانو',
        descriptionAr: 'طقم أوعية زجاج مورانو الأنيق، مثالي للتقديم أو العرض. تتميز كل وعاء بأنماط موجية فريدة ووضوح استثنائي. إضافة مذهلة لأي مساحة طعام أو معيشة.'
    },
    'HJ38312-18': {
        nameAr: 'طبق ديكور زمردي',
        descriptionAr: 'طبق ديكور زمردي مذهل بتفاصيل معقدة. مثالي للعرض على الحائط أو كقطعة مركزية. تضيف الدرجات الخضراء الغنية لمسة من الفخامة لأي غرفة.'
    },
    'HJ38312-19': {
        nameAr: 'وعاء نقش نباتي',
        descriptionAr: 'وعاء نقش نباتي جميل يتميز بأنماط أوراق دقيقة. مصنوع يدوياً بدقة، تجمع هذه القطعة بين الوظيفة والجمال الفني. مثالي للتقديم أو العرض.'
    },
    'HJ38312-20': {
        nameAr: 'مزهرية مذهبة بنقش زهور',
        descriptionAr: 'مزهرية مذهبة رائعة بنقوش زهور معقدة. قطعة فنية حقيقية تضيف لمسة من الفخامة لأي مساحة. مثالية للمناسبات الخاصة أو كقطعة مركزية.'
    },
    'HJ38312-21': {
        nameAr: 'وعاء ذهبي مرسوم يدوياً',
        descriptionAr: 'وعاء ذهبي مرسوم يدوياً بتصميم فريد. كل قطعة هي عمل فني يجمع بين الحرفية التقليدية والتصميم المعاصر.'
    },
    'HJ38312-22': {
        nameAr: 'طقم أوعية عنبرية مموجة',
        descriptionAr: 'طقم أوعية عنبرية مموجة بتصميم عصري. مثالي للتقديم أو العرض، يضيف دفئاً وأناقة لأي طاولة.'
    },
    'HJ38312-23': {
        nameAr: 'أوعية فنية زرقاء',
        descriptionAr: 'أوعية فنية زرقاء بتصميم عضوي فريد. مصنوعة من زجاج عالي الجودة، تجمع بين الجمال والوظيفة.'
    }
};

// Seed-products.js descriptions (missing from backup since original seed didn't include them)
const PRODUCT_DESCRIPTIONS = {
    'Amber Crystal Candle Holder': 'Discover the exceptional craftsmanship of this stunning amber crystal candle holder. Each piece is carefully selected to bring elegance and sophistication to your home.',
    'Murano Wave Glass Bowls Set': 'An elegant set of Murano wave glass bowls, perfect for serving or display. Each bowl features unique wave patterns and exceptional clarity.',
    'Emerald Decorative Plate': 'A stunning emerald decorative plate with intricate details. Perfect for wall display or as a centerpiece. The rich green tones add a touch of luxury to any room.',
    'Botanical Relief Bowl': 'A beautiful botanical relief bowl featuring delicate leaf patterns. Handcrafted with precision, this piece combines function with artistic beauty.',
    'Gilded Floral Decorative Vase': 'A magnificent gilded vase with intricate floral engravings. A true work of art that adds a touch of luxury to any space.',
    'Hand-Painted Golden Bowl': 'A hand-painted golden bowl with a unique design. Each piece is a work of art combining traditional craftsmanship with contemporary design.',
    'Amber Ruffled Bowl Set': 'An amber ruffled bowl set with a modern design. Perfect for serving or display, adding warmth and elegance to any table.',
    'Ocean Blue Artisan Bowls': 'Ocean blue artisan bowls with a unique organic design. Made from high-quality glass, combining beauty and functionality.',
    'Sunset Gradient Vase Set': 'A breathtaking set of vases featuring stunning sunset gradient colors. Each piece transitions from warm amber to deep burgundy.',
    'Organic Form Art Bowl': 'An artistic bowl with organic flowing forms. This statement piece brings a sculptural element to your home decor.',
    'Cobalt Sunburst Plate': 'A striking cobalt blue plate with a radiating sunburst pattern. The deep blue tones create a mesmerizing visual effect.',
    'Autumn Leaves Vase Collection': 'A collection of vases inspired by autumn foliage. Rich amber and golden tones capture the warmth of fall.',
    'Floral Cylinder Vase': 'A cylindrical vase with delicate floral engravings. Perfect for fresh or dried flower arrangements.',
    'Artisan Glassware Collection': 'A curated collection of artisan glassware featuring unique handcrafted designs. Each piece is a masterwork of glass art.',
    'Royal Azure Centerpiece': 'A stunning centerpiece featuring deep azure hues and intricate gold detailing. Perfect for adding a touch of royalty to your dining experience.'
};

// ============================================================
// LOGGING
// ============================================================

function log(level, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] [${level}] ${msg}`);
}

// ============================================================
// UPLOAD TO CLOUDINARY
// ============================================================

async function uploadFileToCloudinary(filePath, folder, publicId) {
    const options = {
        folder: `arteva/${folder}`,
        resource_type: 'image',
        quality: 'auto',
        fetch_format: 'auto'
    };
    if (publicId) {
        options.public_id = publicId;
        options.overwrite = true;
    }
    const result = await cloudinary.uploader.upload(filePath, options);
    return { url: result.secure_url, publicId: result.public_id };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    log('INFO', '╔══════════════════════════════════════════════════════╗');
    log('INFO', '║  ARTEVA Maison — Post-Migration Catch-Up Script     ║');
    log('INFO', '╚══════════════════════════════════════════════════════╝');
    log('INFO', '');

    // Connect
    await mongoose.connect(NEW_URI);
    log('INFO', '✅ Connected to new cluster');

    const Product = require('./src/models/Product');
    const Category = require('./src/models/Category');
    const Order = require('./src/models/Order');
    const User = require('./src/models/User');

    // ── STEP 1: Fix product image paths ──────────────────────
    log('INFO', '');
    log('INFO', '═══ STEP 1: Fix product image paths ═══');

    // Fix Artisan Glassware Collection (wrong image: hero-bg.png → product-14.png)
    const artisan = await Product.findOne({ name: 'Artisan Glassware Collection' });
    if (artisan) {
        if (artisan.images?.[0]?.url?.includes('hero-bg')) {
            await Product.updateOne(
                { _id: artisan._id },
                { $set: { 'images.0.url': '/assets/images/products/product-14.png' } }
            );
            log('INFO', '  ✅ Fixed Artisan Glassware Collection image: hero-bg → product-14.png');
        } else {
            log('INFO', '  ✅ Artisan Glassware Collection image already correct');
        }
    }

    // Fix Royal Azure Centerpiece (wrong extension: .jpeg → .png)
    const royal = await Product.findOne({ name: 'Royal Azure Centerpiece' });
    if (royal) {
        if (royal.images?.[0]?.url?.includes('.jpeg')) {
            const fixedUrl = royal.images[0].url.replace('.jpeg', '.png');
            await Product.updateOne(
                { _id: royal._id },
                { $set: { 'images.0.url': fixedUrl } }
            );
            log('INFO', '  ✅ Fixed Royal Azure Centerpiece image: .jpeg → .png');
        } else {
            log('INFO', '  ✅ Royal Azure Centerpiece image already correct');
        }
    }

    // ── STEP 2: Upload images to Cloudinary ──────────────────
    log('INFO', '');
    log('INFO', '═══ STEP 2: Upload product images to Cloudinary ═══');

    const imagesDir = getImagesDir();
    const urlMap = {};

    if (!imagesDir) {
        log('ERROR', '  ❌ Cannot find local product images directory');
        log('ERROR', `    Tried: ${LOCAL_IMAGES_DIR}`);
        log('ERROR', `    Tried: ${ALT_IMAGES_DIR}`);
        log('WARN', '  ⚠️  Skipping Cloudinary upload — images will use local paths');
    } else {
        log('INFO', `  📁 Images directory: ${imagesDir}`);

        const files = fs.readdirSync(imagesDir).filter(f =>
            /\.(png|jpg|jpeg|webp)$/i.test(f)
        );

        log('INFO', `  📷 Found ${files.length} images to upload`);
        log('INFO', '');

        for (const file of files) {
            const filePath = path.join(imagesDir, file);
            const baseName = path.parse(file).name;

            try {
                const result = await uploadFileToCloudinary(filePath, 'products', baseName);

                // Map all common old path formats
                urlMap[`/assets/images/products/${file}`] = result.url;
                urlMap[`assets/images/products/${file}`] = result.url;
                // Also map other extensions
                for (const ext of ['.png', '.jpg', '.jpeg']) {
                    urlMap[`/assets/images/products/${baseName}${ext}`] = result.url;
                }

                log('INFO', `  ✅ ${file} → ${result.url}`);
            } catch (err) {
                log('ERROR', `  ❌ Failed: ${file} — ${err.message}`);
            }
        }

        log('INFO', `  📊 Uploaded ${Object.keys(urlMap).length} URL mappings`);
    }

    // ── STEP 3: Update product image URLs in database ────────
    log('INFO', '');
    log('INFO', '═══ STEP 3: Update product image URLs to Cloudinary ═══');

    if (Object.keys(urlMap).length > 0) {
        const products = await Product.find({});
        let updatedProducts = 0;

        for (const product of products) {
            let changed = false;
            const updatedImages = [];

            if (product.images && product.images.length > 0) {
                for (const img of product.images) {
                    const imgObj = { ...img.toObject() };
                    if (imgObj.url && !imgObj.url.includes('cloudinary.com') && urlMap[imgObj.url]) {
                        log('INFO', `  📝 ${product.name}: ${imgObj.url} → Cloudinary`);
                        imgObj.url = urlMap[imgObj.url];
                        changed = true;
                    }
                    updatedImages.push(imgObj);
                }
            }

            if (changed) {
                await Product.updateOne(
                    { _id: product._id },
                    { $set: { images: updatedImages } }
                );
                updatedProducts++;
            }
        }

        log('INFO', `  ✅ Updated ${updatedProducts} products with Cloudinary URLs`);
    } else {
        log('WARN', '  ⚠️  No URL mappings — skipping product URL update');
    }

    // ── STEP 4: Update order item images ──────────────────
    log('INFO', '');
    log('INFO', '═══ STEP 4: Update order item images to Cloudinary ═══');

    if (Object.keys(urlMap).length > 0) {
        const orders = await Order.find({});
        let updatedOrders = 0;

        for (const order of orders) {
            let changed = false;
            const updatedItems = [];

            if (order.items && order.items.length > 0) {
                for (let i = 0; i < order.items.length; i++) {
                    const item = order.items[i];
                    if (item.image && !item.image.includes('cloudinary.com') && urlMap[item.image]) {
                        log('INFO', `  📝 Order ${order.orderNumber}: ${item.image} → Cloudinary`);
                        changed = true;
                        updatedItems.push({ idx: i, url: urlMap[item.image] });
                    }
                }
            }

            if (changed) {
                const setObj = {};
                for (const u of updatedItems) {
                    setObj[`items.${u.idx}.image`] = u.url;
                }
                await Order.updateOne({ _id: order._id }, { $set: setObj });
                updatedOrders++;
            }
        }

        log('INFO', `  ✅ Updated ${updatedOrders} orders with Cloudinary URLs`);
    } else {
        log('WARN', '  ⚠️  No URL mappings — skipping order URL update');
    }

    // ── STEP 5: Update user roles ────────────────────────────
    log('INFO', '');
    log('INFO', '═══ STEP 5: Update user roles ═══');

    // admin@arteva.com → owner
    const adminUser = await User.findOne({ email: 'admin@arteva.com' }).select('+password');
    if (adminUser) {
        if (adminUser.role !== 'owner') {
            // Use updateOne to avoid triggering pre('save') password re-hash
            await User.updateOne({ email: 'admin@arteva.com' }, { $set: { role: 'owner' } });
            log('INFO', '  ✅ admin@arteva.com: role changed admin → owner');
        } else {
            log('INFO', '  ✅ admin@arteva.com: already owner');
        }
    } else {
        log('WARN', '  ⚠️  admin@arteva.com not found');
    }

    // mohammadalawaji2@gmail.com → owner
    const ownerUser = await User.findOne({ email: 'mohammadalawaji2@gmail.com' });
    if (ownerUser) {
        if (ownerUser.role !== 'owner') {
            await User.updateOne({ email: 'mohammadalawaji2@gmail.com' }, { $set: { role: 'owner' } });
            log('INFO', '  ✅ mohammadalawaji2@gmail.com: role changed admin → owner');
        } else {
            log('INFO', '  ✅ mohammadalawaji2@gmail.com: already owner');
        }
    } else {
        log('WARN', '  ⚠️  mohammadalawaji2@gmail.com not found');
    }

    // ── STEP 6: Add SKUs and Arabic descriptions ─────────────
    log('INFO', '');
    log('INFO', '═══ STEP 6: Add SKUs + Arabic descriptions + English descriptions ═══');

    const allProducts = await Product.find({});
    let skuUpdated = 0;
    let arUpdated = 0;
    let descUpdated = 0;

    for (const product of allProducts) {
        let changed = false;
        const setFields = {};

        // Add SKU if missing
        if (!product.sku && SKU_MAP[product.name]) {
            setFields.sku = SKU_MAP[product.name];
            changed = true;
            skuUpdated++;
        }

        // Add Arabic description if available (by SKU)
        const sku = product.sku || SKU_MAP[product.name];
        if (sku && ARABIC_UPDATES[sku]) {
            const update = ARABIC_UPDATES[sku];
            if (update.nameAr) setFields.nameAr = update.nameAr;
            if (update.descriptionAr) setFields.descriptionAr = update.descriptionAr;
            changed = true;
            arUpdated++;
        }

        // Add English description if missing  
        if (!product.description && PRODUCT_DESCRIPTIONS[product.name]) {
            setFields.description = PRODUCT_DESCRIPTIONS[product.name];
            changed = true;
            descUpdated++;
        }

        if (changed) {
            await Product.updateOne({ _id: product._id }, { $set: setFields });
        }
    }

    log('INFO', `  ✅ SKUs added: ${skuUpdated} products`);
    log('INFO', `  ✅ Arabic descriptions updated: ${arUpdated} products`);
    log('INFO', `  ✅ English descriptions added: ${descUpdated} products`);

    // ── STEP 7: Fix isComingSoon flags ──────────────────────
    log('INFO', '');
    log('INFO', '═══ STEP 7: Fix product flags ═══');

    // The seed script doesn't set isComingSoon, but backup has some set to true
    // The current seed script has isNewArrival for Amber Crystal and Sunset Gradient
    // Keep backup flags as-is, they reflect production state

    // Fix Sunset Gradient Vase Set stock (was 4 in backup, seed says 5)
    const sunsetVase = await Product.findOne({ name: 'Sunset Gradient Vase Set' });
    if (sunsetVase && sunsetVase.stock === 4) {
        await Product.updateOne({ _id: sunsetVase._id }, { $set: { stock: 5 } });
        log('INFO', '  ✅ Sunset Gradient Vase Set stock: 4 → 5');
    }

    // Autumn Leaves Vase Collection stock (was 3 in backup, seed says 4)
    const autumnVase = await Product.findOne({ name: 'Autumn Leaves Vase Collection' });
    if (autumnVase && autumnVase.stock === 3) {
        await Product.updateOne({ _id: autumnVase._id }, { $set: { stock: 4 } });
        log('INFO', '  ✅ Autumn Leaves Vase Collection stock: 3 → 4');
    }

    // ── SUMMARY ──────────────────────────────────────────────
    log('INFO', '');
    log('INFO', '══════════════════════════════════════════════════════');
    log('INFO', '  ✅ ALL CATCH-UP CHANGES APPLIED SUCCESSFULLY');
    log('INFO', '══════════════════════════════════════════════════════');
    log('INFO', '');

    // Final verification: list all products
    const finalProducts = await Product.find({}).sort({ createdAt: 1 });
    log('INFO', `📋 Final state: ${finalProducts.length} products in database:`);
    for (const p of finalProducts) {
        const imgHost = p.images?.[0]?.url?.includes('cloudinary') ? '☁️ Cloudinary' : '📁 Local';
        log('INFO', `  ${p.name} | ${imgHost} | SKU: ${p.sku || 'N/A'} | AR: ${p.nameAr ? '✅' : '❌'}`);
    }

    const finalUsers = await User.find({});
    log('INFO', '');
    log('INFO', `👤 Users (${finalUsers.length}):`);
    for (const u of finalUsers) {
        log('INFO', `  ${u.name} (${u.email}) — role: ${u.role}`);
    }

    await mongoose.disconnect();
    log('INFO', '');
    log('INFO', '🎉 Catch-up complete! Database is now up to date.');
    process.exit(0);
}

main().catch(err => {
    log('ERROR', `💥 CATCH-UP FAILED: ${err.message}`);
    console.error(err);
    process.exit(1);
});
