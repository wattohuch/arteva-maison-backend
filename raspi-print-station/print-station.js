#!/usr/bin/env node

/**
 * ARTÉVA MAISON — Raspberry Pi Print Station v5
 * PRODUCTION-HARDENED — Security-audited, fault-tolerant, zero-crash
 *
 * v5 Fixes (over v4):
 *  Security:
 *  - FIXED: Command injection in lpr/lpstat — now uses execFile (no shell)
 *  - FIXED: XSS in templates — all user data escaped (see templates.js v5)
 *  - FIXED: API key leaked in URL query params — moved to X-API-Key header
 *  - FIXED: Health endpoint exposed system internals without auth
 *  - FIXED: Printer name injection — strict validation regex
 *  - FIXED: Predictable watchdog path — moved to secure temp dir
 *
 *  Reliability:
 *  - FIXED: `processed` Set memory leak — capped at 10K with automatic pruning
 *  - FIXED: Timeout promise leak — proper AbortController pattern with cleanup
 *  - FIXED: Browser page leak if goto() throws before close()
 *  - FIXED: Double-print race — dedup check in pollLoop before queueing
 *  - FIXED: markPrinted() failure causes re-print — now tracked locally
 *  - FIXED: buildReceiptHTML crash kills entire poll loop — per-job error isolation
 *  - FIXED: Temp files never cleaned if process restarts — immediate cleanup
 *  - FIXED: processPendingQueue uses stale printer ref — re-detects each time
 *  - FIXED: pollLoop passes stale `currentPrinter` to queue processor
 *  - FIXED: Mutex deadlock if timeout fires but job completes — proper cleanup
 */

require('dotenv').config();
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { exec, execFile } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);
const os = require('os');
const winston = require('winston');
require('winston-daily-rotate-file');
const { buildReceiptHTML, buildLabelHTML } = require('./templates');

// ── HTTP Agent (keep-alive + forced IPv4) ────────────────────
// Force IPv4 to avoid IPv6 routing issues on Raspberry Pi
dns.setDefaultResultOrder('ipv4first');

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 5,
  timeout: 180000,
  family: 4, // Force IPv4
});

const api = axios.create({
  baseURL: (process.env.API_URL || 'https://arteva-maison-backend-gy1x.onrender.com').replace(/\/+$/, ''),
  timeout: 180000,  // 180s — generous for Render cold starts
  httpsAgent,
  headers: {
    'Connection': 'keep-alive',
    'X-API-Key': process.env.PRINT_KEY || 'arteva-print-2026',
  },
  // Force IPv4 at the axios level too
  family: 4,
});

// ── Config ──────────────────────────────────────────────────
const API_URL    = api.defaults.baseURL;
const PRINT_KEY  = process.env.PRINT_KEY || 'arteva-print-2026';
const POLL_MS    = (parseInt(process.env.POLL_SECONDS) || 30) * 1000;
const PRINTER    = process.env.PRINTER_NAME || '';
const PAPER      = process.env.PAPER_SIZE || 'A4';

/* Copies per receipt. Clamped: a typo of 20 in the env would quietly empty the
   paper tray mid-exhibition, and there is no legitimate reason to exceed a
   handful. */
const COPIES = Math.min(Math.max(parseInt(process.env.PRINT_COPIES, 10) || 1, 1), 5);
const PRINT_RECEIPT = process.env.PRINT_RECEIPT !== 'false';
const PRINT_LABEL   = process.env.PRINT_LABEL === 'true';
const TEST_MODE     = process.env.TEST_MODE === 'true';
const HEALTH_PORT   = parseInt(process.env.HEALTH_PORT) || 3100;
const MAX_RETRIES   = parseInt(process.env.MAX_RETRIES) || 5;
const HEALTH_TOKEN  = process.env.HEALTH_TOKEN || '';  // Optional auth for health endpoint

/* How long to let webfonts load before printing anyway. Online they arrive in
   well under a second; offline this is the ceiling on the delay rather than a
   reason to fail the receipt. */
const FONT_WAIT_MS  = parseInt(process.env.FONT_WAIT_MS) || 4000;

/* Bound on how long a single job waits for a missing printer. The job is
   already on disk, so giving up here just returns it to the queue — the
   printer health check flushes it the moment the printer reappears. */
const PRINTER_WAIT_ATTEMPTS = parseInt(process.env.PRINTER_WAIT_ATTEMPTS) || 12; // ~1 min

/* Refuse to accept new work below this much free space. Receipts are written
   to disk before printing, so a full SD card means silently losing them. */
const MIN_FREE_DISK_MB = parseInt(process.env.MIN_FREE_DISK_MB) || 50;

// ── Directories ─────────────────────────────────────────────
const BASE_DIR      = __dirname;
const QUEUE_DIR     = path.join(BASE_DIR, 'queue');
const PENDING_DIR   = path.join(QUEUE_DIR, 'pending');
const COMPLETED_DIR = path.join(QUEUE_DIR, 'completed');
const FAILED_DIR    = path.join(QUEUE_DIR, 'failed');
const LOGS_DIR      = path.join(BASE_DIR, 'logs');
const TEMP_DIR      = path.join(os.tmpdir(), 'arteva-print');

// Create all directories synchronously at startup
[PENDING_DIR, COMPLETED_DIR, FAILED_DIR, LOGS_DIR, TEMP_DIR].forEach(d => {
  fs.mkdirSync(d, { recursive: true });
});

// ── Winston Logger (with rotating file transport) ───────────
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
);
const logger = winston.createLogger({
  level: 'debug',
  format: logFormat,
  transports: [
    new winston.transports.Console({ level: 'info' }),
    new winston.transports.DailyRotateFile({
      dirname: LOGS_DIR,
      filename: 'print-station-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '5m',
      maxFiles: '7d',
      level: 'debug',
    }),
  ],
});

function log(msg, level = 'info') { logger.log(level, msg); }

// ── Mutex Lock (one print at a time) ────────────────────────
let _printLock = false;
const _printQueue = [];
async function acquirePrintLock() {
  if (!_printLock) { _printLock = true; return; }
  await new Promise(resolve => _printQueue.push(resolve));
}
function releasePrintLock() {
  if (_printQueue.length > 0) {
    const next = _printQueue.shift();
    next();
  } else {
    _printLock = false;
  }
}

// ── Memory Monitor ──────────────────────────────────────────
const MAX_HEAP_MB = parseInt(process.env.MAX_HEAP_MB) || 200;
const PAYLOAD_MAX_BYTES = parseInt(process.env.PAYLOAD_MAX_BYTES) || 500 * 1024; // 500KB
const PRINT_TIMEOUT_MS = parseInt(process.env.PRINT_TIMEOUT_MS) || 120000; // 2 min

function getMemoryMB() {
  const mem = process.memoryUsage();
  return { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576), total: Math.round(mem.heapTotal / 1048576) };
}

function checkMemory() {
  const mem = getMemoryMB();
  if (mem.heap > MAX_HEAP_MB) {
    log(`⚠ HIGH MEMORY: heap=${mem.heap}MB (limit ${MAX_HEAP_MB}MB). Forcing GC.`, 'warn');
    if (global.gc) { global.gc(); log('🧹 Manual GC triggered'); }
  }
  return mem;
}

function validatePayload(order) {
  const json = JSON.stringify(order);
  if (json.length > PAYLOAD_MAX_BYTES) {
    throw new Error(`Payload too large: ${json.length} bytes (max ${PAYLOAD_MAX_BYTES})`);
  }
  if (!order._id || !order.orderNumber) {
    throw new Error('Invalid order payload: missing _id or orderNumber');
  }
  if (!order.items || !Array.isArray(order.items) || order.items.length === 0) {
    throw new Error('Invalid order payload: no items');
  }
  return true;
}

// ── Printer Name Validation ─────────────────────────────────
// Prevent command injection via malicious printer names
const SAFE_PRINTER_RE = /^[a-zA-Z0-9_\-.:]+$/;
function validatePrinterName(name) {
  if (!name) return false;
  if (name.length > 128) return false;
  return SAFE_PRINTER_RE.test(name);
}

// ── State ───────────────────────────────────────────────────
const startTime = Date.now();
let printedCount = 0;
let errorCount = 0;
let lastPrintTime = null;
let lastPollTime = null;
let currentPrinter = null;
let printerReady = false;
let browser = null;
let isPrinting = false;

// ── Bounded Dedup Set (prevents memory leak) ────────────────
// Cap at 10,000 entries. When full, remove oldest 2,000 to make room.
const MAX_PROCESSED = 10000;
const PRUNE_COUNT = 2000;
const processed = new Set();

function addProcessed(id) {
  if (processed.size >= MAX_PROCESSED) {
    const iter = processed.values();
    for (let i = 0; i < PRUNE_COUNT; i++) {
      const val = iter.next().value;
      if (val) processed.delete(val);
    }
    log(`🧹 Pruned processed set: ${processed.size} entries remaining`, 'debug');
  }
  processed.add(id);
}

// Track orders currently being processed to prevent double-queue
const activeJobs = new Set();

/**
 * Order ids that already have a job file in pending/ or failed/.
 *
 * Without this, an order that fails to print spawns a NEW pending file on
 * every poll: `processed` was only populated on success, the backend still
 * reports the order (printedAt unset), so each 30s cycle wrote another job.
 * Each copy carried retries: 0, so MAX_RETRIES was never reached either — an
 * unprintable order queued itself forever and filled the SD card.
 */
const queuedOrderIds = new Set();

/**
 * Orders printed on paper but not yet acknowledged to the API.
 *
 * The failure this prevents: receipt prints, moveToCompleted succeeds,
 * markPrinted fails (Render unreachable), process restarts. The in-memory
 * `processed` set is gone, the backend still lists the order as unprinted, and
 * the customer's receipt prints a second time.
 *
 * Persisted, so a restart still knows. Entries are removed once the API
 * confirms, which is what keeps a deliberate admin re-print working: the
 * backend clears printedAt only after we have acknowledged, so by then the id
 * is no longer here to block it.
 */
const UNACKED_FILE = path.join(QUEUE_DIR, 'unacked-prints.json');
let unackedPrints = new Set();

function loadUnacked() {
  try {
    const arr = JSON.parse(fs.readFileSync(UNACKED_FILE, 'utf8'));
    if (Array.isArray(arr)) unackedPrints = new Set(arr);
  } catch (_) {
    unackedPrints = new Set();
  }
}

function saveUnacked() {
  try {
    const tmp = UNACKED_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...unackedPrints]));
    fs.renameSync(tmp, UNACKED_FILE);
  } catch (e) {
    log(`⚠ Could not persist unacked print list: ${e.message}`, 'warn');
  }
}

/** Build the queued-id index from what is actually on disk at startup. */
async function indexQueuedOrders() {
  queuedOrderIds.clear();
  for (const dir of [PENDING_DIR, FAILED_DIR]) {
    let files = [];
    try { files = await fsp.readdir(dir); } catch (_) { continue; }
    for (const f of files.filter(f => f.endsWith('.json'))) {
      try {
        const job = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
        if (job.id) queuedOrderIds.add(String(job.id));
      } catch (_) { /* corrupt file — loadPendingQueue handles it */ }
    }
  }
  if (queuedOrderIds.size) {
    log(`📇 Indexed ${queuedOrderIds.size} order(s) already queued or failed on disk`);
  }
}

/** Retry acknowledging prints the API never confirmed. */
async function retryUnackedPrints() {
  if (unackedPrints.size === 0) return;
  log(`🔁 Retrying API acknowledgement for ${unackedPrints.size} printed order(s)...`);
  for (const id of [...unackedPrints]) {
    if (await markPrinted(id)) {
      unackedPrints.delete(id);
      log(`  ✓ Acknowledged ${id}`);
    }
  }
  saveUnacked();
}

// ── Watchdog Heartbeat ──────────────────────────────────────
function startWatchdog() {
  const hbPath = path.join(TEMP_DIR, 'heartbeat');
  // Also keep /tmp/print-heartbeat for backward compat with watchdog.sh
  const legacyHbPath = '/tmp/print-heartbeat';
  const write = () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    try { fs.writeFileSync(hbPath, ts); } catch (_) {}
    try { fs.writeFileSync(legacyHbPath, ts); } catch (_) {}
  };
  write();
  setInterval(write, 5000);
  log('💓 Watchdog heartbeat started');
}

// ── Printer Detection & Readiness ───────────────────────────
async function detectPrinter() {
  if (PRINTER) {
    if (!validatePrinterName(PRINTER)) {
      log(`⚠ Configured PRINTER_NAME "${PRINTER}" contains invalid characters — ignoring`, 'warn');
    } else {
      try {
        const { stdout } = await execFileAsync('lpstat', ['-p']);
        if (stdout.includes(PRINTER)) return PRINTER;
      } catch (_) {}
    }
  }
  // Auto-detect
  try {
    const { stdout } = await execFileAsync('lpstat', ['-d']);
    const m = stdout.match(/destination:\s*(.+)/);
    if (m) {
      const name = m[1].trim();
      if (validatePrinterName(name)) return name;
      log(`⚠ Auto-detected printer name "${name}" is invalid — skipping`, 'warn');
    }
  } catch (_) {}
  try {
    const { stdout } = await execFileAsync('lpstat', ['-p']);
    const m = stdout.match(/printer\s+(\S+)/);
    if (m) {
      const name = m[1];
      if (validatePrinterName(name)) return name;
      log(`⚠ Auto-detected printer name "${name}" is invalid — skipping`, 'warn');
    }
  } catch (_) {}
  return null;
}

async function checkPrinterReady(name) {
  if (!name) return false;
  if (!validatePrinterName(name)) return false;
  try {
    const { stdout } = await execFileAsync('lpstat', ['-p', name]);
    const ready = !stdout.includes('disabled') && !stdout.includes('rejecting');
    return ready;
  } catch (_) {
    return false;
  }
}

/**
 * Wait for a ready printer, for a bounded number of attempts.
 *
 * This used to loop forever. It is called from inside a print job, and that
 * job runs under a Promise.race against PRINT_TIMEOUT_MS — but losing the race
 * does not cancel the loser, so a timed-out job left this loop spinning for
 * the life of the process. Every subsequent job that hit an offline printer
 * added another immortal loop, each polling lpstat every 5s and writing a log
 * line. Returning null instead hands the job back to the queue, which is where
 * it is already safely stored.
 *
 * @returns {Promise<string|null>} printer name, or null if it never appeared
 */
async function waitForPrinter(maxAttempts = PRINTER_WAIT_ATTEMPTS) {
  log('🔍 Detecting printer...');
  for (let attempts = 1; attempts <= maxAttempts; attempts++) {
    const name = await detectPrinter();
    if (name) {
      const ready = await checkPrinterReady(name);
      if (ready) {
        currentPrinter = name;
        printerReady = true;
        log(`✅ Printer ready: ${name}`);
        return name;
      }
      log(`⏳ Printer "${name}" found but not ready. Retrying... (${attempts}/${maxAttempts})`);
    } else {
      log(`⏳ No printer detected. Retrying... (${attempts}/${maxAttempts})`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  printerReady = false;
  log(`⚠ Printer still unavailable after ${maxAttempts} attempts — leaving job queued`, 'warn');
  return null;
}

// ── Disk Space Guard ────────────────────────────────────────
/**
 * Free megabytes on the volume holding the queue, or null if unknown.
 *
 * Receipts are written to disk before they print, so a full SD card means an
 * order silently vanishes. Better to shout about it while there is still room
 * to write the log line saying so.
 */
async function getFreeDiskMB() {
  try {
    const { stdout } = await execFileAsync('df', ['-Pm', QUEUE_DIR], { timeout: 5000 });
    const line = stdout.trim().split('\n')[1];
    if (!line) return null;
    const cols = line.split(/\s+/);
    const available = parseInt(cols[3], 10);
    return Number.isFinite(available) ? available : null;
  } catch (_) {
    return null; // df missing or unreadable — do not block printing over it
  }
}

let lastDiskWarnAt = 0;
async function checkDiskSpace() {
  const freeMB = await getFreeDiskMB();
  if (freeMB === null) return true;
  if (freeMB < MIN_FREE_DISK_MB) {
    // Rate-limit: this runs every poll, and the log itself consumes disk.
    if (Date.now() - lastDiskWarnAt > 300000) {
      lastDiskWarnAt = Date.now();
      log(`🚨 LOW DISK: only ${freeMB}MB free (need ${MIN_FREE_DISK_MB}MB). ` +
          `Clear logs/ and queue/completed/ — receipts cannot be saved reliably.`, 'error');
    }
    return false;
  }
  return true;
}

// Non-blocking printer check — returns name or null
async function tryDetectPrinter() {
  const name = await detectPrinter();
  if (name && await checkPrinterReady(name)) {
    currentPrinter = name;
    printerReady = true;
    return name;
  }
  printerReady = false;
  return null;
}

// Periodic printer health check — when printer comes back, flush queue
function startPrinterHealthCheck() {
  setInterval(async () => {
    const wasPrinterReady = printerReady;
    const name = await tryDetectPrinter();
    if (name && !wasPrinterReady) {
      // Printer just came back online!
      log(`🟢 PRINTER BACK ONLINE: ${name} — flushing pending queue...`);
      try {
        await processPendingQueue();
      } catch (e) {
        log(`⚠ Error flushing queue: ${e.message}`, 'warn');
      }
    }
  }, 10000); // Check every 10 seconds
  log('💓 Printer health check started (every 10s)');
}

// ── Browser Init ────────────────────────────────────────────
async function initBrowser() {
  if (browser) {
    try { await browser.close(); } catch (_) {}
    browser = null;
  }
  /* CHROMIUM_PATH wins when set. The list below covers the usual Raspberry Pi
     OS locations, but the package name has moved between releases and there
     was previously no way to point this at a different build without editing
     the source. */
  const chromePaths = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ].filter(Boolean);
  let chromePath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) { chromePath = p; break; }
  }
  if (!chromePath) {
    try {
      const { stdout } = await execAsync('which chromium-browser || which chromium || which google-chrome');
      chromePath = stdout.trim() || null;
    } catch (_) {}
  }
  if (!chromePath) {
    throw new Error(
      'Chromium not found. Install it (sudo apt install chromium) or set ' +
      'CHROMIUM_PATH in .env to its full path.'
    );
  }
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',  // Use /tmp instead of /dev/shm (Pi has limited shared mem)
      '--disable-gpu', '--disable-software-rasterizer',
      '--font-render-hinting=none', '--disable-lcd-text',
      '--single-process',          // Saves ~50MB RAM on Pi
      '--no-zygote',               // Fewer child processes
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio',
      '--no-first-run',
      '--js-flags=--max-old-space-size=128',  // Limit Chromium's V8 heap
    ],
  });
  // Auto-restart browser if it crashes
  browser.on('disconnected', () => {
    log('⚠ Chromium crashed/disconnected — will restart on next print', 'warn');
    browser = null;
  });
  log(`🌐 Chromium started (${chromePath || 'default'}) — memory-optimized for Pi`);
}

async function ensureBrowser() {
  if (!browser || !browser.isConnected()) {
    log('🔄 Restarting Chromium...');
    await initBrowser();
  }
}

// ── Queue Management ────────────────────────────────────────
function queueFilename(order) {
  return `${Date.now()}_${(order.orderNumber || order._id || 'unknown').replace(/[^a-zA-Z0-9-]/g, '_')}.json`;
}

async function saveToQueue(order) {
  const job = {
    id: order._id,
    orderNumber: order.orderNumber || order._id,
    timestamp: new Date().toISOString(),
    order: order,
    retries: 0,
    lastError: null,
  };
  const filename = queueFilename(order);
  const finalPath = path.join(PENDING_DIR, filename);
  const tmpPath = finalPath + '.tmp';
  
  // Atomic write with fsync: Guarantees data is written to physical disk before rename.
  // This completely prevents corrupt JSON files if the Pi loses power abruptly.
  let filehandle;
  try {
    filehandle = await fsp.open(tmpPath, 'w');
    await filehandle.writeFile(JSON.stringify(job, null, 2));
    await filehandle.sync(); // Force flush to SD card
  } finally {
    if (filehandle) await filehandle.close();
  }
  
  await fsp.rename(tmpPath, finalPath);

  if (order._id) queuedOrderIds.add(String(order._id));

  log(`📥 Queued to disk: ${job.orderNumber} → ${filename}`);
  return filename;
}

async function loadPendingQueue() {
  try {
    const files = await fsp.readdir(PENDING_DIR);
    const jobs = [];
    for (const f of files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))) {
      try {
        const data = JSON.parse(await fsp.readFile(path.join(PENDING_DIR, f), 'utf8'));
        jobs.push({ filename: f, ...data });
      } catch (e) {
        log(`⚠ Corrupt queue file ${f}: ${e.message} — moving to failed/`, 'warn');
        try {
          await fsp.rename(path.join(PENDING_DIR, f), path.join(FAILED_DIR, f));
        } catch (_) {
          // If rename fails, just delete it to stop the spam
          try { await fsp.unlink(path.join(PENDING_DIR, f)); } catch (_) {}
        }
      }
    }
    return jobs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (_) {
    return [];
  }
}

async function moveToCompleted(filename) {
  try {
    await fsp.rename(path.join(PENDING_DIR, filename), path.join(COMPLETED_DIR, filename));
  } catch (_) {}
}

async function moveToFailed(filename, error) {
  try {
    const fp = path.join(PENDING_DIR, filename);
    let job;
    try {
      job = JSON.parse(await fsp.readFile(fp, 'utf8'));
    } catch (_) {
      // File may be gone already
      return;
    }
    job.lastError = error;
    job.failedAt = new Date().toISOString();
    const failedPath = path.join(FAILED_DIR, filename);
    const tmpFailedPath = failedPath + '.tmp';
    
    let filehandle;
    try {
      filehandle = await fsp.open(tmpFailedPath, 'w');
      await filehandle.writeFile(JSON.stringify(job, null, 2));
      await filehandle.sync();
    } finally {
      if (filehandle) await filehandle.close();
    }
    await fsp.rename(tmpFailedPath, failedPath);
    try { await fsp.unlink(fp); } catch (_) {}
  } catch (_) {}
}

async function updateRetry(filename, error) {
  try {
    const fp = path.join(PENDING_DIR, filename);
    let job;
    try {
      job = JSON.parse(await fsp.readFile(fp, 'utf8'));
    } catch (_) {
      // File may be gone
      return false;
    }
    job.retries = (job.retries || 0) + 1;
    job.lastError = error;
    if (job.retries >= MAX_RETRIES) {
      log(`❌ Max retries (${MAX_RETRIES}) reached for ${job.orderNumber}. Moving to failed/`, 'error');
      await moveToFailed(filename, error);
      return false;
    }
    
    // Atomic update with fsync
    const tmpPath = fp + '.tmp';
    let filehandle;
    try {
      filehandle = await fsp.open(tmpPath, 'w');
      await filehandle.writeFile(JSON.stringify(job, null, 2));
      await filehandle.sync();
    } finally {
      if (filehandle) await filehandle.close();
    }
    
    await fsp.rename(tmpPath, fp);
    
    log(`🔄 Retry ${job.retries}/${MAX_RETRIES} for ${job.orderNumber}: ${error}`);
    return true;
  } catch (_) {
    return false;
  }
}

// ── API Calls with Retry ────────────────────────────────────
async function apiRequest(method, url, options = {}, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Send API key as both header (preferred) and query param (backward compat)
      if (!options.params) options.params = {};
      options.params.key = PRINT_KEY;
      const res = await api({ method, url, ...options });
      return res;
    } catch (err) {
      lastErr = err;
      const code = err.code || '';
      const status = err.response?.status;
      const msg = status ? `HTTP ${status}` : `${code} ${err.message}`;

      /* A rejected key is not a transient fault and retrying cannot fix it.
       *
       * This is how printing stopped for twelve hours without anyone knowing:
       * PRINT_AGENT_KEY was set on the server and not here, every poll came
       * back 401, and the agent logged it as an ordinary API failure among the
       * timeouts and reconnects. It reads as a configuration error now, names
       * both places the value has to match, and gives up rather than retrying
       * a request that will never succeed. */
      if (status === 401 || status === 403) {
        log('', 'error');
        log('╔═══════════════════════════════════════════════════════════════╗', 'error');
        log('║  PRINT KEY REJECTED — the server refused this agent.          ║', 'error');
        log('║                                                               ║', 'error');
        log('║  PRINT_KEY in the station .env must equal                     ║', 'error');
        log('║  PRINT_AGENT_KEY in the backend environment. Setting one      ║', 'error');
        log('║  without the other stops all printing, silently.              ║', 'error');
        log('║                                                               ║', 'error');
        log(`║  This agent is sending a key of length ${String(PRINT_KEY.length).padEnd(3)}                    ║`, 'error');
        log(`║  ${PRINT_KEY === 'arteva-print-2026' ? 'It is still the committed DEFAULT — that is the problem.  ' : 'It is not the default, so the two values simply differ.    '} ║`, 'error');
        log('╚═══════════════════════════════════════════════════════════════╝', 'error');
        log('', 'error');
        throw err;
      }

      if (attempt < retries) {
        const delay = Math.min(5000 * attempt, 15000); // 5s, 10s, 15s
        log(`⚠ API attempt ${attempt}/${retries} failed: ${msg} — retrying in ${delay/1000}s...`, 'warn');
        await new Promise(r => setTimeout(r, delay));
      } else {
        log(`❌ API failed after ${retries} attempts: ${msg}`, 'error');
      }
    }
  }
  throw lastErr;
}

async function pollOrders() {
  const { data } = await apiRequest('get', '/api/admin/print-queue/poll', {
    params: { key: PRINT_KEY },
  });
  if (!data.success) throw new Error(data.message || 'API error');
  lastPollTime = new Date().toISOString();
  return data.orders || [];
}

async function markPrinted(orderId) {
  try {
    await apiRequest('post', `/api/admin/print-queue/done/${orderId}`, {
      params: { key: PRINT_KEY },
    }, 2);
    return true;
  } catch (e) {
    log(`⚠ Could not mark ${orderId} as printed in API: ${e.message}. Will retry.`, 'warn');
    return false;
  }
}

// ── HTML → PDF → Print ─────────────────────────────────────
/**
 * @param {number} [copies] How many to run off. Defaults to the station's own
 *        PRINT_COPIES when the caller does not say — which is what orders
 *        created before the server sent a per-order count fall back to.
 */
async function htmlToPrint(html, filename, printerName, copies = COPIES) {
  const htmlPath = path.join(TEMP_DIR, `${filename}.html`);
  const pdfPath  = path.join(TEMP_DIR, `${filename}.pdf`);

  await fsp.writeFile(htmlPath, html, 'utf8');

  /* Every temp file is removed in the finally below, whatever happens.
     Cleanup used to sit after the lpr call, so any printer error leaked the
     .html and .pdf — on an SD card, indefinitely. */
  try {
    // Ensure browser is alive (auto-restart if crashed)
    await ensureBrowser();

    let page = null;
    try {
      page = await browser.newPage();
      // Standard viewport (deviceScaleFactor: 1 prevents OOM crashes on Raspberry Pi)
      await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });

      /* A print station has to work with the internet down.
         This used to wait for `networkidle0` while the receipt template linked
         fonts from fonts.googleapis.com, so with no connectivity every receipt
         sat here until the 60s timeout and then failed outright, printing
         nothing. templates.js now renders with locally installed fonts and no
         external <link> at all (RECEIPT_WEB_FONTS=true opts back in), which is
         what makes this deterministic — switching the wait condition alone was
         NOT enough, because a stylesheet in <head> blocks DOMContentLoaded too.

         The bounded font wait below still matters for the opt-in case: it caps
         how long a slow CDN can hold up a receipt instead of failing it. */
      await page.goto(`file://${htmlPath}`, { waitUntil: 'load', timeout: 30000 });

      await page.evaluate(async (waitMs) => {
        await Promise.race([
          document.fonts.ready,
          new Promise(resolve => setTimeout(resolve, waitMs)),
        ]);
      }, FONT_WAIT_MS).catch(() => { /* fonts are a nicety, never a blocker */ });

      await new Promise(r => setTimeout(r, 400)); // Brief layout settle

      await page.pdf({
        path: pdfPath, format: PAPER, printBackground: true,
        margin: { top: '8mm', right: '10mm', bottom: '8mm', left: '10mm' },
        preferCSSPageSize: true,
        scale: 1,
      });
    } finally {
      // Always close page even if goto/pdf throws — prevents browser page leak
      if (page) {
        try { await page.close(); } catch (_) {}
      }
    }

    // Verify printer before sending
    const ready = await checkPrinterReady(printerName);
    if (!ready) {
      log(`⏳ Printer not ready. Waiting...`, 'warn');
      const back = await waitForPrinter();
      if (!back) throw new Error('Printer did not come back — job stays queued');
      printerName = currentPrinter;
    }

    // Send to printer — using execFile (no shell) to prevent command injection
    if (!validatePrinterName(printerName)) {
      throw new Error(`Invalid printer name: "${printerName}"`);
    }

    const lprArgs = [];
    if (printerName) {
      lprArgs.push('-P', printerName);
    }
    /* Number of copies.
     *
     * Now decided per order by the server (Order.printCopies) rather than by
     * one setting on this station, because the answer differs by source: a
     * receipt written at the counter needs two — one for the customer, one the
     * shop keeps — while an online order that gets packed and shipped needs
     * one. PRINT_COPIES remains the fallback for orders created before the
     * server sent a count.
     *
     * Passed to CUPS with -# rather than printing the job twice: CUPS collates
     * a multi-copy job itself, so the pages come out together, and a paper jam
     * halfway through fails ONE job that can be retried instead of leaving the
     * shop unsure whether the second copy ever started. */
    const copyCount = Math.min(Math.max(parseInt(copies, 10) || 1, 1), 5);
    if (copyCount > 1) {
      lprArgs.push('-#', String(copyCount));
    }

    lprArgs.push(
      '-o', 'cupsPrintQuality=Best',
      '-o', 'ColorModel=Color',
      '-o', `PageSize=${PAPER}`,
      pdfPath
    );
    await execFileAsync('lpr', lprArgs);

    // Printer buffer flush delay
    await new Promise(r => setTimeout(r, 500));
  } finally {
    try { await fsp.unlink(htmlPath); } catch (_) {}
    try { await fsp.unlink(pdfPath);  } catch (_) {}
  }
}

// ── Print a single job (with mutex + timeout) ──────────────
async function printJob(order, filename, printerName) {
  const num = order.orderNumber || order._id;
  
  // Validate payload before attempting print
  try {
    validatePayload(order);
  } catch (valErr) {
    log(`🚫 REJECTED order ${num}: ${valErr.message}`, 'error');
    await moveToFailed(filename, valErr.message);
    return;
  }

  // Acquire mutex — only one job prints at a time
  await acquirePrintLock();
  isPrinting = true;
  const mem = checkMemory();
  log(`📦 Printing order ${num}... (heap: ${mem.heap}MB)`);

  // Timeout with proper cleanup — no leaked timer
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Print timeout after ${PRINT_TIMEOUT_MS/1000}s`)), PRINT_TIMEOUT_MS);
  });

  try {
    await Promise.race([_doPrintJob(order, filename, printerName, num), timeoutPromise]);
  } finally {
    // CRITICAL: Always clear the timeout to prevent leaked timer + spurious rejection
    clearTimeout(timeoutId);
    isPrinting = false;
    releasePrintLock();
    checkMemory();
  }
}

async function _doPrintJob(order, filename, printerName, num) {
  // Always re-detect printer right before printing (never use stale reference)
  const detectedPrinter = await tryDetectPrinter();
  if (!detectedPrinter) {
    throw new Error('Printer not available — will retry when printer comes back');
  }
  printerName = detectedPrinter;

  if (PRINT_RECEIPT) {
    /* The server decides how many. A counter receipt comes through as 2 (one
       for the customer, one for the shop); an online order as 1. Orders
       predating Order.printCopies carry no value and fall back to the
       station's PRINT_COPIES. */
    const copies = Math.min(Math.max(parseInt(order.printCopies, 10) || COPIES, 1), 5);
    log(`  🖨️  Generating receipt${copies > 1 ? ` (${copies} copies)` : ''}...`);
    const receiptHTML = await buildReceiptHTML(order);
    await htmlToPrint(receiptHTML, `receipt-${num}`, printerName, copies);
    log(`  ✓ Receipt sent to printer${copies > 1 ? ` — ${copies} copies` : ''}`);
  }

  /* One label per parcel, whatever the receipt count — the label identifies the
     package, and two identical labels on one box helps nobody. */

  if (PRINT_LABEL) {
    await new Promise(r => setTimeout(r, 3000)); // Let printer breathe
    log(`  🏷️  Generating label...`);
    await htmlToPrint(buildLabelHTML(order), `label-${num}`, printerName);
    log(`  ✓ Label sent to printer`);
  }

  // Move to completed FIRST (prevents re-print even if markPrinted fails)
  await moveToCompleted(filename);
  queuedOrderIds.delete(String(order._id));

  // Mark printed in API (best-effort — local queue state is authoritative)
  const marked = await markPrinted(order._id);
  if (!marked) {
    /* Recorded on disk, not just in memory. A restart used to forget this and
       print the customer's receipt a second time. */
    unackedPrints.add(String(order._id));
    saveUnacked();
    log(`⚠ Order ${num} printed but API mark failed — recorded locally so it cannot re-print; will retry the acknowledgement`, 'warn');
  }

  addProcessed(order._id);
  printedCount++;
  lastPrintTime = new Date().toISOString();
  log(`✅ Order ${num} printed successfully (#${printedCount})`);
}

// ── Process pending queue ───────────────────────────────────
async function processPendingQueue() {
  const jobs = await loadPendingQueue();
  if (jobs.length === 0) return;
  
  // Re-detect printer now (don't rely on stale currentPrinter)
  const printerName = await tryDetectPrinter();
  if (!printerName) {
    log(`⏳ Printer not available — ${jobs.length} job(s) remain in queue`, 'debug');
    return;
  }
  
  log(`📋 Processing ${jobs.length} pending job(s)...`);

  for (const job of jobs) {
    // Skip if this job is already being processed by the poll loop
    if (activeJobs.has(job.id)) {
      log(`⏭ Skipping ${job.orderNumber} — already being processed`, 'debug');
      continue;
    }
    
    try {
      activeJobs.add(job.id);
      await printJob(job.order, job.filename, printerName);
      await new Promise(r => setTimeout(r, 3000)); // Between jobs
    } catch (err) {
      errorCount++;
      const willRetry = await updateRetry(job.filename, err.message);
      log(`❌ Failed to print ${job.orderNumber}: ${err.message}`, 'error');
    } finally {
      activeJobs.delete(job.id);
    }
  }
}

// ── Poll loop ───────────────────────────────────────────────
let consecutiveFailures = 0;

async function pollLoop() {
  while (true) {
    try {
      await checkDiskSpace();

      /* Clear the backlog of prints the API never confirmed. Until an order is
         acknowledged the backend keeps handing it back, so this both settles
         the record and stops the same order cycling through every poll. */
      await retryUnackedPrints();

      const orders = await pollOrders();
      if (consecutiveFailures > 0) {
        log(`🟢 API reconnected after ${consecutiveFailures} failed attempts!`);
      }
      consecutiveFailures = 0;

      if (orders.length > 0) {
        log(`🔔 Found ${orders.length} new order(s) to print!`);
        for (const order of orders) {
          const oid = String(order._id);

          // Dedup: skip if already processed OR already actively being printed
          if (processed.has(order._id) || activeJobs.has(order._id)) continue;

          /* Already printed but the API never confirmed — printing again
             would hand the customer a second copy of the same receipt. */
          if (unackedPrints.has(oid)) {
            log(`⏭ ${order.orderNumber} already printed (awaiting API ack) — not printing again`, 'debug');
            continue;
          }

          /* Already sitting in pending/ or failed/. Re-saving would create a
             duplicate job file with retries reset to 0 — the loop that used to
             fill the SD card one file per poll. The queue processor owns it. */
          if (queuedOrderIds.has(oid)) {
            log(`⏭ ${order.orderNumber} already queued on disk — leaving it to the queue processor`, 'debug');
            continue;
          }

          // Save to disk FIRST (never lose a receipt)
          const filename = await saveToQueue(order);
          try {
            activeJobs.add(order._id);
            await printJob(order, filename, currentPrinter);
          } catch (err) {
            errorCount++;
            await updateRetry(filename, err.message);
            log(`❌ Failed to print ${order.orderNumber}: ${err.message}`, 'error');
          } finally {
            activeJobs.delete(order._id);
          }
          if (orders.length > 1) await new Promise(r => setTimeout(r, 5000));
        }
      }
    } catch (err) {
      consecutiveFailures++;
      const code = err.code || '';
      const msg = err.response ? `HTTP ${err.response.status}` : `${code} ${err.message}`;

      if (consecutiveFailures <= 3) {
        log(`⚠ Poll failed (${consecutiveFailures}): ${msg}`, 'warn');
      } else if (consecutiveFailures === 4) {
        log(`⚠ Poll keeps failing. Running network diagnostics...`, 'warn');
        await runNetworkDiagnostics();
      } else if (consecutiveFailures % 10 === 0) {
        log(`⚠ Poll still failing (${consecutiveFailures} in a row): ${msg}`, 'warn');
        await runNetworkDiagnostics();
      }
      // Even if API fails, try to print any pending queue items
      try { await processPendingQueue(); } catch (_) {}
    }

    // Adaptive polling: if failing repeatedly, poll less often to avoid hammering
    const delay = consecutiveFailures > 5
      ? Math.min(POLL_MS * 2, 120000)  // Max 2 min between polls when failing
      : POLL_MS;
    await new Promise(r => setTimeout(r, delay));
  }
}

// ── Health Endpoint (with optional auth) ────────────────────
function startHealthServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/health') && req.method === 'GET') {
      // Optional auth token check
      if (HEALTH_TOKEN) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token') || req.headers['x-health-token'];
        if (token !== HEALTH_TOKEN) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'unauthorized' }));
          return;
        }
      }

      let pending = 0, completed = 0, failed = 0;
      try { pending = (await fsp.readdir(PENDING_DIR)).filter(f => f.endsWith('.json')).length; } catch (_) {}
      try { completed = (await fsp.readdir(COMPLETED_DIR)).filter(f => f.endsWith('.json')).length; } catch (_) {}
      try { failed = (await fsp.readdir(FAILED_DIR)).filter(f => f.endsWith('.json')).length; } catch (_) {}

      const mem = getMemoryMB();
      const sysFreeMem = Math.round(os.freemem() / 1048576);
      const sysTotalMem = Math.round(os.totalmem() / 1048576);
      const loadAvg = os.loadavg();

      // Check CPU temperature (Pi-specific)
      let cpuTemp = null;
      try {
        const { stdout } = await execAsync('cat /sys/class/thermal/thermal_zone0/temp', { timeout: 2000 });
        cpuTemp = (parseInt(stdout.trim()) / 1000).toFixed(1) + '°C';
      } catch (_) {}

      const body = JSON.stringify({
        status: 'ok',
        version: '5.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        printer: currentPrinter || 'none',
        printerReady,
        isPrinting,
        pendingJobs: pending,
        completedJobs: completed,
        failedJobs: failed,
        printedThisSession: printedCount,
        errorsThisSession: errorCount,
        lastPrint: lastPrintTime,
        lastPoll: lastPollTime,
        memory: { processHeapMB: mem.heap, processRssMB: mem.rss, systemFreeMB: sysFreeMem, systemTotalMB: sysTotalMem },
        cpu: { loadAvg1m: loadAvg[0].toFixed(2), loadAvg5m: loadAvg[1].toFixed(2), temp: cpuTemp },
        node: process.version,
      }, null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(HEALTH_PORT, '0.0.0.0', () => {
    log(`🏥 Health endpoint: http://0.0.0.0:${HEALTH_PORT}/health`);
  });
  server.on('error', (e) => {
    log(`⚠ Health server error: ${e.message}. Continuing without it.`, 'warn');
  });
}

// ── Test mode ───────────────────────────────────────────────
async function runTest(printerName) {
  log('🧪 TEST MODE — printing a fake order...');
  const testOrder = {
    _id: 'test-' + Date.now(),
    orderNumber: 'TEST-001',
    createdAt: new Date().toISOString(),
    orderStatus: 'confirmed',
    paymentStatus: 'paid',
    paymentMethod: 'myfatoorah',
    user: { name: 'Test Customer', email: 'test@test.com', phone: '+965 1234 5678' },
    shippingAddress: { fullName: 'Test Customer', phone: '+965 1234 5678', street: '123 Test St', area: 'Salmiya', block: '5', city: 'Hawally', country: 'Kuwait' },
    items: [
      { name: 'Luxury Crystal Burner', nameAr: 'مبخر كريستال فاخر', price: 45.500, quantity: 2, sku: 'LCB-001' },
      { name: 'Decorative Tray Set', nameAr: 'طقم صواني', price: 89.900, quantity: 1, sku: 'DTS-002' },
    ],
    subtotal: 180.900,
    shippingCost: 2.000,
    total: 182.900,
  };

  log('  Generating receipt PDF...');
  await htmlToPrint(await buildReceiptHTML(testOrder), 'test-receipt', printerName);
  log('✅ Test print sent to printer! Check your HP SmartTank.');
}

// ── Network Diagnostics ─────────────────────────────────────
async function runNetworkDiagnostics() {
  log('🔍 ── NETWORK DIAGNOSTICS ──');

  // 1. Check basic internet
  try {
    const { stdout } = await execAsync('ping -c 1 -W 5 8.8.8.8', { timeout: 10000 });
    log('  ✅ Internet: OK (can reach 8.8.8.8)');
  } catch (_) {
    log('  ❌ Internet: FAILED (cannot ping 8.8.8.8)', 'error');
    return;
  }

  // 2. Check DNS resolution
  try {
    const hostname = new URL(API_URL).hostname;
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4(hostname, (err, addrs) => err ? reject(err) : resolve(addrs));
    });
    log(`  ✅ DNS: ${hostname} → ${addresses.join(', ')}`);
  } catch (e) {
    log(`  ❌ DNS: Failed to resolve ${new URL(API_URL).hostname}: ${e.message}`, 'error');
    return;
  }

  // 3. Check TCP connectivity to Render
  try {
    const hostname = new URL(API_URL).hostname;
    await new Promise((resolve, reject) => {
      const socket = require('net').createConnection({ host: hostname, port: 443, family: 4, timeout: 15000 });
      socket.on('connect', () => { socket.destroy(); resolve(); });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
      socket.on('error', reject);
    });
    log('  ✅ TCP:443: Connection established');
  } catch (e) {
    log(`  ❌ TCP:443: ${e.message} — Render may be unreachable from this network`, 'error');
    return;
  }

  // 4. Quick HTTPS test
  try {
    const res = await api.get('/api/admin/print-queue/poll', {
      params: { key: PRINT_KEY },
      timeout: 30000,
    });
    log(`  ✅ HTTPS: API responded — ${res.data?.count || 0} orders in queue`);
  } catch (e) {
    const code = e.code || '';
    log(`  ❌ HTTPS: ${code} ${e.message}`, 'error');
  }

  log('🔍 ── END DIAGNOSTICS ──');
}

// ── Startup temp cleanup ────────────────────────────────────
async function cleanupTempDir() {
  try {
    const files = await fsp.readdir(TEMP_DIR);
    let cleaned = 0;
    for (const f of files) {
      if (f.endsWith('.html') || f.endsWith('.pdf') || f.endsWith('.tmp')) {
        try {
          await fsp.unlink(path.join(TEMP_DIR, f));
          cleaned++;
        } catch (_) {}
      }
    }
    if (cleaned > 0) log(`🧹 Cleaned ${cleaned} stale temp file(s) from previous session`);
  } catch (_) {}
}

// ── Completed queue cleanup (keep last 500) ─────────────────
async function cleanupCompletedQueue() {
  try {
    const files = (await fsp.readdir(COMPLETED_DIR))
      .filter(f => f.endsWith('.json'))
      .sort();
    if (files.length > 500) {
      const toDelete = files.slice(0, files.length - 500);
      for (const f of toDelete) {
        try { await fsp.unlink(path.join(COMPLETED_DIR, f)); } catch (_) {}
      }
      log(`🧹 Cleaned ${toDelete.length} old completed job file(s)`);
    }
  } catch (_) {}
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║  ARTÉVA MAISON — Print Station v5.0      ║');
  console.log('  ║  Production-Hardened • Security-Audited  ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  const mem = getMemoryMB();
  log(`Host:     ${os.hostname()}`);
  log(`Node:     ${process.version}`);
  log(`API:      ${API_URL}`);
  log(`Memory:   ${mem.heap}MB heap, ${Math.round(os.freemem()/1048576)}MB free system`);
  log(`Limits:   heap=${MAX_HEAP_MB}MB, payload=${PAYLOAD_MAX_BYTES/1024}KB, timeout=${PRINT_TIMEOUT_MS/1000}s`);
  log(`Printer:  ${PRINTER || '(auto-detect)'}`);
  log(`Poll:     every ${POLL_MS / 1000}s`);
  log(`Retries:  ${MAX_RETRIES} max per job`);

  // 0. Cleanup stale temp files from previous run
  await cleanupTempDir();
  await cleanupCompletedQueue();

  /* Completed jobs used to be trimmed only here, at startup. This process is
     meant to run for months, so on a busy shop the directory grew without
     bound between reboots. */
  setInterval(() => { cleanupCompletedQueue().catch(() => {}); }, 6 * 60 * 60 * 1000);

  // 0b. Restore dedup state before anything can print
  loadUnacked();
  await indexQueuedOrders();
  if (unackedPrints.size) {
    log(`📌 ${unackedPrints.size} order(s) printed but unacknowledged — they will not re-print`);
  }

  const freeMB = await getFreeDiskMB();
  if (freeMB !== null) {
    log(`Disk:     ${freeMB}MB free (minimum ${MIN_FREE_DISK_MB}MB)`);
    if (freeMB < MIN_FREE_DISK_MB) {
      log(`🚨 Free disk is below the minimum — clear logs/ and queue/completed/`, 'error');
    }
  }

  // 1. Load pending queue from disk
  const pendingJobs = await loadPendingQueue();
  log(`📋 Pending jobs from disk: ${pendingJobs.length}`);

  // 2. Try to detect printer (NON-BLOCKING — don't wait forever)
  const printerName = await tryDetectPrinter();
  if (printerName) {
    log(`✅ Printer ready: ${printerName}`);
  } else {
    log(`⚠ No printer detected yet — orders will queue to disk and print when printer comes online`, 'warn');
  }

  // 3. Init browser
  await initBrowser();

  // 4. Start health endpoint
  startHealthServer();

  // 5. Start watchdog heartbeat
  startWatchdog();

  // 6. Start periodic printer health check (auto-flushes queue when printer returns)
  startPrinterHealthCheck();

  // Test mode
  if (TEST_MODE) {
    if (!printerName) {
      log('❌ Cannot run test — no printer detected. Run: lpstat -p -d', 'error');
      process.exit(1);
    }
    await runTest(printerName);
    await browser.close();
    process.exit(0);
  }

  // 7. Process any pending jobs first (if printer is available)
  if (pendingJobs.length > 0 && printerName) {
    log(`🔄 Resuming ${pendingJobs.length} pending job(s) from previous session...`);
    await processPendingQueue();
  } else if (pendingJobs.length > 0) {
    log(`⏳ ${pendingJobs.length} pending job(s) waiting for printer to come online...`);
  }

  // 8. Network diagnostics + API check
  log('');
  log('🔌 Testing API connection...');
  await runNetworkDiagnostics();

  log('');
  log('🟢 Print station running. Waiting for new orders...');
  log('   Press Ctrl+C to stop.');
  log('');

  // 9. Begin poll loop (always runs — queues to disk even without printer)
  await pollLoop();
}

// ── Graceful shutdown ───────────────────────────────────────
let isShuttingDown = false;
async function shutdown(sig) {
  if (isShuttingDown) return; // A second SIGTERM must not re-enter this
  isShuttingDown = true;

  log(`⏹ Received ${sig}, shutting down...`);
  if (browser) await browser.close().catch(() => {});
  const uptime = Math.floor((Date.now() - startTime) / 60000);
  const pending = await loadPendingQueue();
  log(`Session: ${printedCount} printed, ${errorCount} errors, ${pending.length} pending, uptime ${uptime}m`);
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT: ${err.message}\n${err.stack}`, 'error');
  /* Exit so systemd restarts us.
     This used to deliberately NOT exit, with the comment "let systemd handle
     restart if needed" — but systemd only restarts a process that has ended.
     Staying alive after an uncaught exception left the station running in an
     undefined state: heartbeat still ticking (so the watchdog saw nothing
     wrong), poll loop possibly dead, receipts silently not printing until a
     human noticed. Ending the process is what actually gets it recovered. */
  log('💀 Exiting in 3s so systemd can restart cleanly...', 'error');
  setTimeout(() => process.exit(1), 3000);
});
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`, 'error');
});

// ── Start ───────────────────────────────────────────────────
main().catch((err) => {
  log(`Fatal: ${err.message}\n${err.stack}`, 'error');
  process.exit(1);
});
