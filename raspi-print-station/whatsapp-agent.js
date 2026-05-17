#!/usr/bin/env node

/**
 * ARTÉVA MAISON — WhatsApp Agent v2 (Production-Hardened)
 * 
 * Runs on Raspberry Pi alongside print-station.js.
 * Polls the backend's WhatsApp queue and sends messages via Baileys.
 * 
 * v2 Improvements:
 *  - dotenv loaded for .env support
 *  - Reconnection backoff (prevents stack overflow)
 *  - Retry logic for failed sends
 *  - Winston rotating logs
 *  - Health tracking
 *  - Graceful shutdown
 *  - Memory monitoring
 */

// Polyfill for older Node.js versions
const crypto = require('crypto');
global.crypto = crypto.webcrypto || crypto;
globalThis.crypto = crypto.webcrypto || crypto;

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

// ── State ───────────────────────────────────────────────────
const startTime = Date.now();
let sentCount = 0;
let errorCount = 0;
let lastSendTime = null;
let lastPollTime = null;
let isConnected = false;
let isPolling = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60000; // Cap at 1 minute

// ── HTTPS Agent ─────────────────────────────────────────────
const httpsAgent = new https.Agent({
  keepAlive: true,
  timeout: 30000
});

// ── API Request ─────────────────────────────────────────────
async function apiRequest(endpoint, method = 'GET', body = null) {
  const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${API_KEY}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
    agent: httpsAgent
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(url, options);
    return await res.json();
  } catch (e) {
    log(`[API] Error calling ${endpoint}: ${e.message}`, 'error');
    return { success: false };
  }
}

// ── WhatsApp Connection ─────────────────────────────────────
async function startAgent() {
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
        isConnected = false;
        isPolling = false;

        if (shouldReconnect) {
          // Exponential backoff (prevents stack overflow from rapid reconnects)
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
        reconnectAttempts = 0; // Reset backoff on successful connect
        log('✅ WhatsApp successfully connected!');
        startPolling(sock);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    log(`❌ Agent start error: ${err.message}`, 'error');
    reconnectAttempts++;
    const delay = Math.min(5000 * reconnectAttempts, MAX_RECONNECT_DELAY);
    log(`🔄 Retrying in ${delay/1000}s...`);
    setTimeout(() => startAgent(), delay);
  }
}

// ── Polling Loop ────────────────────────────────────────────
async function startPolling(sock) {
  if (isPolling) return;
  isPolling = true;

  log(`🔄 Polling ${BASE_URL} every ${POLL_INTERVAL/1000}s for WhatsApp messages...`);

  const poll = async () => {
    if (!isConnected) return;
    
    try {
      const result = await apiRequest('/api/admin/whatsapp-queue/poll');
      lastPollTime = new Date().toISOString();

      if (result.success && result.messages && result.messages.length > 0) {
        log(`📥 ${result.messages.length} message(s) to send`);

        for (const msg of result.messages) {
          await sendWithRetry(sock, msg);
          // Delay between messages to avoid WhatsApp rate limiting
          await new Promise(r => setTimeout(r, SEND_DELAY_MS));
        }
      }
    } catch (e) {
      log(`Polling error: ${e.message}`, 'error');
    }
  };

  // Initial poll
  await poll();
  // Then interval
  setInterval(poll, POLL_INTERVAL);
}

// ── Send with Retry ─────────────────────────────────────────
async function sendWithRetry(sock, msg) {
  const jid = `${msg.phone.replace('+', '')}@s.whatsapp.net`;

  for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
    try {
      log(`📨 Sending to ${jid} (attempt ${attempt}/${MAX_SEND_RETRIES})...`, 'debug');
      await sock.sendMessage(jid, { text: msg.message });

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

      if (attempt >= MAX_SEND_RETRIES) {
        errorCount++;
        log(`❌ FAILED permanently: message ${msg._id} to ${jid}`, 'error');
        await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
          status: 'failed',
          errorLog: `Failed after ${MAX_SEND_RETRIES} attempts: ${sendErr.message}`
        });
      } else {
        // Wait before retry (exponential)
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
    if (req.url === '/health' && req.method === 'GET') {
      const mem = process.memoryUsage();
      const body = JSON.stringify({
        status: 'ok',
        service: 'whatsapp-agent',
        version: '2.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        connected: isConnected,
        polling: isPolling,
        sentThisSession: sentCount,
        errorsThisSession: errorCount,
        lastSend: lastSendTime,
        lastPoll: lastPollTime,
        reconnectAttempts,
        memory: { heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) },
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
    log(`🏥 WhatsApp health: http://0.0.0.0:${HEALTH_PORT}/health`);
  });
  server.on('error', (e) => {
    log(`⚠ Health server error: ${e.message}`, 'warn');
  });
}

// ── Graceful Shutdown ───────────────────────────────────────
function shutdown(sig) {
  log(`⏹ Received ${sig}, shutting down WhatsApp agent...`);
  const uptime = Math.floor((Date.now() - startTime) / 60000);
  log(`Session: ${sentCount} sent, ${errorCount} errors, uptime ${uptime}m`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT: ${err.message}\n${err.stack}`, 'error');
});
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`, 'error');
});

// ── Start ───────────────────────────────────────────────────
console.log('');
console.log('  ╔══════════════════════════════════════════╗');
console.log('  ║  ARTÉVA MAISON — WhatsApp Agent v2.0     ║');
console.log('  ║  Production-Hardened • Auto-Recovering   ║');
console.log('  ╚══════════════════════════════════════════╝');
console.log('');

log(`API:      ${BASE_URL}`);
log(`Poll:     every ${POLL_INTERVAL/1000}s`);
log(`Retries:  ${MAX_SEND_RETRIES} max per message`);
log(`Delay:    ${SEND_DELAY_MS}ms between sends`);

startHealthServer();
startAgent();
