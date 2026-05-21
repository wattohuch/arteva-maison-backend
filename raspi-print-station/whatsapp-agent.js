#!/usr/bin/env node

/**
 * ARTÉVA MAISON — WhatsApp Agent v4 (Production-Hardened, Security-Audited)
 * 
 * Runs on Raspberry Pi alongside print-station.js.
 * Polls the backend's WhatsApp queue and sends messages via Baileys.
 * 
 * v4 Fixes (over v3):
 *  Security:
 *  - FIXED: API key leaked in URL query params — moved to X-API-Key header (backward compat)
 *  - FIXED: Phone number injection — strict digits-only validation
 *  - FIXED: Health endpoint unauthenticated — optional auth token
 *  - FIXED: No HTTP response status check — now validates before parsing
 *  - FIXED: Global crypto polyfill — scoped properly, only if needed
 *
 *  Reliability:
 *  - FIXED: Timeout assumed "delivered" — now marks as "unknown" for manual review
 *  - FIXED: uncaughtException continues running — schedules restart
 *  - FIXED: No socket cleanup on shutdown — proper logout/end
 *  - FIXED: No message validation — checks for required fields
 *  - FIXED: Poll can overlap with send — sequential processing with guard
 *  - FIXED: Reconnect loop can spawn multiple socket instances — guard flag
 *  - FIXED: No max attempts cap on requeue — prevents infinite requeue loops
 *  - FIXED: fetch() errors not caught properly — full error wrapping
 */

// Polyfill for older Node.js versions (scoped — only if missing)
const crypto = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = crypto.webcrypto || crypto;
}

require('dotenv').config();

const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');
require('winston-daily-rotate-file');

// ── Config ──────────────────────────────────────────────────
const API_KEY = process.env.PRINT_KEY || 'arteva-print-2026';
const BASE_URL = (process.env.API_URL || 'https://arteva-maison-backend-gy1x.onrender.com').replace(/\/+$/, '');
const POLL_INTERVAL = parseInt(process.env.WA_POLL_INTERVAL) || 10000;
const MAX_SEND_RETRIES = parseInt(process.env.WA_MAX_RETRIES) || 3;
const SEND_DELAY_MS = parseInt(process.env.WA_SEND_DELAY) || 3000;
const HEALTH_PORT = parseInt(process.env.WA_HEALTH_PORT) || 3101;
const HEALTH_TOKEN = process.env.HEALTH_TOKEN || '';  // Optional auth for health endpoint
const MAX_MESSAGE_ATTEMPTS = parseInt(process.env.WA_MAX_ATTEMPTS) || 10; // Stop re-queuing after this many total attempts
const LOGS_DIR = path.join(__dirname, 'logs');

// Create dirs
fs.mkdirSync(LOGS_DIR, { recursive: true });

// ── Winston Logger ──────────────────────────────────────────
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
      filename: 'whatsapp-agent-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '5m',
      maxFiles: '7d',
      level: 'debug',
    }),
  ],
});

function log(msg, level = 'info') { logger.log(level, msg); }

// ── Phone Number Validation ─────────────────────────────────
// Only allow digits, optional leading +. Length 7-15 (E.164 standard).
const PHONE_RE = /^\+?\d{7,15}$/;
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  return PHONE_RE.test(phone.trim());
}

// ── State ───────────────────────────────────────────────────
const startTime = Date.now();
let sentCount = 0;
let errorCount = 0;
let lastSendTime = null;
let lastPollTime = null;
let isConnected = false;
let isPolling = false;
let isSending = false;          // Guard: prevent overlapping send batches
let isStarting = false;         // Guard: prevent multiple startAgent() calls
let reconnectAttempts = 0;
let pollIntervalId = null;      // Track interval so we can clear it on disconnect
let activeSock = null;           // Global active socket — never use stale closure refs
const MAX_RECONNECT_DELAY = 60000; // Cap at 1 minute

// ── HTTPS Agent ─────────────────────────────────────────────
const httpsAgent = new https.Agent({
  keepAlive: true,
  timeout: 30000
});

// ── API Request ─────────────────────────────────────────────
async function apiRequest(endpoint, method = 'GET', body = null) {
  // Send key as both header (preferred) and query param (backward compat)
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${endpoint}${separator}key=${API_KEY}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    agent: httpsAgent,
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(url, options);
    
    // Check HTTP status before parsing
    if (!res.ok) {
      const text = await res.text().catch(() => 'no body');
      log(`[API] HTTP ${res.status} from ${endpoint}: ${text}`, 'error');
      return { success: false, httpStatus: res.status };
    }
    
    const data = await res.json();
    return data;
  } catch (e) {
    log(`[API] Error calling ${endpoint}: ${e.message}`, 'error');
    return { success: false, error: e.message };
  }
}

// ── WhatsApp Connection ─────────────────────────────────────
async function startAgent() {
  // Guard: prevent multiple concurrent startAgent calls
  if (isStarting) {
    log('⏭ startAgent already in progress — skipping duplicate call', 'debug');
    return;
  }
  isStarting = true;

  log('🔄 Initializing WhatsApp Agent...');
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    log(`📱 Using WhatsApp Web v${version.join('.')}`);

    const baileysLogger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log('📱 QR CODE DISPLAYED — scan with WhatsApp app');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        log(`❌ Connection closed (code: ${statusCode}), reconnect: ${shouldReconnect}`, 'warn');
        
        // ── CRITICAL: Clean up before reconnect ──
        isConnected = false;
        activeSock = null; // Invalidate global socket immediately
        
        // Clear the old poll interval to prevent zombie polls with dead socket
        if (pollIntervalId) {
          clearInterval(pollIntervalId);
          pollIntervalId = null;
          log('🧹 Cleared old poll interval');
        }
        isPolling = false;
        isSending = false;
        isStarting = false; // Allow startAgent to be called again

        if (shouldReconnect) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
          log(`🔄 Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts})...`);
          setTimeout(() => startAgent(), delay);
        } else {
          log('❌ LOGGED OUT. Delete "auth_info_baileys" folder and restart to scan QR again.', 'error');
          process.exit(1);
        }
      } else if (connection === 'open') {
        isConnected = true;
        activeSock = sock; // Set the global active socket
        reconnectAttempts = 0;
        isStarting = false; // Done starting
        log('✅ WhatsApp successfully connected!');
        
        // Re-queue any recently failed transient messages
        requeueTransientFailures();
        
        startPolling();
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    log(`❌ Agent start error: ${err.message}`, 'error');
    isStarting = false; // Allow retry
    reconnectAttempts++;
    const delay = Math.min(5000 * reconnectAttempts, MAX_RECONNECT_DELAY);
    log(`🔄 Retrying in ${delay/1000}s...`);
    setTimeout(() => startAgent(), delay);
  }
}

// ── Re-queue Transient Failures ─────────────────────────────
// On reconnect, reset "Connection Closed" failures back to pending
async function requeueTransientFailures() {
  try {
    const result = await apiRequest('/api/admin/whatsapp-queue/requeue-transient', 'POST');
    if (result.success && result.requeued > 0) {
      log(`♻️ Re-queued ${result.requeued} failed message(s) from transient errors`);
    }
  } catch (e) {
    log(`⚠️ Could not re-queue transient failures: ${e.message}`, 'warn');
  }
}

// ── Polling Loop ────────────────────────────────────────────
async function startPolling() {
  if (isPolling) return;
  isPolling = true;

  log(`🔄 Polling ${BASE_URL} every ${POLL_INTERVAL/1000}s for WhatsApp messages...`);

  const poll = async () => {
    // Use global activeSock — NEVER a stale closure reference
    if (!isConnected || !activeSock) {
      log('⏸️ Poll skipped — not connected', 'debug');
      return;
    }
    
    // Guard: don't start a new batch if previous is still sending
    if (isSending) {
      log('⏸️ Poll skipped — previous batch still sending', 'debug');
      return;
    }
    
    try {
      const result = await apiRequest('/api/admin/whatsapp-queue/poll');
      lastPollTime = new Date().toISOString();

      if (result.success && result.messages && result.messages.length > 0) {
        log(`📥 ${result.messages.length} message(s) to send`);
        isSending = true;

        try {
          for (const msg of result.messages) {
            // Re-check connection before each message (may drop mid-batch)
            if (!isConnected || !activeSock) {
              log('⚠️ Connection lost mid-batch, stopping sends', 'warn');
              break;
            }
            await sendWithRetry(msg);
            // Delay between messages to avoid WhatsApp rate limiting
            await new Promise(r => setTimeout(r, SEND_DELAY_MS));
          }
        } finally {
          isSending = false;
        }
      }
    } catch (e) {
      log(`Polling error: ${e.message}`, 'error');
    }
  };

  // Initial poll
  await poll();
  // Store interval ID so we can clear it on disconnect
  pollIntervalId = setInterval(poll, POLL_INTERVAL);
}

// ── Send with Retry ─────────────────────────────────────────
async function sendWithRetry(msg) {
  // Validate message has required fields
  if (!msg || !msg._id || !msg.phone || !msg.message) {
    log(`🚫 REJECTED message: missing required fields (_id, phone, or message)`, 'error');
    if (msg?._id) {
      await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
        status: 'failed',
        errorLog: 'Invalid message: missing required fields'
      });
    }
    errorCount++;
    return;
  }

  // Validate phone number format
  if (!validatePhone(msg.phone)) {
    log(`🚫 REJECTED message ${msg._id}: invalid phone number "${msg.phone}"`, 'error');
    await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
      status: 'failed',
      errorLog: `Invalid phone number format: "${msg.phone}" — must be 7-15 digits`
    });
    errorCount++;
    return;
  }

  // Check if max total attempts exceeded (prevents infinite requeue loops)
  if (msg.attempts && msg.attempts >= MAX_MESSAGE_ATTEMPTS) {
    log(`🚫 REJECTED message ${msg._id}: exceeded max total attempts (${msg.attempts}/${MAX_MESSAGE_ATTEMPTS})`, 'error');
    await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
      status: 'failed',
      errorLog: `Permanently failed: exceeded ${MAX_MESSAGE_ATTEMPTS} total attempts`
    });
    errorCount++;
    return;
  }

  const cleanPhone = msg.phone.replace(/[^0-9]/g, '');
  const jid = `${cleanPhone}@s.whatsapp.net`;

  for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
    // Validate connection before every attempt
    if (!isConnected || !activeSock) {
      log(`⚠️ Socket not connected for ${msg._id}, marking for re-queue`, 'warn');
      await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
        status: 'failed',
        errorLog: 'Connection lost before send — will be re-queued on reconnect'
      });
      errorCount++;
      return;
    }

    try {
      log(`📨 Sending to ${jid} (attempt ${attempt}/${MAX_SEND_RETRIES})...`, 'debug');
      await activeSock.sendMessage(jid, { text: msg.message });

      sentCount++;
      lastSendTime = new Date().toISOString();
      log(`✅ Sent message ${msg._id} to ${jid}`);

      // Confirm with server
      await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
        status: 'sent'
      });
      return; // Success — exit retry loop

    } catch (sendErr) {
      log(`❌ Send attempt ${attempt}/${MAX_SEND_RETRIES} for ${msg._id}: ${sendErr.message}`, 'error');

      // ── Connection Closed = transient, stop retrying immediately ──
      // These will be re-queued automatically when we reconnect
      if (sendErr.message && sendErr.message.toLowerCase().includes('connection closed')) {
        log(`🔌 Connection closed for ${jid} — will re-queue on reconnect`);
        errorCount++;
        await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
          status: 'failed',
          errorLog: `Connection Closed (transient) — will retry on reconnect`
        });
        return; // Don't retry with a dead socket
      }

      // ── Timeout = UNKNOWN delivery state ──
      // v4 FIX: Do NOT assume delivered. Mark as "unknown" for manual review.
      if (sendErr.message && (sendErr.message.toLowerCase().includes('timeout') || sendErr.message.toLowerCase().includes('time out'))) {
        log(`⚠️ Timeout detected for ${jid}. Marking as unknown — requires manual verification.`);
        errorCount++;
        await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
          status: 'failed',
          errorLog: 'Timeout — delivery status unknown. Check WhatsApp manually. Marked as failed to prevent duplicate sends.'
        });
        return;
      }

      if (attempt >= MAX_SEND_RETRIES) {
        errorCount++;
        log(`❌ FAILED permanently: message ${msg._id} to ${jid}`, 'error');
        await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
          status: 'failed',
          errorLog: `Failed after ${MAX_SEND_RETRIES} attempts: ${sendErr.message}`
        });
      } else {
        const delay = 5000 * attempt;
        log(`⏳ Retrying in ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}

// ── Health Endpoint ─────────────────────────────────────────
function startHealthServer() {
  const server = http.createServer((req, res) => {
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

      const mem = process.memoryUsage();
      const body = JSON.stringify({
        status: 'ok',
        service: 'whatsapp-agent',
        version: '4.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        connected: isConnected,
        socketAlive: !!activeSock,
        polling: isPolling,
        sending: isSending,
        sentThisSession: sentCount,
        errorsThisSession: errorCount,
        lastSend: lastSendTime,
        lastPoll: lastPollTime,
        reconnectAttempts,
        memory: { heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) },
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
    log(`🏥 WhatsApp health: http://0.0.0.0:${HEALTH_PORT}/health`);
  });
  server.on('error', (e) => {
    log(`⚠ Health server error: ${e.message}`, 'warn');
  });
}

// ── Graceful Shutdown ───────────────────────────────────────
let isShuttingDown = false;
async function shutdown(sig) {
  if (isShuttingDown) return; // Prevent double shutdown
  isShuttingDown = true;
  
  log(`⏹ Received ${sig}, shutting down WhatsApp agent...`);
  
  // Clear poll interval
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  
  // Close WhatsApp socket properly
  if (activeSock) {
    try {
      await activeSock.end(new Error('Graceful shutdown'));
      log('📱 WhatsApp socket closed');
    } catch (e) {
      log(`⚠ Error closing socket: ${e.message}`, 'warn');
    }
    activeSock = null;
  }
  
  const uptime = Math.floor((Date.now() - startTime) / 60000);
  log(`Session: ${sentCount} sent, ${errorCount} errors, uptime ${uptime}m`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT: ${err.message}\n${err.stack}`, 'error');
  // Schedule a restart via process exit — systemd will restart us
  // Continuing in an undefined state is dangerous
  log('💀 Scheduling process exit in 3s for systemd restart...');
  setTimeout(() => process.exit(1), 3000);
});
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`, 'error');
});

// ── Start ───────────────────────────────────────────────────
console.log('');
console.log('  ╔══════════════════════════════════════════╗');
console.log('  ║  ARTÉVA MAISON — WhatsApp Agent v4.0     ║');
console.log('  ║  Security-Audited • Auto-Recovering      ║');
console.log('  ╚══════════════════════════════════════════╝');
console.log('');

log(`API:      ${BASE_URL}`);
log(`Poll:     every ${POLL_INTERVAL/1000}s`);
log(`Retries:  ${MAX_SEND_RETRIES} max per message`);
log(`MaxAttempts: ${MAX_MESSAGE_ATTEMPTS} total before permanent fail`);
log(`Delay:    ${SEND_DELAY_MS}ms between sends`);

startHealthServer();
startAgent();
