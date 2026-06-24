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

        // We only handle text messages for AI chat
        if (type !== 'text' || !text) return;

        console.log(`[WA-WEBHOOK] Received message from +${from}: "${text}"`);

        // Get owner phones to prevent message loops
        const ownerPhones = await whatsappService.getOwnerPhones();
        const cleanFrom = from.replace(/[^\d]/g, '');

        // If the sender is one of the owner/admin numbers, ignore it
        if (ownerPhones.includes(cleanFrom)) {
            console.log(`[WA-WEBHOOK] Sender +${cleanFrom} is an owner. Skipping AI reply.`);
            return;
        }

        // --- AI CHATBOT LOGIC ---
        const WhatsAppConversation = require('../models/WhatsAppConversation');
        const aiChatService = require('../services/aiChatService');

        // Load conversation
        let conversation = await WhatsAppConversation.findOne({ phone: cleanFrom });
        if (!conversation) {
            conversation = new WhatsAppConversation({ phone: cleanFrom, messages: [] });
        }

        // If human has taken over in the last 2 hours, do not interfere
        const now = new Date();
        if (conversation.isHumanEscalated) {
            // Check if 2 hours have passed since human takeover
            if ((now - conversation.lastMessageAt) < COOLDOWN_MS) {
                console.log(`[WA-WEBHOOK] +${cleanFrom} is handled by human. Skipping AI.`);
                conversation.lastMessageAt = now;
                await conversation.save();
                return;
            } else {
                // Session expired, reset escalation
                conversation.isHumanEscalated = false;
                conversation.messages = [];
            }
        }

        // Process with AI
        console.log(`[WA-WEBHOOK] Processing message with AI for +${cleanFrom}`);
        const aiResponse = await aiChatService.processMessage(cleanFrom, text, conversation.messages);

        if (!aiResponse) {
            console.warn(`[WA-WEBHOOK] AI service did not return a response. Skipping.`);
            return;
        }

        // Send response to customer
        console.log(`[WA-WEBHOOK] Sending AI reply to +${cleanFrom}: ${aiResponse.text}`);
        await whatsappService.sendMessage(cleanFrom, aiResponse.text, 'contact_auto_reply');

        // Save conversation history
        conversation.messages.push({ role: 'user', content: text, timestamp: now });
        conversation.messages.push({ role: 'assistant', content: aiResponse.text, timestamp: new Date() });
        conversation.lastMessageAt = new Date();
        
        // Handle escalation
        if (aiResponse.shouldEscalate) {
            console.log(`[WA-WEBHOOK] AI requested human escalation for +${cleanFrom}.`);
            conversation.isHumanEscalated = true;
            
            // Try to extract an order number to give owners context
            const orderMatch = text.match(/ORD-\w+/i);
            let contextStr = '';
            if (orderMatch) {
                const Order = require('../models/Order');
                const order = await Order.findOne({ orderNumber: orderMatch[0].toUpperCase() }).populate('deliveryPilot');
                if (order && order.deliveryPilot) {
                    contextStr = `\n📦 Related Order: ${order.orderNumber}\n🚚 Driver: ${order.deliveryPilot.name} (${order.deliveryPilot.phone})`;
                }
            }
            
            // Forward to owners
            const forwardMsg = `🚨 *AI Escalation*\n\nCustomer +${cleanFrom} needs human assistance.\n\n💬 Last msg: "${text}"\n🤖 AI replied: "${aiResponse.text}"${contextStr}\n\n↩️ Please reply to them directly.`;
            for (const ownerPhone of ownerPhones) {
                await whatsappService.sendMessage(ownerPhone, forwardMsg, 'status_update');
            }
        }

        await conversation.save();

    } catch (err) {
        console.error('[WA-WEBHOOK] Error processing webhook message:', err.message, err.stack);
    }
});

module.exports = router;
