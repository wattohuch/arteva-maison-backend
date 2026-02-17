# Update Products with Arabic Descriptions

## Problem
Product descriptions were showing in English even when the website was in Arabic mode because the database products didn't have Arabic descriptions.

## Solution
Updated the seed file to include both English and Arabic descriptions for all products.

## How to Update Your Database

### Option 1: Re-seed Database (Recommended for Development)

**Warning:** This will delete ALL existing data (users, products, orders)!

```bash
cd arteva-maison-backend
npm run seed
```

This will:
- Delete all existing data
- Create fresh categories with Arabic names
- Create products with both English and Arabic descriptions
- Create admin user (admin@arteva.com / admin123)

### Option 2: Update Existing Products (Production Safe)

If you have existing orders and don't want to lose data, you can manually update products through the admin panel:

1. Go to: https://www.artevamaisonkw.com/admin.html
2. Login as admin
3. Click on "Products" tab
4. For each product, click "Edit"
5. Add Arabic description in the "Description (Arabic)" field
6. Click "Save Product"

### Option 3: Update via MongoDB Script

Create a script to update existing products without deleting data:

```javascript
// update-descriptions.js
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./src/models/Product');

const descriptions = {
    'HJ38020-L': {
        description: 'Discover the exceptional craftsmanship of this exquisite amber crystal candle holder...',
        descriptionAr: 'اكتشف الحرفية الاستثنائية لحامل الشموع الكريستالي العنبري الرائع هذا...'
    },
    // Add more products...
};

async function updateProducts() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    for (const [sku, desc] of Object.entries(descriptions)) {
        await Product.updateOne(
            { sku },
            { $set: desc }
        );
        console.log(`Updated product: ${sku}`);
    }
    
    console.log('Done!');
    process.exit(0);
}

updateProducts();
```

## What Changed

### Before
```javascript
{
    name: 'Amber Crystal Candle Holder',
    nameAr: 'حامل شموع كريستال عنبري',
    price: 35.000,
    // NO description or descriptionAr
}
```

### After
```javascript
{
    name: 'Amber Crystal Candle Holder',
    nameAr: 'حامل شموع كريستال عنبري',
    description: 'Discover the exceptional craftsmanship...',
    descriptionAr: 'اكتشف الحرفية الاستثنائية...',
    price: 35.000
}
```

## Products Updated

All 8 products now have:
1. ✅ English name (`name`)
2. ✅ Arabic name (`nameAr`)
3. ✅ English description (`description`)
4. ✅ Arabic description (`descriptionAr`)

## Testing

After updating:

1. Go to any product page
2. Click "AR" to switch to Arabic
3. Product description should now show in Arabic
4. Click "EN" to switch back to English
5. Description should show in English

## Verification

Check if a product has Arabic description:

```bash
# In MongoDB shell or Compass
db.products.findOne({ sku: 'HJ38020-L' })
```

Should show both `description` and `descriptionAr` fields.

## Need Help?

If you're not comfortable re-seeding the database, I can help you:
1. Create a backup first
2. Update products via API
3. Or manually add descriptions through admin panel

Let me know which approach you prefer!
