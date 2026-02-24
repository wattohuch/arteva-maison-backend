/**
 * Gmail-Only Email Service
 * Simple, reliable, production-ready
 * 500 emails/day - FREE
 */

const nodemailer = require('nodemailer');
const { getWelcomeEmailHtml, getOrderConfirmationHtml, getOrderStatusUpdateHtml, getPasswordResetOTPHtml } = require('./emailTemplates');

// Gmail transporter
let gmailTransporter = null;

/**
 * Initialize Gmail SMTP transporter
 */
function initializeEmailService() {
    console.log('\n📧 Initializing Gmail Email Service...');
    
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.error('❌ Gmail credentials missing!');
        console.error('   Required: GMAIL_USER and GMAIL_APP_PASSWORD');
        return false;
    }

    try {
        gmailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD
            }
        });
        
        console.log('✅ Gmail SMTP initialized');
        console.log(`📧 Sending from: ${process.env.GMAIL_USER}`);
        console.log('📊 Capacity: 500 emails/day');
        console.log('');
        
        return true;
    } catch (error) {
        console.error('❌ Gmail initialization failed:', error.message);
        return false;
    }
}

/**
 * Send email using Gmail
 */
async function sendEmail({ to, subject, html, text }) {
    if (!gmailTransporter) {
        console.error('❌ Gmail not initialized');
        return { success: false, error: 'Email service not initialized' };
    }

    try {
        const info = await gmailTransporter.sendMail({
            from: process.env.EMAIL_FROM || `"ARTEVA Maison" <${process.env.GMAIL_USER}>`,
            to,
            subject,
            html,
            text: text || subject
        });
        
        console.log(`📧 Email sent to ${to}: ${info.messageId}`);
        return { success: true, messageId: info.messageId, provider: 'gmail' };
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
        provider: 'Gmail SMTP',
        enabled: gmailTransporter !== null,
        limit: '500 emails/day',
        from: process.env.GMAIL_USER
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
