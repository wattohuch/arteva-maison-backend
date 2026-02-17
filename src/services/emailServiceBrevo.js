/**
 * Email Service using Brevo (Sendinblue)
 * No DNS verification required!
 */

const brevo = require('@getbrevo/brevo');

// Initialize Brevo client
let apiInstance = null;

/**
 * Initialize the Brevo email client
 */
function initializeBrevo() {
    if (!apiInstance && process.env.BREVO_API_KEY) {
        const defaultClient = brevo.ApiClient.instance;
        const apiKey = defaultClient.authentications['api-key'];
        apiKey.apiKey = process.env.BREVO_API_KEY;
        apiInstance = new brevo.TransactionalEmailsApi();
    }
    return apiInstance;
}

/**
 * Initialize and verify email service
 */
async function initializeEmailService() {
    try {
        if (!process.env.BREVO_API_KEY) {
            throw new Error('BREVO_API_KEY not configured in environment variables');
        }

        initializeBrevo();
        
        console.log('✅ Brevo email service initialized');
        console.log(`📬 Email from: ${process.env.EMAIL_FROM || 'noreply@artevamaisonkw.com'}`);
        console.log('💡 Using Brevo API (HTTPS) - no DNS verification needed!');
        console.log('📊 Free tier: 300 emails/day');
        
        return { success: true };
    } catch (error) {
        console.error('❌ Email service initialization failed:', error.message);
        console.error('⚠️  Email features will not work. Please check BREVO_API_KEY in .env');
        console.error('💡 Get your API key from: https://app.brevo.com/settings/keys/api');
        return { success: false, error: error.message };
    }
}

/**
 * Send an email using Brevo
 */
async function sendEmail({ to, subject, html, text }) {
    try {
        const client = initializeBrevo();
        
        if (!client) {
            throw new Error('Brevo client not initialized');
        }

        const sendSmtpEmail = new brevo.SendSmtpEmail();
        
        sendSmtpEmail.sender = {
            email: process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] || 'noreply@artevamaisonkw.com',
            name: process.env.EMAIL_FROM?.match(/^(.+?)\s*</)?.[1] || 'ARTEVA Maison'
        };
        
        sendSmtpEmail.to = [{ email: to }];
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = html;
        
        if (text) {
            sendSmtpEmail.textContent = text;
        }

        const data = await client.sendTransacEmail(sendSmtpEmail);

        console.log(`📧 Email sent to ${to}: ${data.messageId}`);
        return { success: true, messageId: data.messageId };
    } catch (error) {
        console.error('❌ Email send error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send order confirmation email
 */
async function sendOrderConfirmation(order, user) {
    const { getOrderConfirmationHtml } = require('./emailTemplates');
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
    const { getOrderStatusUpdateHtml } = require('./emailTemplates');
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
    const { getWelcomeEmailHtml } = require('./emailTemplates');
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
    const { getPasswordResetOTPHtml } = require('./emailTemplates');
    const html = getPasswordResetOTPHtml(user, otp);

    return sendEmail({
        to: user.email,
        subject: `Password Reset OTP - ARTEVA Maison`,
        html
    });
}

module.exports = {
    sendEmail,
    sendOrderConfirmation,
    sendOrderStatusUpdate,
    sendWelcomeEmail,
    sendOTPEmail,
    initializeEmailService
};
