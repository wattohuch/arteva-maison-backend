const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');
const WhatsAppChatSession = require('../models/WhatsAppChatSession');

const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

// GET /api/whatsapp/webhook — Meta Webhook verification
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'arteva_whatsapp_verify_token_2026';

    if (mode === 'subscribe' && token === verifyToken) {
        console.log('[WA-WEBHOOK] Webhook verified successfully ✅');
        res.status(200).send(challenge);
    } else {
        console.warn('[WA-WEBHOOK] Webhook verification failed ❌');
        res.sendStatus(403);
    }
});

// POST /api/whatsapp/webhook — Handle incoming messages
router.post('/webhook', async (req, res) => {
    const data = req.body;

    // Acknowledge receipt to Meta immediately (prevents duplicate webhook retries)
    res.status(200).json({ received: true });

    // Validate payload structure
    if (data.object !== 'whatsapp_business_account') return;

    try {
        const entry = data.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (!messages || messages.length === 0) return;

        const msg = messages[0];
        const from = msg.from; // Customer wa_id / phone
        const text = msg.text?.body;
        const type = msg.type;

        // We only handle text messages for auto-reply chat features
        if (type !== 'text' || !text) return;

        console.log(`[WA-WEBHOOK] Received message from +${from}: "${text}"`);

        // Get owner phones to prevent message loops
        const ownerPhones = await whatsappService.getOwnerPhones();
        const cleanFrom = from.replace(/[^\d]/g, '');

        // If the sender is one of the owner/admin numbers, ignore it
        if (ownerPhones.includes(cleanFrom)) {
            console.log(`[WA-WEBHOOK] Sender +${cleanFrom} is an owner. Skipping auto-greeting/forwarding to prevent loops.`);
            return;
        }

        // Session lookup to check 2-hour cooldown
        let session = await WhatsAppChatSession.findOne({ phone: cleanFrom });
        const now = new Date();

        if (session && (now - session.lastGreetedAt) < COOLDOWN_MS) {
            console.log(`[WA-WEBHOOK] +${cleanFrom} was greeted recently. Cooldown active. Skipping auto-reply.`);
            return;
        }

        // Send bilingual auto-greeting response to customer
        const greeting = `Thank you for reaching out to ARTÉVA Maison! ✨
Our team has received your message and will get back to you shortly.
We appreciate your patience.

You can shop and place your order through the website 
🛍️ www.ArtevaMaison.com

شكراً لتواصلك مع أرتيڤا ميزون! ✨
فريقنا استلم رسالتك و سيتم الرد عليك بأقرب وقت . 

يمكنك التسوق و الطلب عبر الموقع الالكتروني 
🛍️ www.artevamaisonkw.com`;

        console.log(`[WA-WEBHOOK] Sending greeting reply to +${cleanFrom}`);
        await whatsappService.sendMessage(cleanFrom, greeting, 'contact_auto_reply');

        // Forward message to all owner/admin phones
        const forwardMsg = `📩 New customer message:\n\n📱 +${cleanFrom}\n💬 "${text}"\n\n↩️ Reply to them directly on WhatsApp.`;
        for (const ownerPhone of ownerPhones) {
            console.log(`[WA-WEBHOOK] Forwarding customer message to owner +${ownerPhone}`);
            await whatsappService.sendMessage(ownerPhone, forwardMsg, 'status_update');
        }

        // Upsert chat session to update cooldown timestamp
        await WhatsAppChatSession.findOneAndUpdate(
            { phone: cleanFrom },
            { lastGreetedAt: now },
            { upsert: true, new: true }
        );

        console.log(`[WA-WEBHOOK] Greeted +${cleanFrom} and forwarded successfully.`);

    } catch (err) {
        console.error('[WA-WEBHOOK] Error processing webhook message:', err.message, err.stack);
    }
});

module.exports = router;
