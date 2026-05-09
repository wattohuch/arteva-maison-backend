/**
 * WhatsApp Notification Service (Unofficial / Free API via Baileys)
 * Sends order notifications to OWNER and CUSTOMERS via WhatsApp Web protocol.
 * Requires server to scan a QR code on startup once.
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

class WhatsAppService {
    constructor() {
        this.sock = null;
        this.isConnected = false;
        this.ownerPhone = process.env.WHATSAPP_OWNER_PHONE || '96550683207';
        
        // Setup Auth Directory
        this.authPath = path.join(__dirname, '../../whatsapp-auth');
        if (!fs.existsSync(this.authPath)) {
            fs.mkdirSync(this.authPath, { recursive: true });
        }
        
        this.init();
    }

    async init() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: false, // We use pairing code instead
                logger: pino({ level: 'silent' }), // Suppress heavy logs
                browser: ['ARTEVA Server', 'Chrome', '2.0.0'] // Required for pairing code
            });

            this.sock.ev.on('creds.update', saveCreds);

            // Request pairing code if not logged in
            if (!state.creds.registered) {
                setTimeout(async () => {
                    try {
                        // Phone number must have country code but no + (e.g. 96550683207)
                        const phone = this.ownerPhone.replace(/[^0-9]/g, '');
                        const code = await this.sock.requestPairingCode(phone);
                        console.log('\n=========================================');
                        console.log('🔗 WHATSAPP PAIRING CODE');
                        console.log(`1. Open WhatsApp on ${phone}`);
                        console.log(`2. Go to Settings -> Linked Devices`);
                        console.log(`3. Click "Link a Device", then tap "Link with phone number instead"`);
                        console.log(`4. Enter this exact code:`);
                        console.log(`   ${code.match(/.{1,4}/g).join('-')}   `);
                        console.log('=========================================\n');
                    } catch (e) {
                        console.error('Failed to request pairing code. Ensure WHATSAPP_OWNER_PHONE is set correctly:', e.message);
                    }
                }, 3000);
            }

            this.sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                    console.log('WhatsApp connection closed, reconnecting:', shouldReconnect);
                    this.isConnected = false;
                    
                    if (shouldReconnect) {
                        setTimeout(() => this.init(), 3000);
                    } else {
                        console.log('WhatsApp logged out! Deleting auth folder to allow fresh scan...');
                        try { fs.rmSync(this.authPath, { recursive: true, force: true }); } catch (e) {}
                        setTimeout(() => this.init(), 3000);
                    }
                } else if (connection === 'open') {
                    console.log('✅ WhatsApp successfully connected and ready to send messages!');
                    this.isConnected = true;
                }
            });
        } catch (err) {
            console.error('Failed to initialize WhatsApp:', err);
        }
    }

    /**
     * Send WhatsApp message
     */
    async sendMessage(to, message) {
        if (!this.isConnected || !this.sock) {
            console.warn('⚠️ WhatsApp not connected yet. Cannot send message to:', to);
            return { success: false, error: 'Not connected' };
        }

        try {
            // Format phone number (remove + and spaces, must have country code)
            const formattedPhone = to.replace(/[\s\+\-\(\)]/g, '');
            const jid = `${formattedPhone}@s.whatsapp.net`;

            // Check if number is actually on WhatsApp
            const [result] = await this.sock.onWhatsApp(jid);
            if (!result || !result.exists) {
                console.warn(`⚠️ Number ${formattedPhone} is not registered on WhatsApp.`);
                return { success: false, error: 'Not on WhatsApp' };
            }

            await this.sock.sendMessage(jid, { text: message });
            console.log(`📱 WhatsApp message sent successfully to ${formattedPhone}`);
            return { success: true };
        } catch (error) {
            console.error(`❌ Failed to send WhatsApp message to ${to}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify owner about new order
     */
    async notifyOwnerNewOrder(order, user) {
        // Use Arabic product names if user prefers Arabic
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
    // Use Arabic name if available and user prefers Arabic
    const productName = (isArabic && item.nameAr) ? item.nameAr : item.name;
    return `• ${productName} x${item.quantity} - ${item.price} ${order.currency}`;
}).join('\n')}

📍 *${isArabic ? 'عنوان التوصيل' : 'Delivery Address'}:*
${order.shippingAddress.street}
${order.shippingAddress.city}, ${order.shippingAddress.country}
${order.shippingAddress.phone ? `📞 ${order.shippingAddress.phone}` : ''}

${order.notes ? `📝 *${isArabic ? 'ملاحظات' : 'Notes'}:* ${order.notes}` : ''}

🌐 ${isArabic ? 'عرض في الإدارة' : 'View in admin'}: ${process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com'}/admin/orders
        `.trim();

        return this.sendMessage(this.ownerPhone, message);
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

🌐 ${isArabic ? 'عرض في الإدارة' : 'View in admin'}: ${process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com'}/admin/orders
        `.trim();

        return this.sendMessage(this.ownerPhone, message);
    }

    /**
     * Notify owner about order status change
     */
    async notifyOwnerOrderStatusChange(order, user, oldStatus, newStatus) {
        const isArabic = user.language === 'ar';
        
        const statusEmoji = {
            pending: '⏳',
            confirmed: '✅',
            packed: '📦',
            processing: '⚙️',
            handed_over: '🚚',
            out_for_delivery: '🛵',
            delivered: '✅',
            cancelled: '❌'
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

🌐 ${isArabic ? 'عرض في الإدارة' : 'View in admin'}: ${process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com'}/admin/orders
        `.trim();

        return this.sendMessage(this.ownerPhone, message);
    }

    /**
     * Notify owner about payment received
     */
    async notifyOwnerPaymentReceived(order, user) {
        const isArabic = user.language === 'ar';
        
        const message = `
💰 *${isArabic ? 'تم استلام الدفع' : 'PAYMENT RECEIVED'}*

📦 *${isArabic ? 'الطلب' : 'Order'}:* ${order.orderNumber}
👤 *${isArabic ? 'العميل' : 'Customer'}:* ${user.name}

💳 *${isArabic ? 'المبلغ' : 'Amount'}:* ${order.total} ${order.currency}
💳 *${isArabic ? 'طريقة الدفع' : 'Method'}:* ${order.paymentMethod.toUpperCase()}
✅ *${isArabic ? 'الحالة' : 'Status'}:* ${isArabic ? 'مدفوع' : 'PAID'}

🌐 ${isArabic ? 'عرض في الإدارة' : 'View in admin'}: ${process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com'}/admin/orders
        `.trim();

        return this.sendMessage(this.ownerPhone, message);
    }

    /**
     * Notify customer about delivery with proof URL
     */
    async notifyCustomerDelivery(order, user, proofUrl) {
        if (!user.phone && !order.shippingAddress?.phone) return;
        
        const phone = user.phone || order.shippingAddress.phone;
        const isArabic = user.language === 'ar';
        const backendUrl = process.env.RENDER_EXTERNAL_URL || 'https://arteva-maison-backend-gy1x.onrender.com';
        const fullProofUrl = `${backendUrl}${proofUrl}`;

        const message = isArabic 
            ? `مرحباً ${user.name || 'عميلنا العزيز'}،\nتم توصيل طلبك رقم *${order.orderNumber}* بنجاح ✅\n\nيمكنك رؤية صورة التوصيل هنا:\n${fullProofUrl}\n\nشكراً لتسوقك مع ARTÉVA Maison! ✨`
            : `Hello ${user.name || 'Valued Customer'},\nYour order *${order.orderNumber}* has been successfully delivered ✅\n\nYou can view your delivery proof photo here:\n${fullProofUrl}\n\nThank you for shopping with ARTÉVA Maison! ✨`;

        return this.sendMessage(phone, message);
    }
}

module.exports = new WhatsAppService();
