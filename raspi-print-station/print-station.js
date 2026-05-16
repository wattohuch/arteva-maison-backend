#!/usr/bin/env node

/**
 * ARTÉVA MAISON — Raspberry Pi Print Station v3
 * PRODUCTION-GRADE — Fault-tolerant, auto-recovering, persistent queue
 *
 * Features:
 *  - Persistent disk queue (pending/completed/failed)
 *  - Printer readiness validation before every print
 *  - Auto-reconnect on printer disconnect
 *  - Watchdog heartbeat (restarts if frozen)
 *  - HTTP health endpoint on :3100
 *  - Winston rotating logs
 *  - Resumes pending jobs after reboot/crash
 *  - Continues printing even if internet/API fails
 *  - Retry failed jobs up to 5 times
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
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
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
  headers: { 'Connection': 'keep-alive' },
  // Force IPv4 at the axios level too
  family: 4,
});

// ── Config ──────────────────────────────────────────────────
const API_URL    = api.defaults.baseURL;
const PRINT_KEY  = process.env.PRINT_KEY || 'arteva-print-2026';
const POLL_MS    = (parseInt(process.env.POLL_SECONDS) || 30) * 1000;
const PRINTER    = process.env.PRINTER_NAME || '';
const PAPER      = process.env.PAPER_SIZE || 'A4';
const PRINT_RECEIPT = process.env.PRINT_RECEIPT !== 'false';
const PRINT_LABEL   = process.env.PRINT_LABEL === 'true';
const TEST_MODE     = process.env.TEST_MODE === 'true';
const HEALTH_PORT   = parseInt(process.env.HEALTH_PORT) || 3100;
const MAX_RETRIES   = parseInt(process.env.MAX_RETRIES) || 5;

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

// ── Winston Logger ──────────────────────────────────────────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

function log(msg, level = 'info') { logger.log(level, msg); }

// ── State ───────────────────────────────────────────────────
const startTime = Date.now();
let printedCount = 0;
let errorCount = 0;
let lastPrintTime = null;
let lastPollTime = null;
let currentPrinter = null;
let printerReady = false;
let browser = null;
const processed = new Set(); // In-session dedup

// ── Watchdog Heartbeat ──────────────────────────────────────
function startWatchdog() {
  const hbPath = '/tmp/print-heartbeat';
  const write = () => {
    try { fs.writeFileSync(hbPath, Math.floor(Date.now() / 1000).toString()); } catch (_) {}
  };
  write();
  setInterval(write, 5000);
  log('💓 Watchdog heartbeat started');
}

// ── Printer Detection & Readiness ───────────────────────────
async function detectPrinter() {
  if (PRINTER) {
    try {
      const { stdout } = await execAsync('lpstat -p');
      if (stdout.includes(PRINTER)) return PRINTER;
    } catch (_) {}
  }
  // Auto-detect
  try {
    const { stdout } = await execAsync('lpstat -d');
    const m = stdout.match(/destination:\s*(.+)/);
    if (m) return m[1].trim();
  } catch (_) {}
  try {
    const { stdout } = await execAsync('lpstat -p');
    const m = stdout.match(/printer\s+(\S+)/);
    if (m) return m[1];
  } catch (_) {}
  return null;
}

async function checkPrinterReady(name) {
  if (!name) return false;
  try {
    const { stdout } = await execAsync(`lpstat -p "${name}"`);
    const ready = !stdout.includes('disabled') && !stdout.includes('rejecting');
    return ready;
  } catch (_) {
    return false;
  }
}

async function waitForPrinter() {
  log('🔍 Detecting printer...');
  let attempts = 0;
  while (true) {
    const name = await detectPrinter();
    if (name) {
      const ready = await checkPrinterReady(name);
      if (ready) {
        currentPrinter = name;
        printerReady = true;
        log(`✅ Printer ready: ${name}`);
        return name;
      }
      log(`⏳ Printer "${name}" found but not ready. Retrying... (${++attempts})`);
    } else {
      log(`⏳ No printer detected. Retrying... (${++attempts})`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
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
        await processPendingQueue(name);
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
  const chromePaths = [
    '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/usr/bin/google-chrome', '/snap/bin/chromium',
  ];
  let chromePath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) { chromePath = p; break; }
  }
  if (!chromePath) {
    try {
      const { stdout } = await execAsync('which chromium-browser || which chromium');
      chromePath = stdout.trim();
    } catch (_) {}
  }
  browser = await puppeteer.launch({
    executablePath: chromePath || '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text'],
  });
  // Auto-restart browser if it crashes
  browser.on('disconnected', () => {
    log('⚠ Chromium crashed/disconnected — will restart on next print', 'warn');
    browser = null;
  });
  log(`🌐 Chromium started (${chromePath || 'default'})`);
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
  
  log(`📥 Queued to disk: ${job.orderNumber} → ${filename}`);
  return filename;
}

async function loadPendingQueue() {
  try {
    const files = await fsp.readdir(PENDING_DIR);
    const jobs = [];
    for (const f of files.filter(f => f.endsWith('.json'))) {
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
    const job = JSON.parse(await fsp.readFile(fp, 'utf8'));
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
    await fsp.unlink(fp);
  } catch (_) {}
}

async function updateRetry(filename, error) {
  try {
    const fp = path.join(PENDING_DIR, filename);
    const job = JSON.parse(await fsp.readFile(fp, 'utf8'));
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
      const res = await api({ method, url, ...options });
      return res;
    } catch (err) {
      lastErr = err;
      const code = err.code || '';
      const status = err.response?.status;
      const msg = status ? `HTTP ${status}` : `${code} ${err.message}`;

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
  } catch (e) {
    log(`⚠ Could not mark ${orderId} as printed in API: ${e.message}. Will retry.`, 'warn');
  }
}

// ── HTML → PDF → Print ─────────────────────────────────────
async function htmlToPrint(html, filename, printerName) {
  const htmlPath = path.join(TEMP_DIR, `${filename}.html`);
  const pdfPath  = path.join(TEMP_DIR, `${filename}.pdf`);

  await fsp.writeFile(htmlPath, html, 'utf8');

  // Ensure browser is alive (auto-restart if crashed)
  await ensureBrowser();

  const page = await browser.newPage();
  try {
    // Ultra-high DPI viewport for crystal clear text
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 3 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000)); // Extra time for fonts + QR to render at full quality
    await page.pdf({
      path: pdfPath, format: PAPER, printBackground: true,
      margin: { top: '8mm', right: '10mm', bottom: '8mm', left: '10mm' },
      preferCSSPageSize: true,
      scale: 1,
    });
  } finally {
    await page.close();
  }

  // Verify printer before sending
  const ready = await checkPrinterReady(printerName);
  if (!ready) {
    log(`⏳ Printer not ready. Waiting...`, 'warn');
    await waitForPrinter();
    printerName = currentPrinter;
  }

  // Send to printer — options match lpoptions -l output exactly
  const qualityOpts = '-o cupsPrintQuality=Best -o ColorModel=Color -o PageSize=A4';
  const cmd = printerName ? `lpr -P "${printerName}" ${qualityOpts} "${pdfPath}"` : `lpr ${qualityOpts} "${pdfPath}"`;
  await execAsync(cmd);

  // Printer buffer flush delay
  await new Promise(r => setTimeout(r, 500));

  // Cleanup after 60s
  setTimeout(async () => {
    try { await fsp.unlink(htmlPath); } catch (_) {}
    try { await fsp.unlink(pdfPath);  } catch (_) {}
  }, 60000);
}

// ── Print a single job ──────────────────────────────────────
async function printJob(order, filename, printerName) {
  const num = order.orderNumber || order._id;
  log(`📦 Printing order ${num}...`);

  // Verify printer is ready RIGHT before printing
  if (!printerName || !await checkPrinterReady(printerName)) {
    const detected = await tryDetectPrinter();
    if (!detected) {
      throw new Error('Printer not available — will retry when printer comes back');
    }
    printerName = detected;
  }

  if (PRINT_RECEIPT) {
    log(`  🖨️  Generating receipt...`);
    await htmlToPrint(await buildReceiptHTML(order), `receipt-${num}`, printerName);
    log(`  ✓ Receipt sent to printer`);
  }

  if (PRINT_LABEL) {
    await new Promise(r => setTimeout(r, 3000)); // Let printer breathe
    log(`  🏷️  Generating label...`);
    await htmlToPrint(buildLabelHTML(order), `label-${num}`, printerName);
    log(`  ✓ Label sent to printer`);
  }

  // Move to completed
  await moveToCompleted(filename);
  await markPrinted(order._id);
  processed.add(order._id);
  printedCount++;
  lastPrintTime = new Date().toISOString();
  log(`✅ Order ${num} printed successfully (#${printedCount})`);
}

// ── Process pending queue ───────────────────────────────────
async function processPendingQueue(printerName) {
  const jobs = await loadPendingQueue();
  if (jobs.length === 0) return;
  log(`📋 Processing ${jobs.length} pending job(s)...`);

  for (const job of jobs) {
    try {
      await printJob(job.order, job.filename, printerName);
      await new Promise(r => setTimeout(r, 3000)); // Between jobs
    } catch (err) {
      errorCount++;
      const willRetry = await updateRetry(job.filename, err.message);
      log(`❌ Failed to print ${job.orderNumber}: ${err.message}`, 'error');
    }
  }
}

// ── Poll loop ───────────────────────────────────────────────
let consecutiveFailures = 0;

async function pollLoop(printerName) {
  while (true) {
    try {
      const orders = await pollOrders();
      if (consecutiveFailures > 0) {
        log(`🟢 API reconnected after ${consecutiveFailures} failed attempts!`);
      }
      consecutiveFailures = 0;

      if (orders.length > 0) {
        log(`🔔 Found ${orders.length} new order(s) to print!`);
        for (const order of orders) {
          if (processed.has(order._id)) continue;
          // Save to disk FIRST (never lose a receipt)
          const filename = await saveToQueue(order);
          try {
            await printJob(order, filename, printerName);
          } catch (err) {
            errorCount++;
            await updateRetry(filename, err.message);
            log(`❌ Failed to print ${order.orderNumber}: ${err.message}`, 'error');
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
      try { await processPendingQueue(printerName); } catch (_) {}
    }

    // Adaptive polling: if failing repeatedly, poll less often to avoid hammering
    const delay = consecutiveFailures > 5
      ? Math.min(POLL_MS * 2, 120000)  // Max 2 min between polls when failing
      : POLL_MS;
    await new Promise(r => setTimeout(r, delay));
  }
}

// ── Health Endpoint ─────────────────────────────────────────
function startHealthServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      let pending = 0, completed = 0, failed = 0;
      try { pending = (await fsp.readdir(PENDING_DIR)).filter(f => f.endsWith('.json')).length; } catch (_) {}
      try { completed = (await fsp.readdir(COMPLETED_DIR)).filter(f => f.endsWith('.json')).length; } catch (_) {}
      try { failed = (await fsp.readdir(FAILED_DIR)).filter(f => f.endsWith('.json')).length; } catch (_) {}

      const body = JSON.stringify({
        status: 'ok',
        version: '3.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        printer: currentPrinter || 'none',
        printerReady,
        pendingJobs: pending,
        completedJobs: completed,
        failedJobs: failed,
        printedThisSession: printedCount,
        errorsThisSession: errorCount,
        lastPrint: lastPrintTime,
        lastPoll: lastPollTime,
        hostname: os.hostname(),
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

// ── Main ────────────────────────────────────────────────────
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

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║  ARTÉVA MAISON — Print Station v3.2      ║');
  console.log('  ║  Production-Grade • Fault-Tolerant       ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  log(`Host:     ${os.hostname()}`);
  log(`Node:     ${process.version}`);
  log(`API:      ${API_URL}`);
  log(`Timeout:  180s per request, 3 retries`);
  log(`Printer:  ${PRINTER || '(auto-detect)'}`);
  log(`Poll:     every ${POLL_MS / 1000}s`);
  log(`Retries:  ${MAX_RETRIES} max per job`);

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
    await processPendingQueue(printerName);
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
  await pollLoop(currentPrinter);
}

// ── Graceful shutdown ───────────────────────────────────────
async function shutdown(sig) {
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
  // Don't exit — let systemd handle restart if needed
});
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`, 'error');
});

// ── Start ───────────────────────────────────────────────────
main().catch((err) => {
  log(`Fatal: ${err.message}\n${err.stack}`, 'error');
  process.exit(1);
});
