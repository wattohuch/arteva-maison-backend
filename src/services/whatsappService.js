/**
 * WhatsApp Notification Service (Green API)
 * 
 * Uses Green API (https://green-api.com) — Free tier available.
 * No Baileys, no pairing codes, no session issues.
 * Just HTTP requests. Works 24/7.
 * 
 * Setup:
 *   1. Go to https://green-api.com and sign up (free)
 *   2. Create an instance
 *   3. Scan QR code ONCE on their dashboard
 *   4. Copy your Instance ID and API Token
 *   5. Set env vars: GREEN_API_INSTANCE_ID and GREEN_API_TOKEN
 */

class WhatsAppService {
    constructor() {
        this.instanceId = process.env.GREEN_API_INSTANCE_ID || '';
        this.apiToken = process.env.GREEN_API_TOKEN || '';
        this.ownerPhone = process.env.WHATSAPP_OWNER_PHONE || '96550683207';
        this.baseUrl = `https://api.green-api.com/waInstance${this.instanceId}`;
        
        // Check connection on startup
        this.isConnected = !!(this.instanceId && this.apiToken);
        
        if (this.isConnected) {
            console.log('✅ WhatsApp Service (Green API) initialized');
            console.log(`   Instance: ${this.instanceId}`);
            console.log(`   Owner: ${this.ownerPhone}`);
            this.checkStatus();
        } else {
            console.log('⚠️ WhatsApp Service: GREEN_API_INSTANCE_ID or GREEN_API_TOKEN not set');
            console.log('   Sign up at https://green-api.com (free tier)');
        }
    }

    /**
     * Check Green API instance status
     */
    async checkStatus() {
        try {
            const res = await fetch(`${this.baseUrl}/getStateInstance/${this.apiToken}`);
            const data = await res.json();
            this.isConnected = data.stateInstance === 'authorized';
            console.log(`📱 WhatsApp status: ${data.stateInstance} (${this.isConnected ? 'ready ✅' : 'not authorized ❌'})`);
            if (!this.isConnected) {
                console.log('   → Go to https://console.green-api.com and scan QR code');
            }
            return this.isConnected;
        } catch (e) {
            console.error('WhatsApp status check failed:', e.message);
            return false;
        }
    }

    /**
     * Format phone number for Green API
     * Green API expects: 96597295917@c.us (country code + number, no +)
     */
    formatPhone(phone) {
        if (!phone) return null;
        // Remove all non-digits
        let cleaned = phone.replace(/[^\d]/g, '');
        // If starts with 0, assume Kuwait, add 965
        if (cleaned.startsWith('0')) {
            cleaned = '965' + cleaned.substring(1);
        }
        // If number is 8 digits (Kuwait local), add 965
        if (cleaned.length === 8) {
            cleaned = '965' + cleaned;
        }
        return cleaned;
    }

    /**
     * Send WhatsApp message via Green API
     */
    async sendMessage(to, message) {
        if (!this.instanceId || !this.apiToken) {
            console.warn('⚠️ WhatsApp not configured. Set GREEN_API_INSTANCE_ID and GREEN_API_TOKEN');
            return { success: false, error: 'Not configured' };
        }

        try {
            const phone = this.formatPhone(to);
            if (!phone) {
                console.warn('⚠️ Invalid phone number:', to);
                return { success: false, error: 'Invalid phone' };
            }

            const chatId = `${phone}@c.us`;
            
            const res = await fetch(`${this.baseUrl}/sendMessage/${this.apiToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId, message })
            });

            const data = await res.json();
            
            if (data.idMessage) {
                console.log(`📱 WhatsApp sent to ${phone} ✅ (${data.idMessage})`);
                return { success: true, messageId: data.idMessage };
            } else {
                console.error(`❌ WhatsApp send failed to ${phone}:`, JSON.stringify(data));
                return { success: false, error: data.message || 'Send failed' };
            }
        } catch (error) {
            console.error(`❌ WhatsApp error to ${to}:`, error.message);
            return { success: false, error: error.message };
        }
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

    /**
     * Notify customer about new order confirmation
     */
    async notifyCustomerNewOrder(order, user) {
        if (!user.phone && !order.shippingAddress?.phone) return;
        const phone = user.phone || order.shippingAddress.phone;
        const isArabic = user.language === 'ar';
        
        const message = isArabic
            ? `مرحباً ${user.name || 'عميلنا العزيز'}،\nشكراً لتسوقك مع ARTÉVA Maison! ✨\nتم تأكيد طلبك رقم *${order.orderNumber}* بنجاح.\n\nالمجموع: ${order.total} ${order.currency}\nسنقوم بإبلاغك عندما يتم شحن طلبك.`
            : `Hello ${user.name || 'Valued Customer'},\nThank you for shopping with ARTÉVA Maison! ✨\nYour order *${order.orderNumber}* has been confirmed.\n\nTotal: ${order.total} ${order.currency}\nWe will notify you when your order is shipped.`;

        return this.sendMessage(phone, message);
    }

    /**
     * Notify customer about order status change
     */
    async notifyCustomerOrderStatusChange(order, user, newStatus) {
        if (!user.phone && !order.shippingAddress?.phone) return;
        if (newStatus === 'pending' || newStatus === 'delivered') return;

        const phone = user.phone || order.shippingAddress.phone;
        const isArabic = user.language === 'ar';

        const statusTranslations = {
            confirmed: isArabic ? 'تم تأكيد طلبك ويجري تجهيزه' : 'Your order is confirmed and being prepared',
            packed: isArabic ? 'تم تغليف طلبك وجاهز للشحن' : 'Your order is packed and ready for shipping',
            processing: isArabic ? 'طلبك قيد المعالجة' : 'Your order is processing',
            handed_over: isArabic ? 'تم تسليم طلبك لشركة الشحن' : 'Your order has been handed over to delivery',
            out_for_delivery: isArabic ? 'طلبك في الطريق إليك الآن 🛵' : 'Your order is out for delivery now 🛵',
            cancelled: isArabic ? 'تم إلغاء طلبك' : 'Your order has been cancelled'
        };

        const statusMsg = statusTranslations[newStatus];
        if (!statusMsg) return;

        const message = isArabic 
            ? `مرحباً ${user.name || 'عميلنا العزيز'}،\nتحديث بخصوص طلبك رقم *${order.orderNumber}* 📦\n\n${statusMsg}`
            : `Hello ${user.name || 'Valued Customer'},\nUpdate for your order *${order.orderNumber}* 📦\n\n${statusMsg}`;

        return this.sendMessage(phone, message);
    }
}

module.exports = new WhatsAppService();
