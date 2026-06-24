const axios = require('axios');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');

class AiChatService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
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
                    maxOutputTokens: 250
                }
            };

            const url = `${this.apiUrl}?key=${this.apiKey}`;
            const response = await axios.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.candidates && response.data.candidates[0]) {
                const text = response.data.candidates[0].content.parts[0].text.trim();
                
                // Handle escalation
                const shouldEscalate = text.includes('[ESCALATE_TO_HUMAN]');
                const cleanText = text.replace('[ESCALATE_TO_HUMAN]', '').trim();

                return {
                    text: cleanText,
                    shouldEscalate
                };
            }

            return null;

        } catch (error) {
            console.error('[AI-CHAT] Gemini API Error:', error.response?.data || error.message);
            return null;
        }
    }
}

module.exports = new AiChatService();
