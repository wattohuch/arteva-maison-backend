# How to Restore Lost Users

## What Happened
When you ran `node src/seed.js` to update Arabic translations, it executed this code:
```javascript
await User.deleteMany({});  // Deleted ALL users!
```

The seed script is designed to wipe and recreate the entire database - it should only be used for initial setup, not for updates.

## Good News: Automatic Backups Exist! 🎉

Your production server has automatic backups running daily at 4:00 AM. Backups are stored on the Render server at:
```
/opt/render/project/src/backups/
```

## How to Restore Users

### Option 1: Restore from Production Backup (RECOMMENDED)

1. **SSH into your Render server:**
   - Go to Render Dashboard → Your Service → Shell tab
   - Or use Render CLI if you have it installed

2. **Check available backups:**
   ```bash
   ls -la /opt/render/project/src/backups/
   ```
   You should see folders like `backup-2026-02-17-04-00/`

3. **Run the restore script:**
   ```bash
   cd /opt/render/project/src
   node restore.js
   ```
   - It will show you available backups
   - Choose the most recent one BEFORE you ran the seed script
   - Type "YES" to confirm

4. **Restart your service** (if needed)

### Option 2: Restore Locally Then Push to Production

If you have a local backup:

1. **Check for local backups:**
   ```bash
   cd arteva-maison-backend
   dir backups  # Windows
   ls backups   # Mac/Linux
   ```

2. **Run restore script:**
   ```bash
   npm run restore
   ```
   Or:
   ```bash
   node src/restore.js
   ```

3. **Follow the prompts** to select a backup

### Option 3: Manual User Recreation

If no backups are available, users will need to re-register. The good news:
- Products are intact ✅
- Categories are intact ✅
- Orders are intact ✅
- Only users were affected

## Preventing This in the Future

### ❌ NEVER DO THIS in Production:
```bash
node src/seed.js  # Wipes entire database!
```

### ✅ DO THIS Instead for Updates:

**For updating product translations:**
```bash
node src/update-products-arabic.js  # Safe - only updates products
```

**For updating categories:**
```bash
node src/update-categories-arabic.js  # Safe - only updates categories
```

### Create Safe Update Scripts

I'll create safe update scripts that DON'T delete data:

1. **update-products-arabic.js** - Updates product translations without deleting
2. **update-categories-arabic.js** - Updates category translations without deleting
3. **Modified seed.js** - Add safety checks

## Backup Best Practices

1. **Before ANY database operation:**
   ```bash
   node src/backup.js
   ```

2. **Check backup was created:**
   ```bash
   dir backups  # Should show new backup-YYYY-MM-DD folder
   ```

3. **Then proceed with updates**

## Current Status

- **Users:** 1 (admin@arteva.com only)
- **Products:** 8 ✅
- **Categories:** 10 ✅
- **Orders:** 9 ✅ (but user references are broken)
- **Carts:** 3

## Next Steps

1. Check Render server for backups
2. If backups exist, restore from most recent
3. If no backups, users will need to re-register
4. Create safe update scripts for future use

## Need Help?

Run these diagnostic scripts:
```bash
node list-users.js          # List all users
node check-database.js      # Check all collections
node check-orders-users.js  # Check order-user relationships
```
