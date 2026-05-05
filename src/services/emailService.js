/**
 * ARTEVA Maison - Email Service (Mailgun API)
 * Uses Mailgun REST API — works on Render (which blocks SMTP ports 465/587)
 * Flex plan: 1,000 emails/month free
 */

const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { getWelcomeEmailHtml, getOrderConfirmationHtml, getOrderStatusUpdateHtml, getPasswordResetOTPHtml } = require('./emailTemplates');

// Mailgun client
let mg = null;
let mailgunDomain = null;

/**
 * Initialize Mailgun client
 */
function initializeEmailService() {
    console.log('\n📧 Initializing Email Service (Mailgun API)...');

    if (!process.env.MAILGUN_API_KEY) {
        console.error('❌ MAILGUN_API_KEY missing in environment variables');
        console.error('   Get your API key from: https://app.mailgun.com/settings/api_security');
        return false;
    }

    if (!process.env.MAILGUN_DOMAIN) {
        console.error('❌ MAILGUN_DOMAIN missing in environment variables');
        console.error('   Set it to your verified domain, e.g. mg.artevamaisonkw.com');
        return false;
    }

    try {
        const mailgun = new Mailgun(formData);
        mg = mailgun.client({
            username: 'api',
            key: process.env.MAILGUN_API_KEY,
            url: 'https://api.eu.mailgun.net'  // EU region
        });
        mailgunDomain = process.env.MAILGUN_DOMAIN;

        console.log('✅ Mailgun API initialized');
        console.log(`📧 Sending domain: ${mailgunDomain}`);
        console.log(`📧 Sending from: ${process.env.EMAIL_FROM || `ARTEVA Maison <noreply@${mailgunDomain}>`}`);
        console.log('📊 Capacity: 1,000 emails/month (Flex plan)');
        console.log('');
        return true;
    } catch (error) {
        console.error('❌ Mailgun initialization failed:', error.message);
        return false;
    }
}

/**
 * Send email using Mailgun API
 */
async function sendEmail({ to, subject, html, text }) {
    if (!mg || !mailgunDomain) {
        console.error('❌ Mailgun not initialized. Check MAILGUN_API_KEY and MAILGUN_DOMAIN in .env');
        return { success: false, error: 'Email service not initialized' };
    }

    try {
        const messageData = {
            from: process.env.EMAIL_FROM || `ARTEVA Maison <noreply@${mailgunDomain}>`,
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: html,
            text: text || subject
        };

        const result = await mg.messages.create(mailgunDomain, messageData);

        console.log(`📧 Email sent to ${to}: ${result.id || 'OK'}`);
        return { success: true, messageId: result.id, provider: 'mailgun' };
    } catch (error) {
        console.error(`❌ Failed to send email to ${to}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send order confirmation email
 */
async function sendOrderConfirmation(order, user) {
    const html = getOrderConfirmationHtml(order, user);

    return sendEmail({
        to: user.email,
        subject: `Order Confirmed - ${order.orderNumber} | ARTEVA Maison`,
        html
    });
}

/**
 * Send order status update email
 */
async function sendOrderStatusUpdate(order, user, newStatus) {
    const html = getOrderStatusUpdateHtml(order, user, newStatus);

    const statusTitles = {
        confirmed: 'Order Confirmed',
        packed: 'Order Packed',
        processing: 'Processing Order',
        handed_over: 'Order Handed to Delivery',
        out_for_delivery: 'Out for Delivery',
        delivered: 'Order Delivered',
        cancelled: 'Order Cancelled'
    };

    const subjectPrefix = statusTitles[newStatus] || 'Order Status Update';

    return sendEmail({
        to: user.email,
        subject: `${subjectPrefix} - ${order.orderNumber} | ARTEVA Maison`,
        html
    });
}

/**
 * Send welcome email to new user
 */
async function sendWelcomeEmail(user) {
    const html = getWelcomeEmailHtml(user);

    return sendEmail({
        to: user.email,
        subject: `Welcome to ARTEVA Maison! ✨`,
        html
    });
}

/**
 * Send password reset OTP email
 */
async function sendOTPEmail(user, otp) {
    const html = getPasswordResetOTPHtml(user, otp);

    return sendEmail({
        to: user.email,
        subject: `Password Reset OTP - ARTEVA Maison`,
        html
    });
}

/**
 * Get email service status
 */
function getEmailServiceStatus() {
    return {
        provider: 'Mailgun API',
        enabled: mg !== null && mailgunDomain !== null,
        limit: '1,000 emails/month (Flex plan)',
        domain: mailgunDomain || 'not configured',
        from: process.env.EMAIL_FROM || (mailgunDomain ? `noreply@${mailgunDomain}` : 'not configured')
    };
}

/**
 * Send new order notification email to admin
 */
async function sendAdminNewOrderNotification(order, customer) {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.EMAIL_FROM || `noreply@${mailgunDomain}`;
    
    // Build items list
    const itemsList = (order.items || []).map(item => 
        `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0ece0;font-size:14px;color:#2c241b;">${item.name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0ece0;text-align:center;font-size:14px;color:#6b5e4f;">×${item.quantity}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0ece0;text-align:right;font-size:14px;font-weight:600;color:#2c241b;">${(item.price * item.quantity).toFixed(3)} KWD</td>
        </tr>`
    ).join('');

    const addr = order.shippingAddress || {};
    const addressLine = [addr.fullName, addr.area, addr.block, addr.street, addr.building].filter(Boolean).join(', ');

    const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Inter',Arial,sans-serif;background:#faf8f4;padding:32px 20px;">
        <div style="background:#fff;border-radius:16px;padding:32px;border:1px solid rgba(201,169,98,0.15);box-shadow:0 2px 12px rgba(0,0,0,0.04);">
            <div style="text-align:center;margin-bottom:24px;">
                <h1 style="font-family:'Playfair Display',serif;font-size:24px;color:#2c241b;margin:0;">🛍️ New Order Received!</h1>
                <p style="color:#c9a962;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin:8px 0 0;">ARTÉVA MAISON</p>
            </div>
            
            <div style="background:linear-gradient(135deg,rgba(201,169,98,0.08),rgba(201,169,98,0.03));border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid rgba(201,169,98,0.15);">
                <table style="width:100%;border-collapse:collapse;">
                    <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9e9183;">Order Number</td>
                        <td style="padding:4px 0;font-size:15px;font-weight:700;color:#2c241b;text-align:right;">${order.orderNumber || 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9e9183;">Customer</td>
                        <td style="padding:4px 0;font-size:14px;color:#2c241b;text-align:right;">${customer ? customer.name : (addr.fullName || 'Guest')}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9e9183;">Email</td>
                        <td style="padding:4px 0;font-size:14px;color:#2c241b;text-align:right;">${customer ? customer.email : 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9e9183;">Phone</td>
                        <td style="padding:4px 0;font-size:14px;color:#2c241b;text-align:right;">${customer ? (customer.phone || addr.phone || 'N/A') : 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9e9183;">Payment</td>
                        <td style="padding:4px 0;font-size:14px;color:#2c241b;text-align:right;">${order.paymentMethod || 'N/A'}</td>
                    </tr>
                </table>
            </div>

            <h3 style="font-size:14px;color:#9e9183;text-transform:uppercase;letter-spacing:0.06em;margin:20px 0 8px;">Items Ordered</h3>
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f5f2ec;">
                        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#9e9183;text-transform:uppercase;letter-spacing:0.05em;">Product</th>
                        <th style="padding:10px 12px;text-align:center;font-size:12px;color:#9e9183;text-transform:uppercase;">Qty</th>
                        <th style="padding:10px 12px;text-align:right;font-size:12px;color:#9e9183;text-transform:uppercase;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsList}
                </tbody>
            </table>

            <div style="margin-top:16px;padding:16px;background:#f5f2ec;border-radius:12px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:14px;color:#6b5e4f;font-weight:600;">TOTAL</span>
                <span style="font-size:22px;font-weight:700;color:#c9a962;font-family:'Playfair Display',serif;">${(order.total || 0).toFixed(3)} KWD</span>
            </div>

            ${addressLine ? `
            <div style="margin-top:16px;">
                <h3 style="font-size:12px;color:#9e9183;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 6px;">Shipping Address</h3>
                <p style="font-size:14px;color:#2c241b;margin:0;line-height:1.5;">${addressLine}</p>
            </div>
            ` : ''}

            <div style="text-align:center;margin-top:24px;">
                <p style="font-size:11px;color:#9e9183;">Login to the admin dashboard to manage this order</p>
            </div>
        </div>
    </div>
    `;

    return sendEmail({
        to: adminEmail,
        subject: `🛍️ New Order #${order.orderNumber || ''} — ${(order.total || 0).toFixed(3)} KWD | ARTÉVA Maison`,
        html
    });
}

// Initialize on module load
initializeEmailService();

module.exports = {
    sendEmail,
    sendOrderConfirmation,
    sendOrderStatusUpdate,
    sendWelcomeEmail,
    sendOTPEmail,
    getEmailServiceStatus,
    sendAdminNewOrderNotification
};
