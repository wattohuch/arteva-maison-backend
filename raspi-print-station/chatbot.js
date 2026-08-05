/**
 * ARTÉVA Maison — WhatsApp Auto-Greeting
 *
 * When a customer messages: send ONE formal greeting in English + Arabic,
 * and forward what they actually wrote to the owners.
 * No bot, no keywords — just a polite acknowledgment.
 *
 * Two behaviours that used to be tangled are now separate:
 *
 *  - GREETING is rate-limited. Nobody wants the same automated reply five
 *    times in an afternoon.
 *  - FORWARDING is not. The cooldown used to suppress both, so a customer
 *    who sent five messages had four of them silently dropped and the owner
 *    never saw them. Whether we already said hello has nothing to do with
 *    whether the shop should see what a customer wrote.
 *
 * The greeting cooldown is persisted to disk. Held only in memory, every
 * restart — and systemd restarts this agent on any crash — re-greeted
 * everyone who had messaged in the previous two hours.
 */

const fs = require('fs');
const path = require('path');

const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours — don't re-greet same person
const MAX_TRACKED = 200;
const ADMIN_PHONES = (process.env.ADMIN_PHONES || '96565611566,96551008567')
    .split(',').map(p => p.trim()).filter(Boolean);

const STATE_FILE = path.join(__dirname, 'greeted-state.json');

// phone → lastGreetTime
const greeted = new Map();

// ── Persistence ─────────────────────────────────────────────
function loadState() {
    try {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        const now = Date.now();
        let restored = 0;
        for (const [phone, ts] of Object.entries(raw)) {
            // Anything already past its cooldown is not worth carrying forward.
            if (typeof ts === 'number' && (now - ts) < COOLDOWN_MS) {
                greeted.set(phone, ts);
                restored++;
            }
        }
        if (restored) console.log(`[CHATBOT] Restored ${restored} active greeting cooldown(s)`);
    } catch (_) {
        // No state file yet, or unreadable — start clean.
    }
}

/* Written on change rather than on an interval: a crash between a greeting
   and the next tick is exactly when the record is needed. */
function saveState() {
    const obj = {};
    for (const [phone, ts] of greeted.entries()) obj[phone] = ts;
    const payload = JSON.stringify(obj);
    const tmp = STATE_FILE + '.tmp';

    /* Write-then-rename, so a power cut mid-write cannot leave a half-written
       file that fails to parse on the next boot. */
    try {
        fs.writeFileSync(tmp, payload);
        fs.renameSync(tmp, STATE_FILE);
        return;
    } catch (e) {
        /* Rename over an existing file can be refused when something else holds
           a handle on it (EPERM/EBUSY — seen on Windows and on synced folders).
           A direct write gives up the torn-file protection, but losing the
           cooldowns entirely means re-greeting every customer after a restart,
           which is the worse outcome. */
        try { fs.unlinkSync(tmp); } catch (_) {}
        try {
            fs.writeFileSync(STATE_FILE, payload);
        } catch (e2) {
            console.warn(`[CHATBOT] Could not persist greeting state: ${e2.message}`);
        }
    }
}

loadState();

function pruneOld() {
    if (greeted.size <= MAX_TRACKED) return;
    const entries = [...greeted.entries()].sort((a, b) => a[1] - b[1]);
    entries.slice(0, 50).forEach(([k]) => greeted.delete(k));
}

const GREETING_TEXT =
    `Thank you for reaching out to   ARTÉVA Maison!  ✨
Our team has received your message and will get back to you shortly.
We appreciate your patience.

You can shop and place your order through the website
🛍️ www.artevamaisonkw.com

شكراً لتواصلك مع أرتيڤا ميزون! ✨
فريقنا استلم رسالتك و سيتم الرد عليك بأقرب وقت .

يمكنك التسوق و الطلب عبر الموقع الالكتروني
🛍️ www.artevamaisonkw.com`;

/**
 * Whether this customer is due a greeting, recording it if so.
 *
 * @returns {boolean} true if a greeting should be sent now
 */
function shouldGreet(phone) {
    const last = greeted.get(phone);
    if (last && (Date.now() - last) < COOLDOWN_MS) return false;

    pruneOld();
    greeted.set(phone, Date.now());
    saveState();
    return true;
}

/** The greeting body (English + Arabic). */
function getGreeting() {
    return GREETING_TEXT;
}

/**
 * Legacy shape, kept so an older agent build still works against this file.
 * Prefer shouldGreet() + getGreeting().
 */
function handleMessage(phone) {
    if (!shouldGreet(phone)) return null;
    return { reply: GREETING_TEXT, forward: true };
}

function isAdminPhone(phone) {
    return ADMIN_PHONES.includes(phone);
}

function getStats() {
    return { activeGreetings: greeted.size, cooldownHours: COOLDOWN_MS / 3600000 };
}

module.exports = {
    shouldGreet,
    getGreeting,
    handleMessage,
    isAdminPhone,
    getStats,
    ADMIN_PHONES,
};
