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
            // Full scheme, from configuration. Without it the model guessed,
            // and guessed http:// for a site that is https.
            const siteUrl = (process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com').replace(/\/$/, '');
            context += `- Website: ${siteUrl}\n`;
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
            context += `1b. This is WhatsApp. Write links as bare URLs — https://example.com — never as markdown [text](url), which WhatsApp shows as literal brackets. Only *bold*, _italic_ and ~strike~ exist here; # headings and ** do nothing.\n`;
            context += `2. If the user speaks Arabic, reply in Arabic. If English, reply in English.\n`;
            context += `3. Use the product catalog above to answer questions about availability and prices.\n`;
            context += `4. Order numbers are 8 characters of letters and digits with no prefix, like QV684GNU. If the user gives you one, an ORDER CONTEXT section below will carry its real status — answer from that. If there is no ORDER CONTEXT section, ask them for the number.\n`;
            context += `5. If the user asks for something outside the catalog, say we don't have it right now.\n`;
            context += `6. NEVER promise to check something later, to get back to them, to pass it to the team, or to update them shortly. You cannot do any of those — this conversation is all you have. Answer from the information above, or escalate.\n`;
            context += `7. If the user asks for a human, a person, an agent, a manager, or says the bot is not helping, reply with exactly [ESCALATE_TO_HUMAN] followed by a short line telling them a colleague will message them here shortly. Do the same whenever you cannot answer from the information above. Escalating is always better than inventing.\n`;

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
    /**
     * Strip the escalation marker, and decide whether a human is needed.
     *
     * The prompt already tells the model to escalate when asked for a person,
     * and the model does not reliably comply — asked "Can u connect me with a
     * human" it carried on describing vases. Whether a customer reaches a
     * person is not a decision worth leaving to a language model, so it is
     * checked here too. A false positive costs an owner one notification; a
     * false negative is someone who asked for help and was ignored.
     *
     * A verb and a noun must both appear before we override the model, so
     * "can someone tell me the price" stays an ordinary question.
     */
    /**
     * Repair formatting WhatsApp cannot render, and force our own links to
     * https.
     *
     * Applied to every reply on the way out. The model is instructed not to
     * produce these, and does anyway.
     */
    _formatForWhatsApp(text) {
        let out = String(text || {});

        // [label](url) -> url, keeping the label when it is not just the URL.
        out = out.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi, (m, label, url) => {
            const bare = label.replace(/^https?:\/\//i, '').replace(/\/$/, '');
            const target = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
            return bare === target || !label.trim() ? url : `${label}: ${url}`;
        });

        // Our own site is https. A model-invented http:// costs the customer a
        // redirect and, on some clients, a warning.
        out = out.replace(/http:\/\/(www\.)?artevamaisonkw\.com/gi, 'https://$1artevamaisonkw.com');

        // Markdown emphasis WhatsApp does not understand.
        out = out.replace(/\*\*([^*]+)\*\*/g, '*$1*');   // **bold** -> *bold*
        out = out.replace(/^#{1,6}\s+/gm, '');            // headings

        return out.trim();
    }
    _finalise(text, userMessage = '') {
        const marker = text.includes('[ESCALATE_TO_HUMAN]');
        const clean = this._formatForWhatsApp(text.split('[ESCALATE_TO_HUMAN]').join(''));

        const msg = String(userMessage || '');
        const asksForHuman =
            /\b(speak|talk|connect|transfer|put me|get me|call)\b/i.test(msg) &&
            /\b(human|person|agent|someone|somebody|representative|staff|manager|owner|real)\b/i.test(msg);
        const arabicAsk = /(موظف|بشر|انسان|إنسان|خدمة العملاء|مسؤول)/.test(msg);

        const shouldEscalate = marker || asksForHuman || arabicAsk;
        if (shouldEscalate && !marker) {
            console.log('[AI-CHAT] Customer asked for a human; escalating even though the model did not');
        }

        return { text: clean, shouldEscalate };
    }

    /**
     * Find any order the customer named, and describe it for the model.
     *
     * Order numbers are eight characters of A-Z0-9 with no prefix — 2OGW0INW,
     * QV684GNU. This matched /ORD-\w+/, a format this shop has never issued, so
     * the lookup could never fire. The model was handed no order data and
     * filled the gap the way a language model does: by promising to "check with
     * our team" and come back, which nobody was ever going to do. The prompt
     * made it worse by offering "ORD-1234" as the example, teaching customers
     * to quote a shape that does not exist.
     *
     * Candidates are resolved against the database rather than trusted from a
     * pattern. An eight-character alphanumeric run is not distinctive enough to
     * assume — DECORATE would match — so the database decides, and an unknown
     * token simply yields nothing.
     */
    async lookupOrderContext(messageText) {
        const text = String(messageText || '');

        // Accept the bare number, a # prefix, and the legacy ORD- form.
        const candidates = new Set();
        const patterns = [
            /\bORD-([A-Za-z0-9]{4,12})\b/gi,
            /#\s*([A-Za-z0-9]{6,12})\b/g,
            /\b([A-Za-z0-9]{8})\b/g,
        ];
        for (const re of patterns) {
            let m;
            while ((m = re.exec(text)) !== null) {
                const token = m[1].toUpperCase();
                // Real numbers are drawn from A-Z0-9; anything else is noise.
                if (/^[A-Z0-9]+$/.test(token)) candidates.add(token);
            }
        }

        if (candidates.size === 0) return '';

        // Cap the lookup: a message full of eight-letter words must not become
        // a dozen queries.
        const lookups = [...candidates].slice(0, 5);

        let order = null;
        try {
            order = await Order.findOne({ orderNumber: { $in: lookups } })
                .populate('deliveryPilot')
                .lean();
        } catch (err) {
            console.error(`[AI-CHAT] Order lookup failed: ${err.message}`);
            return '';
        }

        if (!order) {
            /* Only say so when the customer clearly meant it as an order
             * number. Otherwise an ordinary eight-letter word would have the
             * assistant insisting an order could not be found. */
            const deliberate = /ORD-|#|order|طلب/i.test(text);
            if (!deliberate) return '';
            return '\n\n=== ORDER CONTEXT ===\n'
                + `The customer quoted ${lookups.join(' or ')}, which is NOT an order in our system. `
                + 'Tell them you could not find it and ask them to check the number. '
                + 'Do NOT promise to look into it or to come back to them.\n';
        }

        const lines = [
            '\n\n=== ORDER CONTEXT ===',
            `Order ${order.orderNumber} EXISTS. Use these facts; do not invent others.`,
            `Status: ${order.orderStatus}`,
            `Payment: ${order.paymentStatus}`,
            `Total: ${order.total} ${order.currency || 'KWD'}`,
            `Placed: ${order.createdAt ? new Date(order.createdAt).toDateString() : 'unknown'}`,
        ];

        if (order.deliveryPilot) {
            lines.push(`Driver: ${order.deliveryPilot.name} (${order.deliveryPilot.phone}) — you may share these details.`);
        } else {
            lines.push('No driver assigned yet.');
        }

        lines.push(
            'Tell the customer this status NOW, in this reply. You already have it — '
            + 'do not say you will check, and do not promise to come back to them.'
        );

        return lines.join('\n') + '\n';
    }

    async processMessage(phone, messageText, history) {
        if (!this.apiKey) {
            console.warn('[AI-CHAT] GEMINI_API_KEY is not set. AI Chat disabled.');
            return null;
        }

        try {
            // 1. Look up any order number the customer mentioned
            const orderContext = await this.lookupOrderContext(messageText);

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
                        return this._finalise(trimmed, messageText);
                    }
                }

                return this._finalise(text, messageText);
            }

            return null;

        } catch (error) {
            console.error('[AI-CHAT] Gemini API Error:', error.response?.data || error.message);
            return null;
        }
    }
}

module.exports = new AiChatService();
