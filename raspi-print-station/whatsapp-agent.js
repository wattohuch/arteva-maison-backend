#!/usr/bin/env node

/**
 * ARTÉVA MAISON — WhatsApp Agent v6
 *
 * Runs on Raspberry Pi alongside print-station.js.
 * Polls the backend's WhatsApp queue and sends messages via Baileys.
 *
 * ─────────────────────────────────────────────────────────────
 * v6 — "Waiting for this message" incident fixes
 *
 * Symptom: every message this account sent arrived at the recipient as
 * "Waiting for this message. This may take a while." — WhatsApp's way of
 * saying it received a message it could not DECRYPT. Customers and owners
 * both got unreadable messages for days.
 *
 * That is a Signal-protocol session failure on OUR side, not a delivery
 * delay, and it has three classic causes. All three are now closed:
 *
 *  1. TWO PROCESSES SHARING ONE SESSION (the usual culprit).
 *     `auth_info_baileys` holds the ratcheting encryption state. Two
 *     sockets authenticated from the same folder both advance that state
 *     and each invalidates the other's keys, so recipients can no longer
 *     decrypt anything either of them sends. systemd Restart=always, a
 *     manual `node whatsapp-agent.js`, and the watchdog could each add an
 *     instance. FIXED: single-instance PID lock — a second agent refuses
 *     to start rather than corrupting the session.
 *
 *  2. RECONNECT LEAKING THE OLD SOCKET.
 *     On 'close' the old socket was abandoned, never ended, and its event
 *     listeners were left attached while a NEW socket opened on the same
 *     auth state — briefly two live sockets, i.e. cause 1 again. FIXED:
 *     the old socket is ended and its listeners removed before reconnect.
 *
 *  3. SENDING IN THE FIRST MOMENTS AFTER CONNECT.
 *     Sending before the session handshake has settled produces messages
 *     encrypted against keys the recipient cannot resolve. FIXED: a
 *     warm-up window after 'open' during which nothing is sent.
 *
 * Because a broken greeting reaching a CUSTOMER is worse than no greeting
 * at all, the customer-facing auto-greeting is now OPT-IN (WA_AUTO_GREET),
 * default OFF. Turn it on only once you have confirmed a real message
 * arrives readable. See README → "WhatsApp session health".
 * ─────────────────────────────────────────────────────────────
 *
 * v4/v5 fixes retained: API key in header not URL, strict phone validation,
 * optional health auth, HTTP status checks, no "timeout means delivered",
 * uncaughtException exits for systemd, socket cleanup on shutdown, message
 * validation, sequential send guard, reconnect guard, max-attempts cap.
 */

// Polyfill for older Node.js versions (scoped — only if missing)
const crypto = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = crypto.webcrypto || crypto;
}

require('dotenv').config();

const {
  makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers,
  fetchLatestBaileysVersion, makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');
require('winston-daily-rotate-file');
const chatbot = require('./chatbot');

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
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const LOCK_FILE = path.join(__dirname, 'whatsapp-agent.lock');
const LOGGED_OUT_MARKER = path.join(__dirname, 'NEEDS_QR_SCAN');

/* Nothing is sent during this window after the connection opens. Sending
   into an unsettled session is what produces messages the recipient cannot
   decrypt ("Waiting for this message"). */
const WARMUP_MS = parseInt(process.env.WA_WARMUP_MS) || 8000;

/* Customer-facing auto-greeting: OPT-IN.
   A customer receiving an undecryptable message from the brand is worse than
   receiving nothing, so this stays off until someone has verified the session
   actually delivers readable text. */
const AUTO_GREET = process.env.WA_AUTO_GREET === 'true';

/* Forwarding an incoming customer message to the owners is internal, so it
   defaults ON — set to 'false' to silence it. */
const FORWARD_TO_ADMIN = process.env.WA_FORWARD_TO_ADMIN !== 'false';

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

// ── Single-Instance Lock ────────────────────────────────────
/**
 * Refuse to run if another agent already holds the session.
 *
 * This is the guard against the "Waiting for this message" corruption: two
 * processes authenticated from the same auth_info_baileys each advance the
 * encryption ratchet and invalidate the other's keys, after which NOTHING
 * either sends can be decrypted by the recipient. Recovering from that needs
 * a fresh QR pairing, so preventing it matters more than being convenient.
 *
 * A lock left behind by a power cut is detected and reclaimed — the PID in it
 * is checked for liveness rather than trusted.
 */
function acquireInstanceLock() {
  try {
    const existing = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    const pid = parseInt(existing, 10);
    if (pid && pid !== process.pid) {
      let alive = false;
      try {
        process.kill(pid, 0); // signal 0 = liveness probe, does not kill
        alive = true;
      } catch (e) {
        // ESRCH = no such process. EPERM = exists but owned by another user.
        alive = (e.code === 'EPERM');
      }
      if (alive) {
        console.error('');
        console.error('  ╔════════════════════════════════════════════════════════╗');
        console.error('  ║  ✋ ANOTHER WHATSAPP AGENT IS ALREADY RUNNING           ║');
        console.error('  ╚════════════════════════════════════════════════════════╝');
        console.error('');
        console.error(`  Existing process PID: ${pid}`);
        console.error('');
        console.error('  Two agents sharing one WhatsApp session corrupt its');
        console.error('  encryption keys — every message either one sends then');
        console.error('  arrives as "Waiting for this message" and CANNOT be read.');
        console.error('  Refusing to start so that does not happen.');
        console.error('');
        console.error('  If the service is running, use it:');
        console.error('    sudo systemctl status arteva-whatsapp');
        console.error('    journalctl -u arteva-whatsapp -f');
        console.error('');
        console.error('  To hand over to this process instead:');
        console.error('    sudo systemctl stop arteva-whatsapp');
        console.error('');
        return false;
      }
      log(`🧹 Reclaiming stale lock from dead PID ${pid} (previous run did not exit cleanly)`, 'warn');
    }
  } catch (_) {
    // No lock file — first run, or it was cleaned up properly.
  }

  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch (e) {
    log(`⚠ Could not write lock file: ${e.message} — continuing without lock`, 'warn');
    return true; // Don't block printing/WhatsApp over an unwritable lock
  }
}

function releaseInstanceLock() {
  try {
    const owner = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    if (owner === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch (_) {}
}

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
let greetingsSent = 0;
let messagesForwarded = 0;
let lastSendTime = null;
let lastPollTime = null;
let isConnected = false;
let isPolling = false;
let isSending = false;          // Guard: prevent overlapping send batches
let isStarting = false;         // Guard: prevent multiple startAgent() calls
let reconnectAttempts = 0;
let pollIntervalId = null;      // Track interval so we can clear it on disconnect
let activeSock = null;           // Global active socket — never use stale closure refs
let connectedAt = null;          // When the current connection opened (for warm-up)
let healthServer = null;
const MAX_RECONNECT_DELAY = 60000; // Cap at 1 minute

// ── Sent-message store: automatic recovery of undecryptable messages ───
/**
 * THE fix for messages that arrive as "Waiting for this message".
 *
 * When a recipient's phone cannot decrypt something we sent, it does not just
 * give up — it sends us a "retry receipt" asking for the message again.
 * Baileys handles that by calling `getMessage(key)` to fetch the original,
 * forcing a brand-new encryption session, and re-sending. The recipient then
 * receives something it CAN read. It is designed to self-heal.
 *
 * Except Baileys' default is `getMessage: async () => undefined`, and its
 * retry code reads `if (msg)` before re-sending. This agent never supplied a
 * `getMessage`, so every retry request was answered with "nothing" and nothing
 * was ever re-sent — which is why recipients stayed stuck on "Waiting for this
 * message" indefinitely instead of recovering seconds later. Baileys even
 * leaves a note about it in its source: "todo: implement a cache to store the
 * last 256 sent messages".
 *
 * So: keep the recent outgoing messages and hand them back on request.
 * Undecryptable messages now repair themselves with no human involved.
 *
 * Deliberately in memory only. These bodies contain customer names, order
 * numbers and addresses, and writing them to the SD card would spread that
 * further than it needs to go. Retry receipts arrive within seconds, so
 * surviving a restart buys almost nothing.
 */
const SENT_STORE_MAX = parseInt(process.env.WA_SENT_STORE_MAX) || 300;
const sentMessages = new Map(); // message id -> proto.IMessage
let retriesServed = 0;
let retriesUnservable = 0;

function rememberSentMessage(id, message) {
  if (!id || !message) return;
  // Map preserves insertion order, so the first key is the oldest.
  if (sentMessages.size >= SENT_STORE_MAX) {
    const oldest = sentMessages.keys().next().value;
    if (oldest !== undefined) sentMessages.delete(oldest);
  }
  sentMessages.set(id, message);
}

/**
 * Called by Baileys when a recipient asks us to re-send something it could not
 * decrypt. Returning the original lets Baileys re-encrypt against a fresh
 * session; returning undefined leaves the recipient stuck forever.
 */
async function getMessageForRetry(key) {
  const found = key?.id ? sentMessages.get(key.id) : undefined;
  if (found) {
    retriesServed++;
    log(`♻️ Recipient could not decrypt ${key.id} — re-sending automatically (${retriesServed} recovered this session)`, 'warn');
    return found;
  }
  retriesUnservable++;
  log(`⚠️ Recipient asked to re-send ${key?.id} but it is no longer in the ${SENT_STORE_MAX}-message store — that one stays unreadable`, 'warn');
  return undefined;
}

/** Minimal CacheStore for Baileys' retry counter (caps retries per message). */
function makeSimpleCache(maxEntries = 1000) {
  const map = new Map();
  return {
    get(key) { return map.get(key); },
    set(key, value) {
      if (map.size >= maxEntries && !map.has(key)) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(key, value);
    },
    del(key) { map.delete(key); },
    flushAll() { map.clear(); },
  };
}
const msgRetryCounterCache = makeSimpleCache();

/** True once the post-connect warm-up window has elapsed. */
function isWarmedUp() {
  return isConnected && connectedAt !== null && (Date.now() - connectedAt) >= WARMUP_MS;
}

/** A socket we can actually send on: connected, present, and settled. */
function canSend() {
  return isConnected && !!activeSock && isWarmedUp();
}

/**
 * Send text and keep a copy for retry receipts.
 *
 * Every outgoing message goes through here. Anything not remembered cannot be
 * re-sent when the recipient reports it as undecryptable, and would be stuck
 * showing "Waiting for this message" for good.
 */
async function sendTextTracked(jid, text) {
  const sent = await activeSock.sendMessage(jid, { text });
  if (sent?.key?.id && sent.message) {
    rememberSentMessage(sent.key.id, sent.message);
  }
  return sent;
}

// ── HTTPS Agent ─────────────────────────────────────────────
const httpsAgent = new https.Agent({
  keepAlive: true,
  timeout: 30000
});

// ── API Request ─────────────────────────────────────────────
async function apiRequest(endpoint, method = 'GET', body = null) {
  /* Key travels in the X-API-Key header only. It used to be duplicated into
     the query string "for backward compat", which wrote the shared secret
     into every proxy, CDN and access log along the way. The backend reads the
     header first, so the query copy bought nothing. */
  const url = `${BASE_URL}${endpoint}`;
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

// ── Incoming Message Handler ────────────────────────────────
/**
 * Registered ONCE per socket, at socket creation — not inside the
 * 'connection.update' → 'open' branch where it used to live. 'open' can fire
 * more than once on a single socket, and each firing added another listener,
 * so one incoming customer message produced two, three, four greetings.
 */
function attachMessageHandler(sock) {
  sock.ev.on('messages.upsert', async ({ messages: incomingMsgs, type }) => {
    if (type !== 'notify') return; // Only handle real-time messages
    if (!AUTO_GREET && !FORWARD_TO_ADMIN) return; // Nothing to do

    for (const msg of incomingMsgs) {
      try {
        // Skip: own messages, groups, status broadcasts
        if (msg.key.fromMe) continue;
        if (!msg.key.remoteJid) continue;
        if (msg.key.remoteJid.endsWith('@g.us')) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        // Extract text from various message types
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text;
        if (!text) continue; // Skip images, stickers, etc.

        const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '');

        // Skip admin phone numbers — they handle support directly
        if (chatbot.isAdminPhone(phone)) continue;

        log(`📩 Incoming from +${phone}: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

        /* Sending inside the warm-up window is one of the ways messages come
           out undecryptable, so hold off rather than send something the
           customer will see as "Waiting for this message". */
        if (!canSend()) {
          log(`  ⏸️ Session not ready (warming up) — not replying to +${phone}`, 'warn');
          continue;
        }

        /* ── Greet the customer (opt-in, rate-limited) ──
           The cooldown gates ONLY this. Forwarding below runs regardless:
           whether we already said hello has no bearing on whether the shop
           should see what a customer wrote. */
        if (AUTO_GREET) {
          if (chatbot.shouldGreet(phone)) {
            try {
              await sendTextTracked(msg.key.remoteJid, chatbot.getGreeting());
              greetingsSent++;
              log(`  ✅ Auto-greeting sent to +${phone}`);
            } catch (greetErr) {
              log(`  ⚠️ Greeting to +${phone} failed: ${greetErr.message}`, 'warn');
            }
          } else {
            log(`  ⏸️ Already greeted +${phone} recently — no repeat greeting`, 'debug');
          }
        }

        // ── Forward the original message to the owners (every message) ──
        if (FORWARD_TO_ADMIN) {
          const forwardText = `📩 New customer message:\n\n📱 +${phone}\n💬 "${text}"\n\n↩️ Reply to them directly on WhatsApp.`;
          let delivered = 0;
          for (const admin of chatbot.ADMIN_PHONES) {
            if (!canSend()) break;
            try {
              await sendTextTracked(`${admin}@s.whatsapp.net`, forwardText);
              delivered++;
              await new Promise(r => setTimeout(r, 1000)); // Brief delay between admin notifications
            } catch (fwdErr) {
              log(`  ⚠️ Failed to forward to admin ${admin}: ${fwdErr.message}`, 'warn');
            }
          }
          if (delivered > 0) {
            messagesForwarded++;
            log(`  📤 Forwarded to ${delivered}/${chatbot.ADMIN_PHONES.length} admin(s)`);
          }
        }
      } catch (msgErr) {
        log(`⚠️ Error handling incoming message: ${msgErr.message}`, 'warn');
      }
    }
  });
}

// ── Tear down a socket completely ───────────────────────────
/**
 * End a socket AND detach its listeners.
 *
 * Previously a closed socket was simply dropped on the floor: never ended,
 * listeners still attached, while startAgent() opened a replacement against
 * the same auth state. For a moment two sockets shared one encryption
 * session — the exact condition that makes every subsequent message
 * undecryptable. Both halves matter, so both happen here.
 */
async function destroySocket(sock, reason) {
  if (!sock) return;
  try { sock.ev.removeAllListeners('messages.upsert'); } catch (_) {}
  try { sock.ev.removeAllListeners('connection.update'); } catch (_) {}
  try { sock.ev.removeAllListeners('creds.update'); } catch (_) {}
  try {
    await sock.end(new Error(reason || 'replaced'));
  } catch (_) {
    // Already dead — that is the desired end state anyway.
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
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    log(`📱 Using WhatsApp Web v${version.join('.')}`);

    const baileysLogger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        /* Wrapping the key store makes signal key lookups cached and
           consistent; unwrapped, repeated reads of the same prekey during a
           burst of sends are a known source of session trouble. */
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      printQRInTerminal: true,
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      /* Without this, a recipient that cannot decrypt a message stays stuck on
         "Waiting for this message" permanently — see getMessageForRetry. */
      getMessage: getMessageForRetry,
      msgRetryCounterCache,
    });

    // Attached once, here — not on every 'open' (see attachMessageHandler).
    attachMessageHandler(sock);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log('📱 QR CODE DISPLAYED — scan with WhatsApp app');
        // A QR means we are unpaired; any previous "needs scan" state is moot.
        try { fs.unlinkSync(LOGGED_OUT_MARKER); } catch (_) {}
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        log(`❌ Connection closed (code: ${statusCode}), reconnect: ${shouldReconnect}`, 'warn');

        // ── CRITICAL: Clean up before reconnect ──
        isConnected = false;
        connectedAt = null;
        const dying = activeSock;
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

        /* End the outgoing socket before its replacement opens. Skipped
           entirely before v6, which is how two live sockets could briefly
           share — and corrupt — one encryption session. */
        await destroySocket(dying || sock, `connection closed (${statusCode})`);

        if (shouldReconnect) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
          log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
          setTimeout(() => startAgent(), delay);
        } else {
          /* Logged out is not something a restart can fix — the pairing is
             gone and a human has to scan a QR. Exiting immediately here just
             fed systemd's Restart=always into a crash loop every few seconds,
             burying the one line that says what is actually needed. Leave a
             marker, say it plainly, and stay down. */
          log('', 'error');
          log('╔════════════════════════════════════════════════════════╗', 'error');
          log('║  ❌ WHATSAPP LOGGED OUT — QR RE-SCAN REQUIRED           ║', 'error');
          log('╚════════════════════════════════════════════════════════╝', 'error');
          log('This device was unlinked from the WhatsApp account.', 'error');
          log('Restarting cannot fix it. On the Pi, run:', 'error');
          log('    npm run wa:reset', 'error');
          log('…then scan the QR code it prints with the business phone.', 'error');
          try {
            fs.writeFileSync(LOGGED_OUT_MARKER,
              `Logged out at ${new Date().toISOString()}\n` +
              `Run "npm run wa:reset" on the Pi and scan the QR code.\n`);
          } catch (_) {}
          releaseInstanceLock();
          /* Exit 0, not 1: with Restart=on-failure this stays down, and even
             under Restart=always the marker plus this log make the cause
             obvious instead of scrolling past at 5-second intervals. */
          process.exit(0);
        }
      } else if (connection === 'open') {
        isConnected = true;
        activeSock = sock; // Set the global active socket
        connectedAt = Date.now();
        reconnectAttempts = 0;
        isStarting = false; // Done starting
        try { fs.unlinkSync(LOGGED_OUT_MARKER); } catch (_) {}
        log('✅ WhatsApp successfully connected!');
        log(`⏳ Warming up for ${WARMUP_MS / 1000}s before sending (prevents undecryptable messages)...`);

        /* Hold every send until the session has settled. Polling starts after
           the warm-up for the same reason. */
        setTimeout(() => {
          if (!isConnected || activeSock !== sock) return; // Dropped while warming
          log('🟢 Session warmed up — sending enabled');
          if (!AUTO_GREET) {
            log('ℹ️ Customer auto-greeting is OFF (set WA_AUTO_GREET=true to enable)');
          }
          // Re-queue any recently failed transient messages
          requeueTransientFailures();
          startPolling();
        }, WARMUP_MS);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    log(`❌ Agent start error: ${err.message}`, 'error');
    isStarting = false; // Allow retry
    reconnectAttempts++;
    const delay = Math.min(5000 * reconnectAttempts, MAX_RECONNECT_DELAY);
    log(`🔄 Retrying in ${delay / 1000}s...`);
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

  log(`🔄 Polling ${BASE_URL} every ${POLL_INTERVAL / 1000}s for WhatsApp messages...`);

  const poll = async () => {
    // Use global activeSock — NEVER a stale closure reference
    if (!isConnected || !activeSock) {
      log('⏸️ Poll skipped — not connected', 'debug');
      return;
    }

    // Don't pull work we are not yet safe to send.
    if (!isWarmedUp()) {
      log('⏸️ Poll skipped — session still warming up', 'debug');
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
            if (!canSend()) {
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
    if (!canSend()) {
      log(`⚠️ Socket not ready for ${msg._id}, marking for re-queue`, 'warn');
      await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
        status: 'failed',
        errorLog: 'Connection lost before send — will be re-queued on reconnect'
      });
      errorCount++;
      return;
    }

    try {
      log(`📨 Sending to ${jid} (attempt ${attempt}/${MAX_SEND_RETRIES})...`, 'debug');
      await sendTextTracked(jid, msg.message);

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
      // Do NOT assume delivered. Mark as "unknown" for manual review.
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
        log(`⏳ Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}

// ── Health Endpoint ─────────────────────────────────────────
/** Loopback check — the test-send route is never exposed off-box. */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function startHealthServer() {
  healthServer = http.createServer((req, res) => {
    /* ── Test send ──
       Exists so a real message can be verified as READABLE without opening a
       second Baileys socket. A standalone test script would have to
       authenticate from the same auth_info_baileys as the running agent, and
       two sockets on one session is precisely what corrupts the encryption
       state ("Waiting for this message"). Routing the test through the live,
       warmed-up socket is the only safe way to do it.

       Loopback only — otherwise anyone on the LAN could send WhatsApp
       messages as the business. */
    if (req.url?.startsWith('/test-send') && req.method === 'POST') {
      if (!isLoopback(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'test-send is loopback-only' }));
        return;
      }

      let raw = '';
      req.on('data', c => {
        raw += c;
        if (raw.length > 8192) req.destroy(); // Don't buffer unbounded input
      });
      req.on('end', async () => {
        let phone, message;
        try {
          const parsed = JSON.parse(raw || '{}');
          phone = parsed.phone;
          message = parsed.message;
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'invalid JSON body' }));
          return;
        }

        if (!validatePhone(String(phone || ''))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `invalid phone "${phone}" — 7-15 digits` }));
          return;
        }
        if (!canSend()) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'session not ready',
            connected: isConnected,
            warmedUp: isWarmedUp(),
          }));
          return;
        }

        const jid = `${String(phone).replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        try {
          await sendTextTracked(jid, message || 'ARTÉVA test message — if you can read this, WhatsApp is healthy. ✅');
          sentCount++;
          lastSendTime = new Date().toISOString();
          log(`🧪 Test message sent to ${jid}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, jid }));
        } catch (e) {
          log(`🧪 Test message to ${jid} failed: ${e.message}`, 'error');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

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
        version: '6.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        connected: isConnected,
        socketAlive: !!activeSock,
        warmedUp: isWarmedUp(),
        canSend: canSend(),
        needsQrScan: fs.existsSync(LOGGED_OUT_MARKER),
        polling: isPolling,
        sending: isSending,
        sentThisSession: sentCount,
        errorsThisSession: errorCount,
        features: { autoGreet: AUTO_GREET, forwardToAdmin: FORWARD_TO_ADMIN },
        /* How often recipients could not decrypt what we sent.
           `recovered` means the retry was served and they can now read it — the
           self-healing working as intended. A steadily climbing number points
           at a session problem worth investigating; `unrecoverable` means the
           original had already aged out of the store and that message stays
           unreadable. Both zero is the healthy state. */
        decryptRetries: {
          recovered: retriesServed,
          unrecoverable: retriesUnservable,
          storeSize: sentMessages.size,
          storeMax: SENT_STORE_MAX,
        },
        autoGreetings: { sent: greetingsSent, forwarded: messagesForwarded, ...chatbot.getStats() },
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

  healthServer.listen(HEALTH_PORT, '0.0.0.0', () => {
    log(`🏥 WhatsApp health: http://0.0.0.0:${HEALTH_PORT}/health`);
  });
  healthServer.on('error', (e) => {
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

  // Close WhatsApp socket properly — leaving it half-open is what strands
  // the encryption session for the next process that opens it.
  if (activeSock) {
    await destroySocket(activeSock, 'Graceful shutdown');
    log('📱 WhatsApp socket closed');
    activeSock = null;
  }

  // Release the port so a restart doesn't hit EADDRINUSE
  if (healthServer) {
    try { healthServer.close(); } catch (_) {}
  }

  releaseInstanceLock();

  const uptime = Math.floor((Date.now() - startTime) / 60000);
  log(`Session: ${sentCount} sent, ${errorCount} errors, uptime ${uptime}m`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', releaseInstanceLock);
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT: ${err.message}\n${err.stack}`, 'error');
  // Schedule a restart via process exit — systemd will restart us.
  // Continuing in an undefined state is dangerous.
  log('💀 Scheduling process exit in 3s for systemd restart...');
  releaseInstanceLock();
  setTimeout(() => process.exit(1), 3000);
});
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`, 'error');
});

// ── Start ───────────────────────────────────────────────────
console.log('');
console.log('  ╔══════════════════════════════════════════╗');
console.log('  ║  ARTÉVA MAISON — WhatsApp Agent v6.0     ║');
console.log('  ║  Single-Instance • Session-Safe Sending  ║');
console.log('  ╚══════════════════════════════════════════╝');
console.log('');

if (!acquireInstanceLock()) {
  process.exit(1);
}

if (fs.existsSync(LOGGED_OUT_MARKER)) {
  log('⚠ A previous run reported LOGGED OUT. If pairing still fails, run: npm run wa:reset', 'warn');
}

log(`API:      ${BASE_URL}`);
log(`Poll:     every ${POLL_INTERVAL / 1000}s`);
log(`Retries:  ${MAX_SEND_RETRIES} max per message`);
log(`MaxAttempts: ${MAX_MESSAGE_ATTEMPTS} total before permanent fail`);
log(`Delay:    ${SEND_DELAY_MS}ms between sends`);
log(`Warm-up:  ${WARMUP_MS}ms after connect before any send`);
log(`AutoGreet: ${AUTO_GREET ? 'ON' : 'OFF (set WA_AUTO_GREET=true to enable)'}`);
log(`Forward:  ${FORWARD_TO_ADMIN ? 'ON' : 'OFF'}`);

startHealthServer();
startAgent();
