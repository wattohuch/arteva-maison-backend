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

// Initialize on module load
initializeEmailService();

module.exports = {
    sendEmail,
    sendOrderConfirmation,
    sendOrderStatusUpdate,
    sendWelcomeEmail,
    sendOTPEmail,
    getEmailServiceStatus
};
