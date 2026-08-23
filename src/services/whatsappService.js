/**
 * WhatsApp Notification Service (Meta Cloud API / Green API Fallback)
 * 
 * Supports:
 * 1. Meta's Official WhatsApp Business Cloud API (Primary/Preferred)
 * 2. Green API / Baileys Print Station Queue (Fallback)
 */

const SiteSettings = require('../models/SiteSettings');

class WhatsAppService {
    constructor() {
        // --- Official WhatsApp Business API ---
        this.whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
        this.whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
        /* The endpoint and version live on whatsappCloudClient, which owns the
         * transport. This class kept its own copies with a v18.0 default, which
         * after the transport moved were used for nothing except a startup log
         * line — one that then reported a version the process was not actually
         * calling. Read from the client so the two can never disagree. */
        /* Whether a transport is configured at all — NOT whether Meta
         * specifically is. This gated sending on Meta credentials, so a Twilio
         * deployment (which has no WHATSAPP_ACCESS_TOKEN by design) would have
         * reported itself disabled and skipped every send silently, which is
         * the worst possible failure: no error, no message, no clue.
         *
         * A getter rather than a snapshot so switching WHATSAPP_PROVIDER takes
         * effect without a restart, and so tests can flip provider per case. */
        Object.defineProperty(this, 'isOfficialEnabled', {
            get() {
                const provider = (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase();
                if (provider === 'twilio') {
                    return require('./twilioWhatsAppClient').isConfigured;
                }
                return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
            },
            enumerable: true,
        });

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
        // Mirrors isOfficialEnabled rather than snapshotting it — the admin
        // status endpoint reads this and a stale snapshot would misreport.
        Object.defineProperty(this, 'isConnected', {
            get() { return this.isOfficialEnabled; },
            enumerable: true,
        });

        const activeProvider = (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase();

        if (this.isOfficialEnabled && activeProvider === 'twilio') {
            const twilio = require('./twilioWhatsAppClient');
            console.log('✅ WhatsApp Service (Twilio) initialized');
            console.log(`   Sender: ${twilio.from}`);
            console.log(`   Owners: ${this.ownerPhones.join(', ')}`);
        } else if (this.isOfficialEnabled) {
            console.log('✅ WhatsApp Service (Official Cloud API) initialized');
            console.log(`   Phone Number ID: ${this.whatsappPhoneNumberId}`);
            console.log(`   API Version: ${require('./whatsappCloudClient').apiVersion}`);
            console.log(`   Owners: ${this.ownerPhones.join(', ')}`);
        } else if (activeProvider === 'twilio') {
            console.error('╔══════════════════════════════════════════════════════╗');
            console.error('║  ❌ TWILIO WHATSAPP IS NOT CONFIGURED                ║');
            console.error('╚══════════════════════════════════════════════════════╝');
            require('./twilioWhatsAppClient').missingConfig()
                .forEach(m => console.error(`     → ${m}`));
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
     * Raise a client failure as an exception.
     *
     * The two methods below have always thrown on failure and their callers
     * catch and read `err.response.data.error`. The Cloud client returns a
     * result object instead, so the shape is rebuilt here rather than changing
     * every call site — the error carries the same fields those catch blocks
     * already read, plus `permanent` for anything written since.
     */
    _throwFromClientResult(result) {
        const err = new Error(result.error || 'WhatsApp send failed');
        err.permanent = Boolean(result.permanent);
        err.response = {
            status: result.httpStatus || 500,
            data: { error: { code: result.code ?? null, message: result.error } },
        };
        throw err;
    }

    /**
     * Send a plain text message through the Cloud API.
     *
     * Delegates to whatsappCloudClient, which owns the transport: retries with
     * exponential backoff, and the distinction between a failure worth
     * retrying and one that will never succeed. This method used to call axios
     * directly, which meant a second HTTP client with its own (absent) retry
     * policy — a transient blip from Meta simply lost the message.
     */
    /**
     * The transport that actually puts a message on WhatsApp.
     *
     * Meta's Cloud API and Twilio are both supported and expose the same two
     * methods, so everything above this line is provider-agnostic. Selected by
     * WHATSAPP_PROVIDER; defaults to Meta so an existing deployment keeps the
     * behaviour it already has.
     *
     * Twilio is worth choosing when the Sandbox matters: it sends immediately
     * with no number registration and no Business Manager, which lets customer
     * conversations run while the production number is still being sorted out.
     */
    _transport() {
        const provider = (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase();
        return provider === 'twilio'
            ? require('./twilioWhatsAppClient')
            : require('./whatsappCloudClient');
    }

    async sendOfficialMessage(to, message) {
        const cleanPhone = this.formatPhone(to);
        if (!cleanPhone) {
            throw new Error('Invalid phone number format');
        }

        const client = this._transport();
        const result = await client.sendText(cleanPhone, message);
        if (!result.success) this._throwFromClientResult(result);

        // Callers read `responseData.messages[0].id`; keep Meta's own shape.
        return result.raw || { messages: [{ id: result.messageId }] };
    }

    /**
     * Send an approved template.
     *
     * Free-form text only reaches a customer inside the 24-hour window that
     * opens when *they* message us. Order notifications are the opposite case
     * — we message first, often days later — so Meta requires a template that
     * has been approved in advance. Without one the send is accepted by our
     * code and rejected by Meta, which is silent unless someone reads the log.
     *
     * Template names and their language are configured per notification type
     * (see `templateFor`). `params` fill the {{1}}, {{2}} … placeholders in
     * the approved body, in order.
     */
    async sendOfficialTemplate(to, templateName, languageCode, params = []) {
        const cleanPhone = this.formatPhone(to);
        if (!cleanPhone) throw new Error('Invalid phone number format');

        const client = this._transport();
        const result = await client.sendTemplate(cleanPhone, templateName, languageCode || 'en', params);
        if (!result.success) this._throwFromClientResult(result);

        return result.raw || { messages: [{ id: result.messageId }] };
    }

    /**
     * The approved template configured for a notification type, if any.
     *
     * Read from the environment rather than hardcoded: the names are decided
     * by whoever submits them for approval in Business Manager, and approval
     * happens long after this code ships. Nothing configured means the service
     * keeps sending free-form text exactly as it does today, so adding this
     * changes no behaviour until a template is actually named.
     */
    templateFor(type, lang) {
        const key = `WHATSAPP_TEMPLATE_${String(type).toUpperCase()}`;
        const name = process.env[key];
        if (!name) return null;
        return {
            name,
            /* A per-type _LANG is an explicit operator override and wins — it
             * is how you pin a type to one language when only that one is
             * approved. Otherwise the recipient's own language decides, and
             * the global default is the fallback for callers that have no
             * language to offer. */
            language: process.env[`${key}_LANG`]
                || lang
                || process.env.WHATSAPP_TEMPLATE_LANG
                || 'en',
        };
    }

    /**
     * Send WhatsApp message (tries Meta official API, falls back to print-station queue)
     */
    async sendMessage(to, message, type = 'test', orderId = null, templateParams = null, lang = null) {
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
                /* Prefer an approved template when one is configured for this
                 * type and the caller supplied its parameters. That is the only
                 * form Meta will deliver outside the 24-hour service window,
                 * which is where every order notification falls. With nothing
                 * configured this is exactly the free-form send it always was. */
                const template = templateParams ? this.templateFor(type, lang) : null;

                let responseData;
                if (template) {
                    console.log(`[WA-OFFICIAL] Sending template "${template.name}" to ${phone} (type: ${type})`);
                    responseData = await this.sendOfficialTemplate(
                        phone, template.name, template.language, templateParams
                    );
                } else {
                    console.log(`[WA-OFFICIAL] Sending message to ${phone} (type: ${type})`);
                    responseData = await this.sendOfficialMessage(phone, message);
                }
                const wamid = responseData.messages?.[0]?.id;
                console.log(`[WA-OFFICIAL] ✅ Message sent successfully. Meta Msg ID: ${wamid}`);

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

                /* The lifecycle record, which is a different thing from the
                 * queue row above. The queue is a send log written once; this
                 * is the row Meta's delivery and read receipts will later
                 * update by wamid. Without it every status webhook arrives
                 * about a message we have no record of. */
                await this._recordOutbound({
                    messageId: wamid,
                    to: phone,
                    body: message,
                    type: template ? 'template' : 'text',
                    templateName: template ? template.name : null,
                    context: type,
                    orderId,
                });

                return { success: true, official: true, messageId: wamid };
            } catch (err) {
                const errMsg = err.response?.data?.error?.message || err.message;
                const errCode = err.response?.data?.error?.code ?? null;
                console.error(`[WA-OFFICIAL] ❌ Meta Cloud API failed: ${errMsg}`);

                // Record the failure too. A message that never left is exactly
                // the thing someone will come looking for later, and "no row
                // at all" is indistinguishable from "never attempted".
                await this._recordOutbound({
                    messageId: null,
                    to: phone,
                    body: message,
                    type: 'text',
                    context: type,
                    orderId,
                    status: 'failed',
                    errorCode: errCode,
                    errorMessage: errMsg,
                });

                const queued = await this._enqueueForPiAgent({
                    phone, message, type, orderId, priority,
                    reason: `Official API failed: ${errMsg}`,
                });
                if (queued) return { success: true, queued: true, via: 'pi-agent' };

                return { success: false, error: `Official failed: ${errMsg}` };
            }
        }

        console.warn(`[WA-OFFICIAL] ❌ WhatsApp Cloud API is not configured.`);

        const queued = await this._enqueueForPiAgent({
            phone, message, type, orderId, priority,
            reason: 'Cloud API not configured',
        });
        if (queued) return { success: true, queued: true, via: 'pi-agent' };

        return { success: false, error: 'WhatsApp API not configured' };
    }

    /**
     * Persist an outbound message so its delivery lifecycle can be tracked.
     *
     * Deliberately swallows its own errors: a bookkeeping failure must never
     * turn a delivered WhatsApp message into a failed send from the caller's
     * point of view. Nothing downstream depends on this row existing.
     */
    async _recordOutbound({ messageId, to, body, type, templateName, context, orderId, status, errorCode, errorMessage }) {
        try {
            const WhatsAppMessage = require('../models/WhatsAppMessage');
            await WhatsAppMessage.create({
                messageId: messageId || undefined,
                direction: 'outbound',
                type: type || 'text',
                from: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
                to,
                body: typeof body === 'string' ? body.slice(0, 4096) : undefined,
                templateName: templateName || undefined,
                context,
                order: orderId || undefined,
                status: status || 'sent',
                sentAt: status === 'failed' ? undefined : new Date(),
                failedAt: status === 'failed' ? new Date() : undefined,
                errorCode: errorCode ?? undefined,
                errorMessage: errorMessage || undefined,
            });

            if (to && status !== 'failed') {
                const WhatsAppContact = require('../models/WhatsAppContact');
                await WhatsAppContact.updateOne(
                    { waId: to },
                    { $set: { lastOutboundAt: new Date() }, $setOnInsert: { waId: to, phone: `+${to}` } },
                    { upsert: true }
                );
            }
        } catch (err) {
            console.error(`[WA-OFFICIAL] Could not record outbound message: ${err.message}`);
        }
    }

    /**
     * Hand a message to the Raspberry Pi agent's queue.
     *
     * ── Why this is opt-in ──
     * This class has always advertised a "Green API / Baileys Print Station
     * Queue (Fallback)", but no such fallback existed: the only WhatsAppQueue
     * document ever written was a `status: 'sent'` audit row AFTER the Cloud
     * API had already delivered. Nothing wrote `pending`, and `pending` is
     * exactly what the Pi polls for — so the Pi agent could never deliver
     * anything, and whenever the Cloud API was unconfigured or failing, order
     * confirmations were dropped silently. This restores the missing path.
     *
     * It defaults to OFF because the Pi channel is only as trustworthy as its
     * WhatsApp session. A Baileys session with corrupted encryption keys still
     * "sends" successfully while every recipient sees "Waiting for this
     * message" — so silently rerouting customer order confirmations onto a
     * broken Pi is worse than not sending them. Enable it only once
     * `npm run wa:test` on the Pi shows a readable message arriving:
     *
     *     WHATSAPP_PI_FALLBACK=true
     *
     * Note on duplicates: Meta returns a message id on acceptance, so a thrown
     * error means it did not accept the message and re-sending is correct. A
     * request that times out is the one ambiguous case and could produce two
     * messages; that is preferred over a customer never being told their order
     * was confirmed.
     */
    async _enqueueForPiAgent({ phone, message, type, orderId, priority, reason }) {
        if (process.env.WHATSAPP_PI_FALLBACK !== 'true') {
            console.warn(`[WA-FALLBACK] Pi queue disabled — message to ${phone} NOT sent (${reason}). ` +
                `Set WHATSAPP_PI_FALLBACK=true once the Pi's WhatsApp session is verified.`);
            return false;
        }

        try {
            const WhatsAppQueue = require('../models/WhatsAppQueue');
            await WhatsAppQueue.create({
                phone,
                message,
                type,
                order: orderId,
                priority,
                status: 'pending',
                attempts: 0,
                errorLog: `Queued for Pi agent — ${reason}`,
            });
            console.log(`[WA-FALLBACK] 📥 Queued for Pi agent: ${phone} (type: ${type}, priority: ${priority})`);
            return true;
        } catch (dbErr) {
            console.error(`[WA-FALLBACK] ❌ Could not queue message for Pi agent: ${dbErr.message}`);
            return false;
        }
    }

    /**
     * Fire-and-forget: Send all order notifications (owners + customer) in the background.
     * Use this in payment callbacks so the redirect happens immediately.
     * Messages are sent serially with 10s gaps and retries.
     */
    sendAllOrderNotifications(order, user) {
        // Fire and forget — don't await, don't block the HTTP response
        setImmediate(async () => {
            console.log(`[WA-NOTIFY] ═══ Starting notifications for ${order.orderNumber} ═══`);

            /* The customer goes first, and each recipient is settled on its own.
             *
             * These used to run as two awaits in one try block, owner first. A
             * rejection from the owner send — an unregistered owner number, a
             * 4xx from Meta, anything — jumped straight to the catch and the
             * customer, the one person who is actually waiting to hear that
             * their order went through, was never messaged at all. Nothing
             * either recipient does can now suppress the other. */
            const customerResult = await this.notifyCustomerNewOrder(order, user)
                .catch(err => ({ success: false, error: err.message }));
            console.log(`[WA-NOTIFY] Customer: ${customerResult?.success ? '✅' : '❌ ' + (customerResult?.error || 'unknown')}`);

            const ownerResults = await this.notifyOwnerNewOrder(order, user)
                .catch(err => {
                    console.error(`[WA-NOTIFY] Owner notification threw:`, err.message);
                    return [];
                });
            const ownerSuccess = (ownerResults || []).filter(r => r.success).length;
            console.log(`[WA-NOTIFY] Owners: ${ownerSuccess}/${(ownerResults || []).length} delivered`);

            console.log(`[WA-NOTIFY] ═══ Notifications complete for ${order.orderNumber} ═══`);
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

        /* Owner alerts are permanently outside the 24-hour window — the owner is
         * never the one who messaged us — so on the Cloud API they need an
         * approved template or they will not deliver at all.
         * Suggested body: "New order {{1}} from {{2}}. Total {{3}}. Items: {{4}}."
         * Configure with WHATSAPP_TEMPLATE_OWNER_NEW_ORDER. */
        const templateParams = [
            order.orderNumber,
            user.name || 'Customer',
            `${order.total} ${order.currency}`,
            String(order.items?.length ?? 0),
        ];

        const results = [];
        for (let i = 0; i < ownerPhones.length; i++) {
            const phone = ownerPhones[i];
            try {
                const result = await this.sendMessage(phone, message, 'owner_new_order', order._id, templateParams, isArabic ? 'ar' : 'en');
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

        /* Parameters for the approved template, in the order its {{1}}…{{4}}
         * placeholders expect. Used only when WHATSAPP_TEMPLATE_CUSTOMER_NEW_ORDER
         * names one; otherwise the composed text above is sent as before.
         * Submit the template with a body along the lines of:
         *   "Hello {{1}}, your ARTÉVA order {{2}} is confirmed. Total {{3}}.
         *    Track it here: {{4}}"  */
        const templateParams = [
            name,
            order.orderNumber,
            `${order.total} ${order.currency}`,
            trackUrl,
        ];

        const result = await this.sendMessage(
            phone, message, 'customer_new_order', order._id, templateParams,
            user.language === 'ar' ? 'ar' : 'en'
        );
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

        /* A status update is the clearest case of a message Meta will not accept
         * as free-form text: it is sent days after the order, long outside the
         * 24-hour window that only a customer's own message can open. Without a
         * template these are accepted by our code and refused by Meta.
         *
         * Suggested approved body:
         *   "Hello {{1}}, your ARTÉVA order {{2}} is now {{3}}. Track it: {{4}}"
         * Configure with WHATSAPP_TEMPLATE_STATUS_UPDATE. */
        const templateParams = [
            name,
            order.orderNumber,
            newStatus.replace(/_/g, ' '),
            trackUrl,
        ];

        const result = await this.sendMessage(
            phone, message, 'status_update', order._id, templateParams,
            user.language === 'ar' ? 'ar' : 'en'
        );
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
        /* Proof is optional. A driver marking delivery uploads a photograph;
         * an admin closing the order from the dashboard has none. This used to
         * concatenate unconditionally and send the customer a link ending in
         * "undefined". */
        const backendUrl = process.env.RENDER_EXTERNAL_URL || 'https://arteva-maison-backend-gy1x.onrender.com';
        const fullProofUrl = proofUrl ? `${backendUrl}${proofUrl}` : null;
        const receiptUrl = this.buildReceiptUrl(order);

        const message = `✅ *ARTÉVA Maison*

Hello ${name},
Your order *${order.orderNumber}* has been successfully delivered! 🎉

${fullProofUrl ? `📸 Delivery proof: ${fullProofUrl}\n` : ''}📄 View Receipt: ${receiptUrl}

Thank you for shopping with ARTÉVA Maison! ✨

━━━━━━━━━━━━━━━

مرحباً ${name}،
تم توصيل طلبك رقم *${order.orderNumber}* بنجاح! 🎉

${fullProofUrl ? `📸 صورة التوصيل: ${fullProofUrl}\n` : ''}📄 عرض الإيصال: ${receiptUrl}

شكراً لتسوقكم مع ARTÉVA Maison! ✨`;

        /* Suggested approved body:
         *   "Hello {{1}}, your ARTÉVA order {{2}} has been delivered. Proof: {{3}}"
         * Configure with WHATSAPP_TEMPLATE_DELIVERY_PROOF. Note the type below is
         * `delivery_proof`, not `status_update`: it was sharing the status-update
         * type, so the two could never be given different templates even though
         * their wording and parameters differ. */
        const templateParams = [name, order.orderNumber, fullProofUrl || this.buildTrackingUrl(order)];

        const result = await this.sendMessage(
            phone, message, 'delivery_proof', order._id, templateParams,
            user.language === 'ar' ? 'ar' : 'en'
        );
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

        /* Suggested approved body: "Welcome to ARTÉVA Maison, {{1}}."
         * Configure with WHATSAPP_TEMPLATE_WELCOME. Registering is not a message
         * to us, so this too falls outside the 24-hour window. */
        const result = await this.sendMessage(
            rawPhone, message, 'welcome', null, [user.name || 'there'],
            isArabic ? 'ar' : 'en'
        );
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

        /* Suggested approved body:
         *   "Hello {{1}}, we received your return request for order {{2}}."
         * Configure with WHATSAPP_TEMPLATE_REFUND_RETURN. */
        const result = await this.sendMessage(
            rawPhone, message, 'refund_return', order._id, [name, order.orderNumber],
            isArabic ? 'ar' : 'en'
        );
        console.log(`[WA-REFUND] Result for ${order.orderNumber}: ${result.success ? '✅ Queued' : '❌ ' + (result.error || 'unknown')}`);
        return result;
    }
    /**
     * A customer messaged the business number on WhatsApp.
     *
     * This is the Cloud API counterpart of the auto-greeting that runs on the
     * Raspberry Pi. It has to live here as well, because a phone number can be
     * registered to the Cloud API *or* to WhatsApp Business/Baileys, never both:
     * the moment the business number is moved to the Cloud API the Pi's agent
     * can no longer connect to it, and the greeting would silently disappear.
     *
     * Two things happen, and they are deliberately independent — a failure to
     * reach the owners must not cost the customer their acknowledgement:
     *   1. the customer gets one greeting, at most once per COOLDOWN window;
     *   2. the message is forwarded to the owners so a human can reply.
     *
     * @param {string} from    sender's phone, digits only, as Meta sends it
     * @param {string} text    message body ('' for media-only messages)
     */
    /**
     * An owner replying to an escalation, relayed to the customer.
     *
     * Escalation used to end at "a customer needs you, here is their number" —
     * leaving the owner to find that chat and start it themselves. In practice
     * that means the customer waits while someone copies a number between
     * apps, and the reply arrives from a different conversation than the one
     * they were already in.
     *
     * Now the owner just replies to the alert. WhatsApp puts the alert's wamid
     * in the reply's context, and that identifies the customer exactly — which
     * matters when two people need help at once, where "the most recent
     * escalation" would send one customer the other's answer.
     *
     * @param {string} ownerPhone who replied
     * @param {string} text       what they wrote
     * @param {string} replyToId  wamid of the message they replied to
     * @returns {Promise<boolean>} true when the reply was relayed
     */
    async relayOwnerReply(ownerPhone, text, replyToId) {
        const body = String(text || '').trim();
        if (!body) return false;

        const WhatsAppMessage = require('../models/WhatsAppMessage');
        let customer = null;

        // 1. Preferred: they used WhatsApp's reply, so the target is unambiguous.
        if (replyToId) {
            try {
                const alert = await WhatsAppMessage.findOne({ messageId: replyToId }).lean();
                if (alert && alert.relayTo) customer = alert.relayTo;
            } catch (err) {
                console.error(`[WA-RELAY] Could not resolve reply context: ${err.message}`);
            }
        }

        /* 2. Fallback: an explicit number at the start, "96599887766 on its way".
         * Kept because replying-to only exists if the owner uses that gesture,
         * and on desktop WhatsApp people frequently do not. */
        let stripped = body;
        if (!customer) {
            const explicit = body.match(/^\+?(\d{8,15})\s*[:\-,]?\s+([\s\S]+)$/);
            if (explicit) {
                const candidate = this.formatPhone(explicit[1]);
                // Only treat it as an address if we have actually spoken to them.
                /* relayTo counts as having spoken to them: a customer who
                 * escalated but has not yet been replied to appears only as the
                 * target of an alert, and refusing that is refusing the exact
                 * case this fallback exists for. */
                const known = await WhatsAppMessage.exists({
                    $or: [{ from: candidate }, { to: candidate }, { relayTo: candidate }],
                }).catch(() => null);
                if (known) {
                    customer = candidate;
                    stripped = explicit[2].trim();
                }
            }
        }

        if (!customer) return false;

        const result = await this.sendMessage(customer, stripped, 'owner_relay', null, [stripped]);

        if (result.success) {
            console.log(`[WA-RELAY] ${ownerPhone} -> ${customer}: "${stripped.slice(0, 60)}"`);
            /* Tell the owner it landed. Without this they cannot tell a relayed
             * reply from one that vanished, and the natural response to silence
             * is to send it again. */
            await this.sendMessage(
                ownerPhone,
                `✅ Sent to +${customer}.`,
                'relay_receipt',
                null,
                [`+${customer}`]
            ).catch(() => { /* the relay itself already succeeded */ });
        } else {
            console.error(`[WA-RELAY] Failed to reach ${customer}: ${result.error}`);
            await this.sendMessage(
                ownerPhone,
                `❌ Could not deliver that to +${customer}. ${result.error || ''}`.trim(),
                'relay_receipt',
                null,
                [`+${customer}`]
            ).catch(() => {});
        }

        return true;
    }

    /** Record which customer an escalation alert concerns. */
    async _tagRelayTarget(messageId, customerWaId) {
        try {
            const WhatsAppMessage = require('../models/WhatsAppMessage');
            await WhatsAppMessage.updateOne({ messageId }, { $set: { relayTo: customerWaId } });
        } catch (err) {
            // The alert still reached the owner; only the reply shortcut is lost.
            console.error(`[WA-RELAY] Could not tag ${messageId}: ${err.message}`);
        }
    }

    async handleInboundMessage(from, text, opts = {}) {
        if (!from) return { success: false, error: 'No sender' };

        const phone = this.formatPhone(from);
        const owners = await this.getOwnerPhones();

        if (owners.map(p => this.formatPhone(p)).includes(phone)) {
            /* An owner replying to an escalation alert is answering a customer,
             * not talking to us. Try to relay it before falling back to the old
             * behaviour of ignoring owner traffic entirely. */
            const relayed = await this.relayOwnerReply(phone, text, opts.replyTo)
                .catch(err => {
                    console.error(`[WA-RELAY] ${err.message}`);
                    return false;
                });
            if (relayed) return { success: true, relayed: true };

            console.log(`[WA-INBOUND] From owner ${phone} — no auto-reply`);
            return { success: true, skipped: 'owner' };
        }

        console.log(`[WA-INBOUND] From ${phone}: "${String(text).slice(0, 80)}"`);

        // ── 1. Greet, unless we already did recently ──
        if (process.env.WHATSAPP_AUTO_GREET !== 'false') {
            /* The cooldown is read from the message log rather than kept in
             * memory. Render restarts and spins this process down freely, and an
             * in-memory Map would forget every cooldown each time — meaning a
             * customer in a back-and-forth conversation gets greeted again and
             * again. The log already records every send, so it is the honest
             * source of truth and it survives restarts. */
            const COOLDOWN_MS = (parseInt(process.env.WHATSAPP_GREET_COOLDOWN_HOURS) || 2) * 3600000;
            let greetedRecently = false;
            try {
                const WhatsAppQueue = require('../models/WhatsAppQueue');
                greetedRecently = Boolean(await WhatsAppQueue.exists({
                    phone,
                    type: 'contact_auto_reply',
                    createdAt: { $gte: new Date(Date.now() - COOLDOWN_MS) },
                }));
            } catch (e) {
                // Can't tell → stay silent. Repeating a greeting is worse than
                // missing one; the forward below still alerts a human.
                console.error(`[WA-INBOUND] Cooldown lookup failed: ${e.message}`);
                greetedRecently = true;
            }

            if (greetedRecently) {
                console.log(`[WA-INBOUND] Already greeted ${phone} recently — staying silent`);
            } else {
                // Replying to their own message is inside the 24-hour window, so
                // free-form text is allowed here and needs no template.
                await this.sendContactAutoReply(phone)
                    .catch(err => console.error(`[WA-INBOUND] Greeting failed: ${err.message}`));
            }
        }

        // ── 2. AI assistant ──
        /* Moved here from routes/whatsapp.js, which ran the same logic behind
         * an endpoint with no signature check — meaning anyone who knew the URL
         * could make the business number reply to any phone they named. That
         * route is gone and this is now the only inbound path. */
        let aiHandled = false;
        if (process.env.WHATSAPP_AI_REPLIES !== 'false' && process.env.GEMINI_API_KEY) {
            aiHandled = await this._replyWithAI(phone, text, owners)
                .catch(err => {
                    console.error(`[WA-INBOUND] AI reply failed: ${err.message}`);
                    return false;
                });
        }

        // ── 3. Forward to the owners ──
        /* Skipped when the AI answered: it has already replied to the customer
         * and, on escalation, alerted the owners with more context than this
         * plain forward carries. Doing both means every owner gets two
         * notifications for one customer message. */
        if (process.env.WHATSAPP_FORWARD_INBOUND !== 'false' && !aiHandled) {
            const body = String(text || '').trim() || '[media message]';
            const forward = `📩 *New customer message*\n\n📱 +${phone}\n💬 ${body}\n\n↩️ Reply to them directly on WhatsApp.`;

            /* Not rate-limited, on purpose: the owner needs to see every message,
             * not just the first of a conversation.
             * Suggested template body: "Message from {{1}}: {{2}}"
             * Configure with WHATSAPP_TEMPLATE_INBOUND_FORWARD. */
            for (const owner of owners) {
                await this.sendMessage(owner, forward, 'inbound_forward', null, [`+${phone}`, body])
                    .catch(err => console.error(`[WA-INBOUND] Forward to ${owner} failed: ${err.message}`));
            }
        }

        return { success: true, aiHandled };
    }

    /**
     * Answer a customer with the AI assistant.
     *
     * @returns {Promise<boolean>} true when the AI replied, and therefore the
     *          owners do not also need the plain forward.
     *
     * A conversation that has been escalated to a human stays with that human
     * for the cooldown. Nothing undermines a handover like a bot talking over
     * the person who just took the conversation on.
     */
    async _replyWithAI(phone, text, owners) {
        const body = String(text || '').trim();
        if (!body) return false;

        const WhatsAppConversation = require('../models/WhatsAppConversation');
        const aiChatService = require('./aiChatService');

        const COOLDOWN_MS = (parseInt(process.env.WHATSAPP_ESCALATION_COOLDOWN_HOURS) || 2) * 3600000;
        const now = new Date();

        let conversation = await WhatsAppConversation.findOne({ phone });
        if (!conversation) {
            conversation = new WhatsAppConversation({ phone, messages: [] });
        }

        if (conversation.isHumanEscalated) {
            if ((now - conversation.lastMessageAt) < COOLDOWN_MS) {
                console.log(`[WA-AI] ${phone} is with a human — staying out of it`);
                conversation.lastMessageAt = now;
                await conversation.save().catch(() => {});
                // A human owns this conversation; they do not need a forward
                // for every message the customer sends while they are in it.
                return true;
            }
            // The handover has gone cold. Start fresh rather than resume a
            // history the customer has almost certainly moved on from.
            conversation.isHumanEscalated = false;
            conversation.messages = [];
        }

        const aiResponse = await aiChatService.processMessage(phone, body, conversation.messages);
        if (!aiResponse || !aiResponse.text) return false;

        await this.sendMessage(phone, aiResponse.text, 'contact_auto_reply');

        conversation.messages.push({ role: 'user', content: body, timestamp: now });
        conversation.messages.push({ role: 'model', content: aiResponse.text, timestamp: new Date() });
        conversation.lastMessageAt = new Date();

        if (aiResponse.shouldEscalate) {
            conversation.isHumanEscalated = true;

            // Give the owner the order context up front, so they do not open
            // the conversation by asking for an order number.
            let context = '';
            const orderMatch = body.match(/ORD-\w+/i);
            if (orderMatch) {
                try {
                    const Order = require('../models/Order');
                    const order = await Order.findOne({ orderNumber: orderMatch[0].toUpperCase() })
                        .populate('deliveryPilot');
                    if (order) {
                        context = `\n📦 Order: ${order.orderNumber} (${order.orderStatus})`;
                        if (order.deliveryPilot) {
                            context += `\n🚚 Driver: ${order.deliveryPilot.name} (${order.deliveryPilot.phone})`;
                        }
                    }
                } catch (err) {
                    console.error(`[WA-AI] Could not load order context: ${err.message}`);
                }
            }

            const alert = `🚨 *Customer needs a human*\n\n📱 +${phone}\n💬 "${body}"\n🤖 AI said: "${aiResponse.text}"${context}\n\n↩️ *Reply to this message* and it goes straight to them.`;
            for (const owner of owners) {
                const sent = await this.sendMessage(owner, alert, 'inbound_forward', null, [`+${phone}`, body])
                    .catch(err => {
                        console.error(`[WA-AI] Escalation to ${owner} failed: ${err.message}`);
                        return null;
                    });

                /* Tag the alert with the customer it is about. When the owner
                 * replies, WhatsApp echoes this message's id back to us and
                 * that is how the reply finds its way to the right person. */
                if (sent && sent.messageId) {
                    await this._tagRelayTarget(sent.messageId, phone);
                }
            }
        }

        await conversation.save().catch(err => console.error(`[WA-AI] Could not save conversation: ${err.message}`));
        return true;
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
