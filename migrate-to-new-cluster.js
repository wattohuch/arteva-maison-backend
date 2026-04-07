/**
 * ============================================================
 * ARTEVA Maison — MongoDB Cluster Migration Script
 * ============================================================
 * 
 * Migrates ALL data from the old cluster to the new cluster.
 * Uses native MongoDB driver for import to avoid Mongoose hooks
 * (e.g., password re-hashing via pre('save')).
 * 
 * Usage: node migrate-to-new-cluster.js
 * 
 * Phases:
 *   1. Connect to OLD cluster & export all collections
 *   2. Connect to NEW cluster & import all data
 *   3. Recreate indexes
 *   4. Verify counts & generate report
 * ============================================================
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURATION
// ============================================================

const OLD_URI = process.env.MONGODB_URI; 
// Old: mongodb+srv://walson549_db_user:***@clusterarteva.ahgkw1j.mongodb.net/arteva_maison

const NEW_URI = 'mongodb+srv://sicklxrdfy_db_user:7UkuAQCxq77M3Juu@clusterarteva.w0s4wst.mongodb.net/arteva_maison?retryWrites=true&w=majority&appName=ClusterArteva';

const DB_NAME = 'arteva_maison';

// All collections to migrate (matches Mongoose models + any auto-created)
const COLLECTIONS = [
    'users',
    'products',
    'categories',
    'carts',
    'orders',
    'reviews',
    'deliverypilots',
    'pushsubscriptions'
];

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 5000;
const BATCH_SIZE = 100;

// Connection options optimized for potentially unstable source
const CONNECTION_OPTIONS = {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 60000,
    maxPoolSize: 5,
    retryReads: true,
};

// ============================================================
// LOGGING
// ============================================================

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const migrationDir = path.join(__dirname, 'backups', `migration-${timestamp}`);
fs.mkdirSync(migrationDir, { recursive: true });

const logFile = path.join(migrationDir, 'migration.log');
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
// PHASE 1: EXPORT FROM OLD CLUSTER
// ============================================================

async function exportFromOldCluster() {
    log('INFO', '');
    log('INFO', '══════════════════════════════════════════════════');
    log('INFO', '  PHASE 1: EXPORT FROM OLD CLUSTER');
    log('INFO', '══════════════════════════════════════════════════');
    log('INFO', '');

    const client = new MongoClient(OLD_URI, CONNECTION_OPTIONS);
    const exportResults = {};

    try {
        log('INFO', 'Connecting to OLD cluster...');
        await withRetry(() => client.connect(), 'Old cluster connection');
        log('INFO', '✅ Connected to OLD cluster');

        const db = client.db(DB_NAME);

        // Discover all actual collections in the database
        const actualCollections = await db.listCollections().toArray();
        const actualNames = actualCollections.map(c => c.name);
        log('INFO', `📋 Collections found in old cluster: ${actualNames.join(', ')}`);

        // Merge with our expected list (union)
        const allCollections = [...new Set([...COLLECTIONS, ...actualNames])];
        // Filter out system collections
        const collectionsToExport = allCollections.filter(name => !name.startsWith('system.'));

        log('INFO', `📋 Collections to export: ${collectionsToExport.join(', ')}`);
        log('INFO', '');

        for (const collName of collectionsToExport) {
            try {
                const data = await withRetry(async () => {
                    const collection = db.collection(collName);
                    return await collection.find({}).toArray();
                }, `Export ${collName}`);

                const filePath = path.join(migrationDir, `${collName}.json`);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

                // Also export indexes
                const indexes = await withRetry(async () => {
                    return await db.collection(collName).indexes();
                }, `Export indexes for ${collName}`);

                const indexPath = path.join(migrationDir, `${collName}.indexes.json`);
                fs.writeFileSync(indexPath, JSON.stringify(indexes, null, 2));

                exportResults[collName] = {
                    count: data.length,
                    indexes: indexes.length,
                    sizeBytes: fs.statSync(filePath).size,
                    status: 'OK'
                };
                log('INFO', `  📁 ${collName}: ${data.length} documents exported (${indexes.length} indexes)`);
            } catch (err) {
                exportResults[collName] = { count: 0, status: 'FAILED', error: err.message };
                log('ERROR', `  ❌ ${collName}: EXPORT FAILED — ${err.message}`);
            }
        }

        log('INFO', '');
        log('INFO', '✅ Phase 1 complete — Export finished');
        return { exportResults, collectionsToExport };
    } finally {
        await client.close();
        log('INFO', 'Old cluster connection closed');
    }
}

// ============================================================
// PHASE 2: IMPORT TO NEW CLUSTER
// ============================================================

async function importToNewCluster(collectionsToExport) {
    log('INFO', '');
    log('INFO', '══════════════════════════════════════════════════');
    log('INFO', '  PHASE 2: IMPORT TO NEW CLUSTER');
    log('INFO', '══════════════════════════════════════════════════');
    log('INFO', '');

    const client = new MongoClient(NEW_URI, CONNECTION_OPTIONS);
    const importResults = {};

    try {
        log('INFO', 'Connecting to NEW cluster...');
        await withRetry(() => client.connect(), 'New cluster connection');
        log('INFO', '✅ Connected to NEW cluster');

        const db = client.db(DB_NAME);

        // Check if new cluster already has data
        const existingCollections = await db.listCollections().toArray();
        if (existingCollections.length > 0) {
            const existingNames = existingCollections.map(c => c.name);
            log('WARN', `⚠️  New cluster already has collections: ${existingNames.join(', ')}`);
            log('WARN', '   Will drop and recreate each collection to ensure clean import');
        }

        for (const collName of collectionsToExport) {
            const filePath = path.join(migrationDir, `${collName}.json`);
            if (!fs.existsSync(filePath)) {
                log('WARN', `  ⚠️  ${collName}: No export file found, skipping`);
                importResults[collName] = { count: 0, status: 'SKIPPED', reason: 'No export file' };
                continue;
            }

            try {
                const rawData = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(rawData);

                if (data.length === 0) {
                    log('INFO', `  ⏭️  ${collName}: 0 documents, creating empty collection`);
                    await db.createCollection(collName);
                    importResults[collName] = { count: 0, status: 'OK (empty)' };
                    // Still recreate indexes for empty collections
                } else {
                    // Drop existing collection if it exists
                    try {
                        await db.collection(collName).drop();
                        log('INFO', `  🗑️  ${collName}: Dropped existing collection`);
                    } catch (e) {
                        // Collection doesn't exist, that's fine
                    }

                    // Import in batches
                    const collection = db.collection(collName);
                    let imported = 0;

                    for (let i = 0; i < data.length; i += BATCH_SIZE) {
                        const batch = data.slice(i, i + BATCH_SIZE);
                        await withRetry(async () => {
                            await collection.insertMany(batch, { ordered: false });
                        }, `Import batch ${Math.floor(i / BATCH_SIZE) + 1} of ${collName}`);
                        imported += batch.length;
                    }

                    importResults[collName] = { count: imported, status: 'OK' };
                    log('INFO', `  ✅ ${collName}: ${imported} documents imported`);
                }

                // Recreate indexes (skip the default _id index)
                const indexPath = path.join(migrationDir, `${collName}.indexes.json`);
                if (fs.existsSync(indexPath)) {
                    const indexes = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                    const customIndexes = indexes.filter(idx => idx.name !== '_id_');

                    for (const idx of customIndexes) {
                        try {
                            const options = { ...idx };
                            const key = options.key;
                            delete options.key;
                            delete options.v;
                            // Remove ns field if present (deprecated)
                            delete options.ns;

                            await db.collection(collName).createIndex(key, options);
                            log('INFO', `    📇 Index '${idx.name}' created on ${collName}`);
                        } catch (err) {
                            log('WARN', `    ⚠️  Index '${idx.name}' on ${collName}: ${err.message}`);
                        }
                    }
                }

            } catch (err) {
                importResults[collName] = { count: 0, status: 'FAILED', error: err.message };
                log('ERROR', `  ❌ ${collName}: IMPORT FAILED — ${err.message}`);
            }
        }

        log('INFO', '');
        log('INFO', '✅ Phase 2 complete — Import finished');
        return importResults;
    } finally {
        await client.close();
        log('INFO', 'New cluster connection closed');
    }
}

// ============================================================
// PHASE 3: VERIFICATION
// ============================================================

async function verifyMigration(exportResults, importResults) {
    log('INFO', '');
    log('INFO', '══════════════════════════════════════════════════');
    log('INFO', '  PHASE 3: VERIFICATION');
    log('INFO', '══════════════════════════════════════════════════');
    log('INFO', '');

    const newClient = new MongoClient(NEW_URI, CONNECTION_OPTIONS);
    const verification = {};
    let allPassed = true;

    try {
        await newClient.connect();
        const newDb = newClient.db(DB_NAME);

        for (const collName of Object.keys(exportResults)) {
            const exported = exportResults[collName]?.count || 0;
            const importedInfo = importResults[collName];

            // Also verify by querying new cluster directly
            let actualCount = 0;
            try {
                actualCount = await newDb.collection(collName).countDocuments();
            } catch (e) {
                // Collection may not exist
            }

            const match = exported === actualCount;
            if (!match) allPassed = false;

            verification[collName] = {
                exported,
                imported: importedInfo?.count || 0,
                actualInNewCluster: actualCount,
                match,
                status: match ? '✅ PASS' : '❌ MISMATCH'
            };

            const icon = match ? '✅' : '❌';
            log('INFO', `  ${icon} ${collName}: exported=${exported}, inNewCluster=${actualCount} ${match ? '— MATCH' : '— MISMATCH!'}`);
        }

        log('INFO', '');
        if (allPassed) {
            log('INFO', '🎉 ALL COLLECTIONS VERIFIED SUCCESSFULLY!');
        } else {
            log('ERROR', '⚠️  SOME COLLECTIONS HAVE MISMATCHES — Review report!');
        }

        return { verification, allPassed };
    } finally {
        await newClient.close();
    }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    const startTime = Date.now();
    
    log('INFO', '╔══════════════════════════════════════════════════╗');
    log('INFO', '║   ARTEVA Maison — Database Cluster Migration     ║');
    log('INFO', '╚══════════════════════════════════════════════════╝');
    log('INFO', '');
    log('INFO', `Migration started at: ${new Date().toISOString()}`);
    log('INFO', `Backup directory: ${migrationDir}`);
    log('INFO', `Old cluster: clusterarteva.ahgkw1j.mongodb.net`);
    log('INFO', `New cluster: clusterarteva.w0s4wst.mongodb.net`);
    log('INFO', '');

    try {
        // Phase 1: Export
        const { exportResults, collectionsToExport } = await exportFromOldCluster();
        flushLog();

        // Phase 2: Import
        const importResults = await importToNewCluster(collectionsToExport);
        flushLog();

        // Phase 3: Verify
        const { verification, allPassed } = await verifyMigration(exportResults, importResults);

        // Generate report
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const report = {
            migration: {
                startedAt: new Date(startTime).toISOString(),
                completedAt: new Date().toISOString(),
                elapsedSeconds: parseFloat(elapsed),
                oldCluster: 'clusterarteva.ahgkw1j.mongodb.net',
                newCluster: 'clusterarteva.w0s4wst.mongodb.net',
                database: DB_NAME
            },
            export: exportResults,
            import: importResults,
            verification,
            overallResult: allPassed ? 'SUCCESS' : 'PARTIAL_FAILURE'
        };

        const reportPath = path.join(migrationDir, 'verification-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        log('INFO', '');
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '  MIGRATION SUMMARY');
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', `  Status: ${allPassed ? '✅ SUCCESS' : '⚠️  PARTIAL FAILURE'}`);
        log('INFO', `  Duration: ${elapsed}s`);
        log('INFO', `  Backup: ${migrationDir}`);
        log('INFO', `  Report: ${reportPath}`);
        log('INFO', '══════════════════════════════════════════════════');
        log('INFO', '');

        if (allPassed) {
            log('INFO', '🎉 Migration completed successfully!');
            log('INFO', '');
            log('INFO', 'NEXT STEPS:');
            log('INFO', '  1. Update local .env MONGODB_URI to new cluster');
            log('INFO', '  2. Test locally: node check-database.js');
            log('INFO', '  3. Update Render environment variable MONGODB_URI');
            log('INFO', '  4. Redeploy on Render');
        } else {
            log('ERROR', '⚠️  Migration had issues. Review the verification report.');
        }

        flushLog();
        process.exit(allPassed ? 0 : 1);

    } catch (err) {
        log('ERROR', `💥 MIGRATION FAILED: ${err.message}`);
        log('ERROR', err.stack);
        flushLog();
        process.exit(1);
    }
}

main();
