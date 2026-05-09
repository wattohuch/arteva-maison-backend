/**
 * WhatsApp Notification Service (whatsapp-web.js)
 * Reliable API provider that uses Puppeteer under the hood.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.ownerPhone = process.env.WHATSAPP_OWNER_PHONE || '96550683207';
        this.pairingCodeRequested = false;
        
        this.init();
    }

    async init() {
        try {
            console.log('⏳ Starting WhatsApp Client...');
            
            this.client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: path.join(__dirname, '../../whatsapp-auth-wwjs')
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu'
                    ]
                }
            });

            this.client.on('qr', async (qr) => {
                // When QR is requested, it means we are not logged in.
                // We will request a pairing code instead of showing the QR.
                if (!this.pairingCodeRequested) {
                    this.pairingCodeRequested = true;
                    try {
                        const phone = this.ownerPhone.replace(/[^0-9]/g, '');
                        // Request the 8-digit code
                        const code = await this.client.requestPairingCode(phone);
                        
                        console.log('\n=========================================');
                        console.log('🔗 WHATSAPP PAIRING CODE (NEW API)');
                        console.log(`1. Open WhatsApp on ${phone}`);
                        console.log(`2. Go to Settings -> Linked Devices`);
                        console.log(`3. Click "Link a Device", then tap "Link with phone number instead"`);
                        console.log(`4. Enter this exact code:`);
                        console.log(`   ${code.match(/.{1,4}/g).join('-')}   `);
                        console.log('=========================================\n');
                    } catch (e) {
                        console.error('Failed to request pairing code:', e.message);
                    }
                }
            });

            this.client.on('ready', () => {
                console.log('✅ WhatsApp successfully connected and ready to send messages!');
                this.isConnected = true;
            });

            this.client.on('authenticated', () => {
                console.log('🔒 WhatsApp Authenticated successfully!');
            });

            this.client.on('auth_failure', msg => {
                console.error('❌ WhatsApp Authentication failure:', msg);
            });

            this.client.on('disconnected', (reason) => {
                console.log('WhatsApp was disconnected:', reason);
                this.isConnected = false;
                this.pairingCodeRequested = false;
                
                // Re-initialize
                setTimeout(() => {
                    this.client.initialize();
                }, 5000);
            });

            await this.client.initialize();

        } catch (err) {
            console.error('Failed to initialize WhatsApp:', err);
        }
    }

    /**
     * Send WhatsApp message
     */
    async sendMessage(to, message) {
        if (!this.isConnected || !this.client) {
            console.warn('⚠️ WhatsApp not connected yet. Cannot send message to:', to);
            return { success: false, error: 'Not connected' };
        }

        try {
            const formattedPhone = to.replace(/[\s\+\-\(\)]/g, '');
            const jid = `${formattedPhone}@c.us`;

            // Check if registered
            const isRegistered = await this.client.isRegisteredUser(jid);
            if (!isRegistered) {
                console.warn(`⚠️ Number ${formattedPhone} is not registered on WhatsApp.`);
                return { success: false, error: 'Not on WhatsApp' };
            }

            await this.client.sendMessage(jid, message);
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
