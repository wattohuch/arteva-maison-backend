/**
 * ARTEVA Maison - Email Service (Resend API)
 * Uses HTTPS API calls — works on Render (which blocks SMTP ports 465/587)
 * Free tier: 100 emails/day via Resend
 */

const { Resend } = require('resend');
const { getWelcomeEmailHtml, getOrderConfirmationHtml, getOrderStatusUpdateHtml, getPasswordResetOTPHtml } = require('./emailTemplates');

// Resend client
let resend = null;

/**
 * Initialize Resend client
 */
function initializeEmailService() {
    console.log('\n📧 Initializing Email Service (Resend API)...');

    if (!process.env.RESEND_API_KEY) {
        console.error('❌ RESEND_API_KEY missing in environment variables');
        console.error('   Get your API key from: https://resend.com');
        return false;
    }

    try {
        resend = new Resend(process.env.RESEND_API_KEY);
        console.log('✅ Resend API initialized');
        console.log(`📧 Sending from: ${process.env.EMAIL_FROM || 'onboarding@resend.dev'}`);
        console.log('📊 Capacity: 100 emails/day (free tier)');
        console.log('');
        return true;
    } catch (error) {
        console.error('❌ Resend initialization failed:', error.message);
        return false;
    }
}

/**
 * Send email using Resend API
 */
async function sendEmail({ to, subject, html, text }) {
    if (!resend) {
        console.error('❌ Resend not initialized. Check RESEND_API_KEY in .env');
        return { success: false, error: 'Email service not initialized' };
    }

    try {
        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'ARTEVA Maison <onboarding@resend.dev>',
            to: to,
            subject: subject,
            html: html,
            text: text || subject
        });

        console.log(`📧 Email sent to ${to}: ${result.data?.id || 'OK'}`);
        return { success: true, messageId: result.data?.id, provider: 'resend' };
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
        provider: 'Resend API',
        enabled: resend !== null,
        limit: '100 emails/day (free tier)',
        from: process.env.EMAIL_FROM || 'onboarding@resend.dev'
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
