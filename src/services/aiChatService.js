const axios = require('axios');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');

class AiChatService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        /* The model is configurable and defaults to a CURRENT one.
         *
         * This was pinned to gemini-1.5-flash, which Google has since retired —
         * every reply would have returned 404 with a valid key, so the bot
         * would greet the customer and then say nothing, which reads as being
         * ignored. Naming it in the environment means the next retirement is a
         * config change rather than a code change — which matters, because
         * gemini-2.5-flash was ALSO already closed to new users by the time
         * this was written. Google's own 404 names the successor, so that
         * error message is the place to look when replies stop. */
        this.model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
        this.storeContext = '';
        this.lastContextUpdate = null;
    }

    /**
     * Builds the store context from the database to feed to Gemini
     */
    async buildContext() {
        try {
            // Update context every 30 minutes to save DB queries
            const now = new Date();
            if (this.storeContext && this.lastContextUpdate && (now - this.lastContextUpdate) < 30 * 60 * 1000) {
                return this.storeContext;
            }

            console.log('[AI-CHAT] Building store context for Gemini...');
            
            const products = await Product.find({ isActive: true }).select('name nameAr price compareAtPrice stock category').populate('category', 'name nameAr');
            const categories = await Category.find({ isActive: true }).select('name nameAr');

            let context = `You are a helpful, professional customer support assistant for ARTÉVA Maison, an elegant home decor and lifestyle brand based in Kuwait.\n\n`;
            
            context += `=== STORE POLICIES ===\n`;
            context += `- Website: www.artevamaisonkw.com\n`;
            context += `- Instagram: @arteva.maison\n`;
            context += `- Shipping: We deliver across Kuwait for 2 KWD.\n`;
            context += `- Payment Methods: We accept KNET, Visa, Mastercard, Apple Pay, and Deema (Buy Now Pay Later).\n\n`;

            context += `=== PRODUCT CATALOG ===\n`;
            categories.forEach(cat => {
                context += `\nCategory: ${cat.name} (${cat.nameAr || ''})\n`;
                const catProducts = products.filter(p => p.category && p.category._id.toString() === cat._id.toString());
                catProducts.forEach(p => {
                    const priceStr = p.price.toFixed(3) + ' KWD';
                    const stockStr = p.stock > 0 ? 'In Stock' : 'Out of Stock';
                    context += `- ${p.name} (${p.nameAr || ''}): ${priceStr} [${stockStr}]\n`;
                });
            });

            context += `\n=== INSTRUCTIONS ===\n`;
            context += `1. Be extremely polite, helpful, and concise.\n`;
            context += `2. If the user speaks Arabic, reply in Arabic. If English, reply in English.\n`;
            context += `3. Use the product catalog above to answer questions about availability and prices.\n`;
            context += `4. If the user mentions an order number (e.g. ORD-1234), inform them you can check it.\n`;
            context += `5. If the user asks for something outside the catalog, say we don't have it right now.\n`;
            context += `6. If you cannot help, or the user specifically asks to speak to a human, reply with exactly this phrase: [ESCALATE_TO_HUMAN] and a polite message saying you will connect them with our team.\n`;

            this.storeContext = context;
            this.lastContextUpdate = now;
            return this.storeContext;

        } catch (error) {
            console.error('[AI-CHAT] Error building context:', error);
            return 'You are a helpful customer support assistant for ARTÉVA Maison. Ask the user how you can help them.';
        }
    }

    /**
     * Sends the message to Gemini API and returns the response
     */
    /** Strip the escalation marker and report whether it was present. */
    _finalise(text) {
        const shouldEscalate = text.includes('[ESCALATE_TO_HUMAN]');
        return {
            text: text.split('[ESCALATE_TO_HUMAN]').join('').trim(),
            shouldEscalate,
        };
    }

    async processMessage(phone, messageText, history) {
        if (!this.apiKey) {
            console.warn('[AI-CHAT] GEMINI_API_KEY is not set. AI Chat disabled.');
            return null;
        }

        try {
            // 1. Check if it's an order tracking request
            const orderMatch = messageText.match(/ORD-\w+/i);
            let orderContext = '';
            if (orderMatch) {
                const orderNumber = orderMatch[0].toUpperCase();
                const order = await Order.findOne({ orderNumber }).populate('deliveryPilot');
                if (order) {
                    orderContext = `\n\n=== ORDER CONTEXT ===\nThe user is asking about order ${orderNumber}. Current status: ${order.orderStatus}. Payment status: ${order.paymentStatus}. Total: ${order.total} KWD.\n`;
                    if (order.deliveryPilot) {
                        orderContext += `Driver Assigned: ${order.deliveryPilot.name} (Phone: ${order.deliveryPilot.phone}). You can provide these driver details to the customer if they are asking about delivery.\n`;
                    } else {
                        orderContext += `No driver assigned yet.\n`;
                    }
                } else {
                    orderContext = `\n\n=== ORDER CONTEXT ===\nThe user is asking about order ${orderNumber}, but this order was NOT FOUND in our system.\n`;
                }
            }

            // 2. Build system prompt
            const baseContext = await this.buildContext();
            const systemPrompt = baseContext + orderContext;

            // 3. Format history for Gemini API
            const formattedHistory = history.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));

            // Add the new user message
            formattedHistory.push({
                role: 'user',
                parts: [{ text: messageText }]
            });

            const payload = {
                contents: formattedHistory,
                systemInstruction: {
                    role: 'user',
                    parts: [{ text: systemPrompt }]
                },
                generationConfig: {
                    temperature: 0.3,
                    /* The 2.5 and newer models are "thinking" models: they emit
                     * reasoning tokens, and those count against maxOutputTokens.
                     * At 250 the reasoning consumed nearly the whole budget and
                     * the customer got a sentence that stopped mid-word —
                     * "our highest-priced piece is the". The budget has to cover
                     * the thinking AND the answer. */
                    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 2048),
                    /* Ask for no reasoning at all. Supported from 2.5 onwards;
                     * a model that does not know the field ignores it, and one
                     * that enforces a floor (2.5 Pro) clamps up to its minimum
                     * rather than failing. A WhatsApp reply about stock and
                     * opening hours does not need deliberation, and every token
                     * spent on it is latency the customer waits through. */
                    thinkingConfig: {
                        thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET || 0),
                    },
                }
            };

            const url = `${this.apiUrl}?key=${this.apiKey}`;
            const response = await axios.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const candidate = response.data && response.data.candidates && response.data.candidates[0];
            if (candidate) {
                /* Join every part, minus the reasoning.
                 *
                 * This read parts[0].text, which is wrong twice over. A reply
                 * long enough to be split across parts was silently truncated to
                 * the first one; and on a thinking model part[0] can BE the
                 * reasoning, which is how "Formulate Response Strategy**:" was
                 * sent to a customer as though it were an answer. Parts carrying
                 * `thought: true` are the model working, not talking. */
                const parts = (candidate.content && candidate.content.parts) || [];
                const text = parts
                    .filter(part => part && !part.thought && typeof part.text === 'string')
                    .map(part => part.text)
                    .join('')
                    .trim();

                const finishReason = candidate.finishReason;

                if (!text) {
                    /* Nothing sayable came back. Usually MAX_TOKENS with the
                     * whole budget spent thinking, or SAFETY. Returning null
                     * lets the caller fall back to alerting a human, which is a
                     * better outcome than sending an empty message. */
                    console.warn(`[AI-CHAT] No usable text in response (finishReason: ${finishReason || 'none'}, ${parts.length} parts)`);
                    return null;
                }

                if (finishReason === 'MAX_TOKENS') {
                    /* The answer really was cut off. Trim back to the last
                     * complete sentence so the customer gets something that
                     * reads as finished rather than a dangling clause. */
                    console.warn('[AI-CHAT] Reply hit the token ceiling — trimming to the last complete sentence');
                    const trimmed = text.replace(/[^.!?؟\n]*$/, '').trim();
                    /* Any complete sentence beats a dangling one. An
                     * earlier length floor here meant a short but finished
                     * reply — "We have vases, bowls and lighting." — was
                     * discarded in favour of the fragment it came from. */
                    if (trimmed) {
                        return this._finalise(trimmed);
                    }
                }

                return this._finalise(text);
            }

            return null;

        } catch (error) {
            console.error('[AI-CHAT] Gemini API Error:', error.response?.data || error.message);
            return null;
        }
    }
}

module.exports = new AiChatService();
