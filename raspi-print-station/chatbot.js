/**
 * ARTÉVA Maison — WhatsApp Auto-Greeting
 * 
 * Simple: when a customer messages, send ONE formal greeting
 * in English + Arabic, then forward the message to admin.
 * No bot, no keywords — just a polite acknowledgment.
 */

const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours — don't re-greet same person
const MAX_TRACKED = 200;
const ADMIN_PHONES = (process.env.ADMIN_PHONES || '96565611566,96551008567').split(',').map(p => p.trim());

// phone → lastGreetTime
const greeted = new Map();

function pruneOld() {
    if (greeted.size <= MAX_TRACKED) return;
    const entries = [...greeted.entries()].sort((a, b) => a[1] - b[1]);
    entries.slice(0, 50).forEach(([k]) => greeted.delete(k));
}

/**
 * Handle an incoming customer message.
 * Returns { reply, forward } or null if already greeted recently.
 */
function handleMessage(phone, text) {
    const last = greeted.get(phone);
    if (last && (Date.now() - last) < COOLDOWN_MS) {
        return null; // Already greeted — stay silent, admin will handle
    }

    pruneOld();
    greeted.set(phone, Date.now());

    return {
        reply:
            `Thank you for reaching out to   ARTÉVA Maison!  ✨
Our team has received your message and will get back to you shortly.
We appreciate your patience.

You can shop and place your order through the website 
🛍️ www.ArtevaMaison.com

شكراً لتواصلك مع أرتيڤا ميزون! ✨
فريقنا استلم رسالتك و سيتم الرد عليك بأقرب وقت . 

يمكنك التسوق و الطلب عبر الموقع الالكتروني 
🛍️ www.artevamaisonkw.com`,
        forward: true
    };
}

function isAdminPhone(phone) {
    return ADMIN_PHONES.includes(phone);
}

function getStats() {
    return { activeGreetings: greeted.size, cooldownHours: COOLDOWN_MS / 3600000 };
}

module.exports = { handleMessage, isAdminPhone, getStats, ADMIN_PHONES };
