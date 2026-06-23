/**
 * WhatsApp Notification Service (Meta Cloud API / Green API Fallback)
 * 
 * Supports:
 * 1. Meta's Official WhatsApp Business Cloud API (Primary/Preferred)
 * 2. Green API / Baileys Print Station Queue (Fallback)
 */

const axios = require('axios');
const SiteSettings = require('../models/SiteSettings');

class WhatsAppService {
    constructor() {
        // --- Official WhatsApp Business API ---
        this.whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
        this.whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
        this.whatsappApiUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com';
        this.whatsappApiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';
        this.isOfficialEnabled = !!(this.whatsappAccessToken && this.whatsappPhoneNumberId);

        // --- Green API (Legacy / Fallback) ---
        this.instanceId = process.env.GREEN_API_INSTANCE_ID || '';
        this.apiToken = process.env.GREEN_API_TOKEN || '';
        
        const envPhones = process.env.WHATSAPP_OWNER_PHONE ? process.env.WHATSAPP_OWNER_PHONE.split(',').map(p => p.trim()) : [];
        this.ownerPhones = envPhones.length > 0 ? envPhones : ['96565611566', '96551008567'];
        
        const apiHost = process.env.GREEN_API_URL || 'https://api.green-api.com';
        this.baseUrl = `${apiHost}/waInstance${this.instanceId}`;
        
        let frontendUrl = process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com';
        if (frontendUrl.includes('onrender.com') || frontendUrl.includes('backend')) {
            frontendUrl = 'https://www.artevamaisonkw.com';
        }
        this.frontendUrl = frontendUrl;

        // ── FIFO Message Queue ──
        this._messageQueue = [];
        this._isProcessingQueue = false;
        this._sendDelayMs = 10000;
        this._maxRetries = 3;
        this._retryDelayMs = 15000;

        // Check connection on startup
        this.isConnected = this.isOfficialEnabled;

        if (this.isOfficialEnabled) {
            console.log('✅ WhatsApp Service (Official Cloud API) initialized');
            console.log(`   Phone Number ID: ${this.whatsappPhoneNumberId}`);
            console.log(`   API Version: ${this.whatsappApiVersion}`);
            console.log(`   Owners: ${this.ownerPhones.join(', ')}`);
        } else {
            console.error('╔══════════════════════════════════════════════════════╗');
            console.error('║  ❌ WHATSAPP NOTIFICATIONS ARE DISABLED!             ║');
            console.error('║                                                      ║');
            console.error('║  Missing env vars:                                   ║');
            console.error('║    → WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID║');
            console.error('╚══════════════════════════════════════════════════════╝');
        }
    }



    /**
     * Format phone number for Green API
     * Green API expects: 96597295917@c.us (country code + number, no +)
     */
    formatPhone(phone) {
        if (!phone) return null;
        let raw = String(phone).trim();
        // Remove all non-digits
        let cleaned = raw.replace(/[^\d]/g, '');
        // Strip international dialing prefix 00
        if (cleaned.startsWith('00')) {
            cleaned = cleaned.substring(2);
        }
        // If starts with 0 (local format), assume Kuwait, replace with 965
        if (cleaned.startsWith('0')) {
            cleaned = '965' + cleaned.substring(1);
        }
        // If number is 8 digits (Kuwait local), add 965
        if (cleaned.length === 8) {
            cleaned = '965' + cleaned;
        }
        // Prevent duplicate country code (e.g. 96596597295917)
        if (cleaned.length > 11 && cleaned.startsWith('965965')) {
            cleaned = cleaned.substring(3);
        }
        if (raw !== cleaned) {
            console.log(`[WA-PHONE] Normalized: "${raw}" → "${cleaned}"`);
        }
        return cleaned;
    }

    /**
     * Normalize phone to international format for storage (+965XXXXXXXX)
     * Can be used by controllers before saving to DB
     */
    static normalizePhoneInternational(phone, defaultCountryCode = '965') {
        if (!phone) return phone;
        let cleaned = String(phone).trim().replace(/[^\d]/g, '');
        // Strip 00 prefix
        if (cleaned.startsWith('00')) {
            cleaned = cleaned.substring(2);
        }
        // If starts with 0 (local), replace with country code
        if (cleaned.startsWith('0')) {
            cleaned = defaultCountryCode + cleaned.substring(1);
        }
        // If 8 digits (Kuwait local), add country code
        if (cleaned.length === 8) {
            cleaned = defaultCountryCode + cleaned;
        }
        // Prevent duplicate country code
        const cc = defaultCountryCode;
        if (cleaned.length > 11 && cleaned.startsWith(cc + cc)) {
            cleaned = cleaned.substring(cc.length);
        }
        return '+' + cleaned;
    }

    /**
     * Send message using the official Meta WhatsApp Business Cloud API
     */
    async sendOfficialMessage(to, message) {
        const cleanPhone = this.formatPhone(to);
        if (!cleanPhone) {
            throw new Error('Invalid phone number format');
        }

        const url = `${this.whatsappApiUrl}/${this.whatsappApiVersion}/${this.whatsappPhoneNumberId}/messages`;
        
        const response = await axios.post(url, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'text',
            text: {
                preview_url: false,
                body: message
            }
        }, {
            headers: {
                'Authorization': `Bearer ${this.whatsappAccessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        return response.data;
    }

    /**
     * Send WhatsApp message (tries Meta official API, falls back to print-station queue)
     */
    async sendMessage(to, message, type = 'test', orderId = null) {
        const phone = this.formatPhone(to);
        if (!phone) {
            console.warn('⚠️ Invalid phone number:', to);
            return { success: false, error: 'Invalid phone' };
        }

        // Smart priority: customer-facing messages first, owner/admin messages later
        const priorityMap = {
            contact_auto_reply: 1,   // Immediate response to customer inquiry
            customer_new_order: 2,   // Customer order confirmation
            status_update: 2,        // Customer status update
            delivery_proof: 2,       // Delivery notification to customer
            welcome: 3,             // Welcome message
            owner_new_order: 5,     // Owner notification (can wait)
            refund_return: 3,       // Refund notifications
            test: 10                // Lowest priority
        };
        const priority = priorityMap[type] || 5;

        // Try Official Meta API
        if (this.isOfficialEnabled) {
            try {
                console.log(`[WA-OFFICIAL] Sending message to ${phone} (type: ${type})`);
                const responseData = await this.sendOfficialMessage(phone, message);
                console.log(`[WA-OFFICIAL] ✅ Message sent successfully. Meta Msg ID: ${responseData.messages?.[0]?.id}`);
                
                // Save to database queue as 'sent' for log tracking
                try {
                    const WhatsAppQueue = require('../models/WhatsAppQueue');
                    const newMsg = new WhatsAppQueue({
                        phone,
                        message,
                        type,
                        order: orderId,
                        priority,
                        status: 'sent',
                        attempts: 1
                    });
                    await newMsg.save();
                } catch (dbErr) {
                    console.error('[WA-OFFICIAL] Failed to save log to DB queue:', dbErr.message);
                }
                
                return { success: true, official: true, messageId: responseData.messages?.[0]?.id };
            } catch (err) {
                const errMsg = err.response?.data?.error?.message || err.message;
                console.error(`[WA-OFFICIAL] ❌ Meta Cloud API failed: ${errMsg}`);
                return { success: false, error: `Official failed: ${errMsg}` };
            }
        }

        console.warn(`[WA-OFFICIAL] ❌ WhatsApp Cloud API is not configured.`);
        return { success: false, error: 'WhatsApp API not configured' };
    }

    /**
     * Fire-and-forget: Send all order notifications (owners + customer) in the background.
     * Use this in payment callbacks so the redirect happens immediately.
     * Messages are sent serially with 10s gaps and retries.
     */
    sendAllOrderNotifications(order, user) {
        // Fire and forget — don't await, don't block the HTTP response
        setImmediate(async () => {
            try {
                console.log(`[WA-NOTIFY] ═══ Starting notifications for ${order.orderNumber} ═══`);
                const ownerResults = await this.notifyOwnerNewOrder(order, user);
                const ownerSuccess = ownerResults.filter(r => r.success).length;
                console.log(`[WA-NOTIFY] Owners: ${ownerSuccess}/${ownerResults.length} delivered`);
                
                const customerResult = await this.notifyCustomerNewOrder(order, user);
                console.log(`[WA-NOTIFY] Customer: ${customerResult.success ? '✅' : '❌ ' + (customerResult.error || 'unknown')}`);
                
                console.log(`[WA-NOTIFY] ═══ Notifications complete for ${order.orderNumber} ═══`);
            } catch (err) {
                console.error(`[WA-NOTIFY] ❌ FATAL error for ${order.orderNumber}:`, err.message, err.stack);
            }
        });
    }

    /**
     * Build tracking URL with secure token
     */
    buildTrackingUrl(order) {
        const token = order.trackingToken || '';
        return `${this.frontendUrl}/track-order.html?order=${order.orderNumber}&token=${token}`;
    }

    /**
     * Build receipt URL
     */
    buildReceiptUrl(order) {
        return `${this.frontendUrl}/receipt.html?order=${order.orderNumber}&token=${order.trackingToken}`;
    }

    // ═══════════════════════════════════════════════════
    // OWNER NOTIFICATIONS (single language based on user pref)
    // ═══════════════════════════════════════════════════

    /**
     * Get dynamic owner phones from DB or fallback to env/defaults
     */
    async getOwnerPhones() {
        try {
            const settings = await SiteSettings.findOne({ key: 'main' });
            if (settings && settings.whatsappOwnerPhones && settings.whatsappOwnerPhones.length > 0) {
                return settings.whatsappOwnerPhones;
            }
        } catch (error) {
            console.error('Error fetching owner phones from settings:', error.message);
        }
        return this.ownerPhones;
    }

    /**
     * Notify owner about new order
     */
    async notifyOwnerNewOrder(order, user) {
        const isArabic = user.language === 'ar';

        const message = `
🔔 *${isArabic ? 'طلب جديد' : 'NEW ORDER RECEIVED'}*

📦 *${isArabic ? 'الطلب' : 'Order'}:* ${order.orderNumber}
👤 *${isArabic ? 'العميل' : 'Customer'}:* ${user.name}
📞 *${isArabic ? 'الهاتف' : 'Phone'}:* ${user.phone || 'N/A'}
📧 *${isArabic ? 'البريد الإلكتروني' : 'Email'}:* ${user.email}

💰 *${isArabic ? 'المجموع' : 'Total'}:* ${order.total} ${order.currency}
💳 *${isArabic ? 'الدفع' : 'Payment'}:* ${order.paymentMethod.toUpperCase()}
📊 *${isArabic ? 'الحالة' : 'Status'}:* ${order.orderStatus.toUpperCase()}

*${isArabic ? `المنتجات (${order.items.length})` : `Items (${order.items.length})`}:*
${order.items.map(item => {
            const productName = (isArabic && item.nameAr) ? item.nameAr : item.name;
            return `• ${productName} x${item.quantity} - ${item.price} ${order.currency}`;
        }).join('\n')}

📍 *${isArabic ? 'عنوان التوصيل' : 'Delivery Address'}:*
${order.shippingAddress.street}
${order.shippingAddress.city}, ${order.shippingAddress.country}
${order.shippingAddress.phone ? `📞 ${order.shippingAddress.phone}` : ''}

${order.notes ? `📝 *${isArabic ? 'ملاحظات' : 'Notes'}:* ${order.notes}` : ''}

🌐 ${isArabic ? 'عرض في الإدارة' : 'View in admin'}: https://www.artevamaisonkw.com/account.html
        `.trim();

        const ownerPhones = await this.getOwnerPhones();
        console.log(`[WA-OWNER] Sending new order notification to ${ownerPhones.length} phone(s): ${ownerPhones.join(', ')}`);
        const results = [];
        for (let i = 0; i < ownerPhones.length; i++) {
            const phone = ownerPhones[i];
            try {
                const result = await this.sendMessage(phone, message, 'owner_new_order', order._id);
                results.push(result);
                console.log(`[WA-OWNER] Phone ${i+1}/${ownerPhones.length} (${phone}): ${result.success ? '✅ Delivered' : '❌ Failed: ' + (result.error || 'unknown')}`);
            } catch (err) {
                console.error(`[WA-OWNER] Phone ${i+1}/${ownerPhones.length} (${phone}): ❌ Exception: ${err.message}`);
                results.push({ success: false, error: err.message });
            }
        }
        console.log(`[WA-OWNER] Notification complete: ${results.filter(r => r.success).length}/${ownerPhones.length} delivered`);
        return results;
    }

    /**
     * Notify owner about order cancellation
     */
    async notifyOwnerOrderCancellation(order, user, reason) {
        const wasPaid = order.paymentStatus === 'paid';
        const isArabic = user.language === 'ar';

        const message = `
❌ *${isArabic ? 'تم إلغاء الطلب' : 'ORDER CANCELLED'}*

📦 *${isArabic ? 'الطلب' : 'Order'}:* ${order.orderNumber}
👤 *${isArabic ? 'العميل' : 'Customer'}:* ${user.name}
📞 *${isArabic ? 'الهاتف' : 'Phone'}:* ${user.phone || 'N/A'}
📧 *${isArabic ? 'البريد الإلكتروني' : 'Email'}:* ${user.email}

💰 *${isArabic ? 'المبلغ' : 'Amount'}:* ${order.total} ${order.currency}
💳 *${isArabic ? 'حالة الدفع' : 'Payment Status'}:* ${order.paymentStatus.toUpperCase()}

${reason ? `📝 *${isArabic ? 'السبب' : 'Reason'}:* ${reason}` : ''}

${wasPaid ? `
⚠️ *${isArabic ? 'مطلوب استرداد' : 'REFUND REQUIRED'}*
${isArabic ? `العميل دفع ${order.total} ${order.currency}` : `Customer paid ${order.total} ${order.currency}`}
${isArabic ? 'تواصل مع العميل لترتيب الاسترداد:' : 'Contact customer to arrange refund:'}
📞 ${user.phone || 'N/A'}
📧 ${user.email}
` : ''}

🌐 ${isArabic ? 'عرض في الإدارة' : 'View in admin'}: ${this.frontendUrl}/admin/orders
        `.trim();

        const ownerPhones = await this.getOwnerPhones();
        const results = [];
        for (let i = 0; i < ownerPhones.length; i++) {
            try {
                const result = await this.sendMessage(ownerPhones[i], message, 'status_update', order._id);
                results.push(result);
            } catch (err) {
                console.error(`[WA-OWNER] Cancel notify to ${ownerPhones[i]} failed: ${err.message}`);
                results.push({ success: false, error: err.message });
            }
        }
        return results;
    }

    /**
     * Notify owner about order status change
     */
    async notifyOwnerOrderStatusChange(order, user, oldStatus, newStatus) {
        const isArabic = false; // Always English for owner

        const statusEmoji = {
            pending: '⏳', confirmed: '✅', packed: '📦',
            processing: '⚙️', handed_over: '🚚',
            out_for_delivery: '🛵', delivered: '✅', cancelled: '❌'
        };

        const statusTranslations = {
            pending: isArabic ? 'في الانتظار' : 'PENDING',
            confirmed: isArabic ? 'مؤكد' : 'CONFIRMED',
            packed: isArabic ? 'معبأ' : 'PACKED',
            processing: isArabic ? 'قيد المعالجة' : 'PROCESSING',
            handed_over: isArabic ? 'تم التسليم للتوصيل' : 'HANDED_OVER',
            out_for_delivery: isArabic ? 'في الطريق للتوصيل' : 'OUT_FOR_DELIVERY',
            delivered: isArabic ? 'تم التوصيل' : 'DELIVERED',
            cancelled: isArabic ? 'ملغي' : 'CANCELLED'
        };

        const message = `
${statusEmoji[newStatus] || '📢'} *${isArabic ? 'تم تحديث حالة الطلب' : 'ORDER STATUS UPDATED'}*

📦 *${isArabic ? 'الطلب' : 'Order'}:* ${order.orderNumber}
👤 *${isArabic ? 'العميل' : 'Customer'}:* ${user.name}

📊 *${isArabic ? 'تغيير الحالة' : 'Status Changed'}:*
${statusTranslations[oldStatus]} → ${statusTranslations[newStatus]}

💰 *${isArabic ? 'المجموع' : 'Total'}:* ${order.total} ${order.currency}

🌐 ${isArabic ? 'عرض في الإدارة' : 'View in admin'}: ${this.frontendUrl}/admin/orders
        `.trim();

        const ownerPhones = await this.getOwnerPhones();
        const results = [];
        for (let i = 0; i < ownerPhones.length; i++) {
            try {
                const result = await this.sendMessage(ownerPhones[i], message, 'status_update', order._id);
                results.push(result);
            } catch (err) {
                console.error(`[WA-OWNER] Status notify to ${ownerPhones[i]} failed: ${err.message}`);
                results.push({ success: false, error: err.message });
            }
        }
        return results;
    }

    /**
     * Notify owner about payment received
     */
    async notifyOwnerPaymentReceived(order, user) {
        const isArabic = false; // Always English for owner

        const message = `
💰 *${isArabic ? 'تم استلام الدفع' : 'PAYMENT RECEIVED'}*

📦 *${isArabic ? 'الطلب' : 'Order'}:* ${order.orderNumber}
👤 *${isArabic ? 'العميل' : 'Customer'}:* ${user.name}

💳 *${isArabic ? 'المبلغ' : 'Amount'}:* ${order.total} ${order.currency}
💳 *${isArabic ? 'طريقة الدفع' : 'Method'}:* ${order.paymentMethod.toUpperCase()}
✅ *${isArabic ? 'الحالة' : 'Status'}:* ${isArabic ? 'مدفوع' : 'PAID'}

🌐 ${isArabic ? 'عرض في الإدارة' : 'View in admin'}: ${this.frontendUrl}/admin/orders
        `.trim();

        const ownerPhones = await this.getOwnerPhones();
        const results = [];
        for (let i = 0; i < ownerPhones.length; i++) {
            try {
                const result = await this.sendMessage(ownerPhones[i], message, 'status_update', order._id);
                results.push(result);
            } catch (err) {
                console.error(`[WA-OWNER] Payment notify to ${ownerPhones[i]} failed: ${err.message}`);
                results.push({ success: false, error: err.message });
            }
        }
        return results;
    }

    // ═══════════════════════════════════════════════════
    // CUSTOMER NOTIFICATIONS (always bilingual EN + AR)
    // ═══════════════════════════════════════════════════

    /**
     * Notify customer about new order confirmation (BILINGUAL)
     */
    async notifyCustomerNewOrder(order, user) {
        const rawPhone = user.phone || order.shippingAddress?.phone;
        console.log(`[WA-CUSTOMER] notifyCustomerNewOrder for ${order.orderNumber}`);
        console.log(`[WA-CUSTOMER]   user.phone: ${user.phone || '(none)'}`);
        console.log(`[WA-CUSTOMER]   shippingAddress.phone: ${order.shippingAddress?.phone || '(none)'}`);
        console.log(`[WA-CUSTOMER]   resolved rawPhone: ${rawPhone || '(none)'}`);

        if (!rawPhone) {
            console.warn(`[WA-CUSTOMER] ❌ No phone number available for customer ${user.name || 'unknown'} on order ${order.orderNumber}. Skipping.`);
            return { success: false, error: 'No customer phone' };
        }

        const phone = rawPhone;
        const formatted = this.formatPhone(phone);
        console.log(`[WA-CUSTOMER] Formatted phone: ${formatted}`);

        const name = user.name || 'Valued Customer';

        const trackUrl = this.buildTrackingUrl(order);
        const receiptUrl = this.buildReceiptUrl(order);

        const message = `✨ *ARTÉVA Maison* ✨

Hello ${name},
Thank you for your order! ✨
Your order *${order.orderNumber}* has been confirmed.

Total: *${order.total} ${order.currency}*
We will notify you when your order ships.

📄 View Receipt: ${receiptUrl}
📍 Track Order: ${trackUrl}

━━━━━━━━━━━━━━━

مرحباً ${name}،
شكراً لطلبك! ✨
تم تأكيد طلبك رقم *${order.orderNumber}*.

المجموع: *${order.total} ${order.currency}*
سنقوم بإبلاغك عند شحن طلبك.

📄 عرض الإيصال: ${receiptUrl}
📍 تتبع الطلب: ${trackUrl}`;

        const result = await this.sendMessage(phone, message, 'customer_new_order', order._id);
        console.log(`[WA-CUSTOMER] Result for ${order.orderNumber}: ${result.success ? '✅ Delivered' : '❌ Failed: ' + (result.error || 'unknown')}`);
        return result;
    }

    /**
     * Notify customer about order status change (BILINGUAL)
     * Sends for ALL meaningful statuses with appropriate links
     */
    async notifyCustomerOrderStatusChange(order, user, newStatus) {
        const rawPhone = user.phone || order.shippingAddress?.phone;
        console.log(`[WA-CUSTOMER] notifyCustomerOrderStatusChange → ${newStatus} for ${order.orderNumber}, phone: ${rawPhone || '(none)'}`);

        if (!rawPhone) {
            console.warn(`[WA-CUSTOMER] ❌ No phone for status change notification on ${order.orderNumber}. Skipping.`);
            return { success: false, error: 'No customer phone' };
        }

        // Skip pending (handled by notifyCustomerNewOrder) and delivered (handled by notifyCustomerDelivery)
        if (newStatus === 'pending' || newStatus === 'delivered') return;

        const phone = rawPhone;
        const name = user.name || 'Valued Customer';
        const trackUrl = this.buildTrackingUrl(order);
        const receiptUrl = this.buildReceiptUrl(order);

        const statusMessages = {
            confirmed: {
                en: '✅ Your order is confirmed and being prepared',
                ar: '✅ تم تأكيد طلبك ويجري تجهيزه',
                emoji: '✅'
            },
            packed: {
                en: '📦 Your order is packed and ready for shipping',
                ar: '📦 تم تغليف طلبك وجاهز للشحن',
                emoji: '📦'
            },
            processing: {
                en: '⚙️ Your order is being processed',
                ar: '⚙️ طلبك قيد المعالجة',
                emoji: '⚙️'
            },
            handed_over: {
                en: '🚚 Your order has been handed over to our delivery team',
                ar: '🚚 تم تسليم طلبك لفريق التوصيل',
                emoji: '🚚'
            },
            out_for_delivery: {
                en: '🛵 Your order is out for delivery now! Our driver is on the way',
                ar: '🛵 طلبك في الطريق إليك الآن! السائق في الطريق',
                emoji: '🛵'
            },
            cancelled: {
                en: '❌ Your order has been cancelled',
                ar: '❌ تم إلغاء طلبك',
                emoji: '❌'
            }
        };

        const status = statusMessages[newStatus];
        if (!status) return;

        // Build tracking/receipt links section
        let linksEn = `📍 Track Order: ${trackUrl}`;
        let linksAr = `📍 تتبع الطلب: ${trackUrl}`;

        // Add receipt link for statuses where payment would be confirmed
        if (['confirmed', 'packed', 'handed_over', 'out_for_delivery'].includes(newStatus)) {
            linksEn += `\n📄 View Receipt: ${receiptUrl}`;
            linksAr += `\n📄 عرض الإيصال: ${receiptUrl}`;
        }

        // Cancelled - no tracking, suggest contact
        if (newStatus === 'cancelled') {
            linksEn = `📞 Contact us: +965 5068 3207`;
            linksAr = `📞 تواصل معنا: 3207 5068 965+`;
        }

        const message = `${status.emoji} *ARTÉVA Maison*

Hello ${name},
Update for your order *${order.orderNumber}* 📦

${status.en}

${linksEn}

━━━━━━━━━━━━━━━

مرحباً ${name}،
تحديث بخصوص طلبك رقم *${order.orderNumber}* 📦

${status.ar}

${linksAr}`;

        const result = await this.sendMessage(phone, message, 'status_update', order._id);
        console.log(`[WA-CUSTOMER] Status change result for ${order.orderNumber}: ${result.success ? '✅' : '❌ ' + (result.error || 'unknown')}`);
        return result;
    }

    /**
     * Notify customer about delivery with proof URL (BILINGUAL)
     */
    async notifyCustomerDelivery(order, user, proofUrl) {
        const rawPhone = user.phone || order.shippingAddress?.phone;
        console.log(`[WA-CUSTOMER] notifyCustomerDelivery for ${order.orderNumber}, phone: ${rawPhone || '(none)'}`);

        if (!rawPhone) {
            console.warn(`[WA-CUSTOMER] ❌ No phone for delivery notification on ${order.orderNumber}. Skipping.`);
            return { success: false, error: 'No customer phone' };
        }

        const phone = rawPhone;
        const name = user.name || 'Valued Customer';
        const backendUrl = process.env.RENDER_EXTERNAL_URL || 'https://arteva-maison-backend-gy1x.onrender.com';
        const fullProofUrl = `${backendUrl}${proofUrl}`;
        const receiptUrl = this.buildReceiptUrl(order);

        const message = `✅ *ARTÉVA Maison*

Hello ${name},
Your order *${order.orderNumber}* has been successfully delivered! 🎉

📸 Delivery proof: ${fullProofUrl}
📄 View Receipt: ${receiptUrl}

Thank you for shopping with ARTÉVA Maison! ✨

━━━━━━━━━━━━━━━

مرحباً ${name}،
تم توصيل طلبك رقم *${order.orderNumber}* بنجاح! 🎉

📸 صورة التوصيل: ${fullProofUrl}
📄 عرض الإيصال: ${receiptUrl}

شكراً لتسوقكم مع ARTÉVA Maison! ✨`;

        const result = await this.sendMessage(phone, message, 'status_update', order._id);
        console.log(`[WA-CUSTOMER] Delivery result for ${order.orderNumber}: ${result.success ? '✅' : '❌ ' + (result.error || 'unknown')}`);
        return result;
    }

    // ═══════════════════════════════════════════════════
    // DRIVER NOTIFICATIONS
    // ═══════════════════════════════════════════════════

    /**
     * Notify driver about a new assigned order (BILINGUAL)
     */
    async notifyDriverOrderAssigned(order, driver) {
        const rawPhone = driver.phone;
        console.log(`[WA-DRIVER] notifyDriverOrderAssigned for ${order.orderNumber}, driver phone: ${rawPhone || '(none)'}`);

        if (!rawPhone) {
            console.warn(`[WA-DRIVER] ❌ No phone for driver ${driver.name}. Skipping notification.`);
            return { success: false, error: 'No driver phone' };
        }

        const phone = rawPhone;
        const driverName = driver.name || 'Driver';
        const customerName = order.user ? order.user.name : 'Customer';
        
        // Use order.shippingAddress.phone or fallback to user.phone
        let customerPhone = order.shippingAddress?.phone;
        if (!customerPhone && order.user?.phone) {
            customerPhone = order.user.phone;
        }
        
        const customerPhoneDisplay = customerPhone ? `wa.me/${this.formatPhone(customerPhone)}` : 'N/A';
        const driverDashboardUrl = `${this.frontendUrl}/driver/deliveries.html`;

        const address = order.shippingAddress ? 
            `${order.shippingAddress.street}, ${order.shippingAddress.city}` : 'N/A';

        const message = `🚚 *ARTÉVA Maison - New Delivery* 🚚

Hello ${driverName},
You have been assigned a new order for delivery!

📦 *Order:* ${order.orderNumber}
👤 *Customer:* ${customerName}
📞 *Contact:* ${customerPhoneDisplay}
📍 *Address:* ${address}
💰 *Total:* ${order.total} ${order.currency}

📱 View details in your dashboard:
${driverDashboardUrl}

━━━━━━━━━━━━━━━

مرحباً ${driverName}،
تم تعيين طلب جديد لك للتوصيل!

📦 *الطلب:* ${order.orderNumber}
👤 *العميل:* ${customerName}
📞 *التواصل:* ${customerPhoneDisplay}
📍 *العنوان:* ${address}
💰 *المجموع:* ${order.total} ${order.currency}

📱 عرض التفاصيل في لوحة التحكم:
${driverDashboardUrl}`;

        // Using priority 2 (same as customer updates)
        const result = await this.sendMessage(phone, message, 'status_update', order._id);
        console.log(`[WA-DRIVER] Result for ${order.orderNumber}: ${result.success ? '✅ Queued' : '❌ ' + (result.error || 'unknown')}`);
        return result;
    }

    // ═══════════════════════════════════════════════════
    // AUTOMATED NOTIFICATIONS
    // ═══════════════════════════════════════════════════

    /**
     * Send welcome message when a customer registers (BILINGUAL based on user language)
     * Triggered immediately after successful registration
     */
    async sendWelcomeMessage(user) {
        const rawPhone = user.phone;
        console.log(`[WA-WELCOME] Sending welcome to ${user.name || 'new user'}, phone: ${rawPhone || '(none)'}`);

        if (!rawPhone) {
            console.warn(`[WA-WELCOME] ❌ No phone number for ${user.name || user.email}. Skipping welcome message.`);
            return { success: false, error: 'No phone number' };
        }

        const isArabic = user.language === 'ar';

        let message;
        if (isArabic) {
            message = `مرحبًا بك في أرتيفا ميزون ✨
يسعدنا انضمامك إلينا.
فريقنا جاهز دائمًا لخدمتك وضمان تجربة تسوق سلسة ومميزة.`;
        } else {
            message = `Welcome to Arteva Maison ✨
We're delighted to have you with us.
Our team is always here to assist you and ensure you have a seamless shopping experience.`;
        }

        const result = await this.sendMessage(rawPhone, message, 'welcome');
        console.log(`[WA-WELCOME] Result for ${user.name || user.email}: ${result.success ? '✅ Queued' : '❌ ' + (result.error || 'unknown')}`);
        return result;
    }

    /**
     * Send refund/return notification when a return or refund is initiated (BILINGUAL)
     * Triggered when order is cancelled or payment status changes to refunded
     */
    async sendRefundReturnNotification(order, user) {
        const rawPhone = user.phone || order.shippingAddress?.phone;
        console.log(`[WA-REFUND] Sending refund/return notification for ${order.orderNumber}, phone: ${rawPhone || '(none)'}`);

        if (!rawPhone) {
            console.warn(`[WA-REFUND] ❌ No phone for refund notification on ${order.orderNumber}. Skipping.`);
            return { success: false, error: 'No customer phone' };
        }

        const name = user.name || 'Valued Customer';
        const isArabic = user.language === 'ar';

        let message;
        if (isArabic) {
            message = `عزيزي/عزيزتي ${name}،

لقد استلمنا طلبك بخصوص الإرجاع/الاسترداد للطلب رقم *${order.orderNumber}*.

فريق الدعم لدينا سيتواصل معك خلال دقائق لمساعدتك.

شكرًا لثقتك بنا 🤍
أرتيفا ميزون`;
        } else {
            message = `Dear ${name},

We have received your return/refund request for order *${order.orderNumber}*.

Our support team will reach out to you within minutes to assist you.

Thank you for your trust 🤍
Arteva Maison`;
        }

        const result = await this.sendMessage(rawPhone, message, 'refund_return', order._id);
        console.log(`[WA-REFUND] Result for ${order.orderNumber}: ${result.success ? '✅ Queued' : '❌ ' + (result.error || 'unknown')}`);
        return result;
    }
    /**
     * Send contact form auto-reply via WhatsApp (BILINGUAL)
     * Sends an acknowledgment to the customer when they submit the contact form
     */
    async sendContactAutoReply(phone, hasShopLink = true) {
        console.log(`[WA-CONTACT] Sending contact auto-reply to ${phone || '(none)'}`);

        if (!phone) {
            console.warn(`[WA-CONTACT] ❌ No phone for contact auto-reply. Skipping.`);
            return { success: false, error: 'No phone number' };
        }

        let message;
        if (hasShopLink) {
            message = `Thank you for reaching out to ARTÉVA Maison! ✨
Our team has received your message and will get back to you shortly.
We appreciate your patience.
You can shop and place your order through the website 
🛍️ www.ArtevaMaisonkw.com

شكراً لتواصلك مع أرتيڤا ميزون! ✨
فريقنا استلم رسالتك وراح يرد عليك بأقرب وقت.
نقدّر صبرك.

يمكنك التسوق و الطلب عبر الموقع الالكتروني 
🛍️ www.artevamaisonkw.com`;
        } else {
            message = `Thank you for reaching out to ARTÉVA Maison! ✨
Our team has received your message and will get back to you shortly.
We appreciate your patience.

شكراً لتواصلك مع أرتيڤا ميزون! ✨
فريقنا استلم رسالتك وراح يرد عليك بأقرب وقت.
نقدّر صبرك.

🛍️ www.artevamaisonkw.com`;
        }

        const result = await this.sendMessage(phone, message, 'contact_auto_reply');
        console.log(`[WA-CONTACT] Result: ${result.success ? '✅ Queued' : '❌ ' + (result.error || 'unknown')}`);
        return result;
    }
}

// Export singleton instance
module.exports = new WhatsAppService();

// Also export the class for static method access
module.exports.WhatsAppService = WhatsAppService;
