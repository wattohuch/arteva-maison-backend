/**
 * ============================================================
 * ARTEVA Maison — Import Local Backup to New Cluster
 * ============================================================
 * 
 * The old cluster is unreachable (ETIMEDOUT). This script imports
 * the most recent local backup into the new cluster.
 * 
 * Uses native MongoDB driver (NOT Mongoose) to avoid:
 *   - Password re-hashing via pre('save') hooks
 *   - Slug regeneration
 *   - Any other schema middleware
 * 
 * Usage: node import-backup-to-new-cluster.js
 * ============================================================
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURATION
// ============================================================

const NEW_URI = 'mongodb+srv://sicklxrdfy_db_user:7UkuAQCxq77M3Juu@clusterarteva.w0s4wst.mongodb.net/arteva_maison?retryWrites=true&w=majority&appName=ClusterArteva';
const DB_NAME = 'arteva_maison';

// Path to the most recent local backup
const BACKUP_DIR = path.join(__dirname, 'backups', 'backup-2026-02-18T08-07-57');

// Collections in the backup
const BACKUP_COLLECTIONS = ['users', 'products', 'categories', 'carts', 'orders'];

// Collections that may not be in backup but need indexes created
const EMPTY_COLLECTIONS = ['reviews', 'deliverypilots', 'pushsubscriptions'];

const BATCH_SIZE = 100;
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 3000;

// Index definitions matching Mongoose schemas
const INDEX_DEFINITIONS = {
    users: [
        { key: { email: 1 }, options: { unique: true } }
    ],
    products: [
        { key: { name: 'text', description: 'text', tags: 'text' }, options: {} },
        { key: { category: 1, isActive: 1 }, options: {} },
        { key: { isFeatured: 1, isActive: 1 }, options: {} },
        { key: { isNewArrival: 1, isActive: 1 }, options: {} },
        { key: { slug: 1 }, options: { unique: true } },
        { key: { sku: 1 }, options: { unique: true, sparse: true } }
    ],
    categories: [
        { key: { name: 1 }, options: { unique: true } },
        { key: { slug: 1 }, options: { unique: true } }
    ],
    carts: [
        { key: { user: 1 }, options: { unique: true } }
    ],
    orders: [
        { key: { user: 1, createdAt: -1 }, options: {} },
        { key: { orderNumber: 1 }, options: { unique: true } },
        { key: { orderStatus: 1 }, options: {} },
        { key: { paymentStatus: 1 }, options: {} }
    ],
    reviews: [
        { key: { product: 1, user: 1 }, options: { unique: true } }
    ],
    deliverypilots: [],
    pushsubscriptions: [
        { key: { userId: 1 }, options: {} },
        { key: { userId: 1, 'subscription.endpoint': 1 }, options: { unique: true } },
        { key: { createdAt: 1 }, options: { expireAfterSeconds: 7776000 } } // 90 days TTL
    ]
};

// ============================================================
// LOGGING
// ============================================================

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logDir = path.join(__dirname, 'backups', `import-${timestamp}`);
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, 'import.log');
const logLines = [];

function log(level, message) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}`;
    console.log(line);
    logLines.push(line);
}

function flushLog() {
    fs.writeFileSync(logFile, logLines.join('\n') + '\n');
}

// ============================================================
// HELPERS
// ============================================================

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        try {
            return await fn();
        } catch (err) {
            log('WARN', `${label} — attempt ${attempt}/${RETRY_COUNT} failed: ${err.message}`);
            if (attempt < RETRY_COUNT) {
                log('INFO', `  Retrying in ${RETRY_DELAY_MS / 1000}s...`);
                await sleep(RETRY_DELAY_MS);
            } else {
                throw err;
            }
        }
    }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    const startTime = Date.now();

    log('INFO', '╔══════════════════════════════════════════════════╗');
    log('INFO', '║  ARTEVA Maison — Import Backup to New Cluster   ║');
    log('INFO', '╚══════════════════════════════════════════════════╝');
    log('INFO', '');
    log('INFO', `Import started at: ${new Date().toISOString()}`);
    log('INFO', `Source backup: ${BACKUP_DIR}`);
    log('INFO', `Target cluster: clusterarteva.w0s4wst.mongodb.net`);
    log('INFO', `Database: ${DB_NAME}`);
    log('INFO', '');

    // Verify backup exists
    if (!fs.existsSync(BACKUP_DIR)) {
        log('ERROR', `❌ Backup directory not found: ${BACKUP_DIR}`);
        process.exit(1);
    }

    const client = new MongoClient(NEW_URI, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 60000,
        maxPoolSize: 5,
    });

    const results = {};

    try {
        // ── Connect to new cluster ──
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '  STEP 1: CONNECT TO NEW CLUSTER');
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '');

        await withRetry(() => client.connect(), 'New cluster connection');
        log('INFO', '✅ Connected to new cluster');

        const db = client.db(DB_NAME);

        // Check existing state
        const existing = await db.listCollections().toArray();
        if (existing.length > 0) {
            log('WARN', `⚠️  New cluster has ${existing.length} existing collections: ${existing.map(c => c.name).join(', ')}`);
        } else {
            log('INFO', '✅ New cluster is empty — clean import');
        }
        log('INFO', '');

        // ── Import backup collections ──
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '  STEP 2: IMPORT DATA FROM BACKUP');
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '');

        for (const collName of BACKUP_COLLECTIONS) {
            const filePath = path.join(BACKUP_DIR, `${collName}.json`);

            if (!fs.existsSync(filePath)) {
                log('WARN', `  ⚠️  ${collName}.json not found in backup, skipping`);
                results[collName] = { status: 'SKIPPED', reason: 'File not found' };
                continue;
            }

            try {
                const rawData = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(rawData);

                // Drop existing collection
                try {
                    await db.collection(collName).drop();
                    log('INFO', `  🗑️  ${collName}: Dropped existing`);
                } catch (e) {
                    // Doesn't exist — fine
                }

                if (data.length === 0) {
                    await db.createCollection(collName);
                    log('INFO', `  ⏭️  ${collName}: 0 documents (empty collection created)`);
                    results[collName] = { count: 0, status: 'OK (empty)' };
                } else {
                    const collection = db.collection(collName);
                    let imported = 0;

                    for (let i = 0; i < data.length; i += BATCH_SIZE) {
                        const batch = data.slice(i, i + BATCH_SIZE);
                        await withRetry(async () => {
                            await collection.insertMany(batch, { ordered: false });
                        }, `Import ${collName} batch ${Math.floor(i / BATCH_SIZE) + 1}`);
                        imported += batch.length;
                    }

                    log('INFO', `  ✅ ${collName}: ${imported} documents imported`);
                    results[collName] = { count: imported, status: 'OK' };
                }
            } catch (err) {
                log('ERROR', `  ❌ ${collName}: FAILED — ${err.message}`);
                results[collName] = { count: 0, status: 'FAILED', error: err.message };
            }
        }

        // Create empty collections for models not in backup
        for (const collName of EMPTY_COLLECTIONS) {
            try {
                try {
                    await db.collection(collName).drop();
                } catch (e) { /* doesn't exist */ }
                await db.createCollection(collName);
                log('INFO', `  📁 ${collName}: Empty collection created`);
                results[collName] = { count: 0, status: 'OK (new empty)' };
            } catch (err) {
                log('WARN', `  ⚠️  ${collName}: ${err.message}`);
                results[collName] = { count: 0, status: 'WARN', error: err.message };
            }
        }

        log('INFO', '');

        // ── Create indexes ──
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '  STEP 3: CREATE INDEXES');
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '');

        for (const [collName, indexes] of Object.entries(INDEX_DEFINITIONS)) {
            for (const idx of indexes) {
                try {
                    const indexName = await db.collection(collName).createIndex(idx.key, idx.options);
                    log('INFO', `  📇 ${collName}: Index '${indexName}' created`);
                } catch (err) {
                    log('WARN', `  ⚠️  ${collName}: Index failed — ${err.message}`);
                }
            }
        }

        log('INFO', '');

        // ── Verification ──
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '  STEP 4: VERIFICATION');
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '');

        let allPassed = true;
        const verification = {};

        for (const collName of [...BACKUP_COLLECTIONS, ...EMPTY_COLLECTIONS]) {
            const expected = results[collName]?.count || 0;
            const actual = await db.collection(collName).countDocuments();
            const indexes = await db.collection(collName).indexes();
            const match = expected === actual;
            if (!match) allPassed = false;

            verification[collName] = {
                expected,
                actual,
                indexCount: indexes.length,
                match,
                status: match ? '✅ PASS' : '❌ MISMATCH'
            };

            const icon = match ? '✅' : '❌';
            log('INFO', `  ${icon} ${collName}: expected=${expected}, actual=${actual}, indexes=${indexes.length}`);
        }

        log('INFO', '');

        // ── Generate report ──
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const report = {
            migration: {
                type: 'LOCAL_BACKUP_IMPORT',
                sourceBackup: 'backup-2026-02-18T08-07-57',
                sourceBackupDate: '2026-02-18T08:07:57.886Z',
                note: 'Old cluster unreachable (ETIMEDOUT). Imported from local backup.',
                startedAt: new Date(startTime).toISOString(),
                completedAt: new Date().toISOString(),
                elapsedSeconds: parseFloat(elapsed),
                targetCluster: 'clusterarteva.w0s4wst.mongodb.net',
                database: DB_NAME
            },
            import: results,
            verification,
            overallResult: allPassed ? 'SUCCESS' : 'PARTIAL_FAILURE'
        };

        const reportPath = path.join(logDir, 'verification-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '  IMPORT SUMMARY');
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', `  Status: ${allPassed ? '✅ SUCCESS' : '⚠️  PARTIAL FAILURE'}`);
        log('INFO', `  Duration: ${elapsed}s`);
        log('INFO', `  Source: ${BACKUP_DIR}`);
        log('INFO', `  Report: ${reportPath}`);
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '');

        if (allPassed) {
            log('INFO', '🎉 Import completed successfully!');
            log('INFO', '');
            log('INFO', 'NEXT STEPS:');
            log('INFO', '  1. Update local .env MONGODB_URI to new cluster');
            log('INFO', '  2. Test locally: node check-database.js');
            log('INFO', '  3. Update Render environment variable MONGODB_URI');
            log('INFO', '  4. Redeploy on Render');
        } else {
            log('ERROR', '⚠️  Import had issues. Review the verification report.');
        }

        flushLog();
        process.exit(allPassed ? 0 : 1);

    } catch (err) {
        log('ERROR', `💥 IMPORT FAILED: ${err.message}`);
        log('ERROR', err.stack);
        flushLog();
        process.exit(1);
    } finally {
        await client.close();
    }
}

main();
