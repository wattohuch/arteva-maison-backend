const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');
const { getWelcomeEmailHtml, getOrderConfirmationHtml, getOrderStatusUpdateHtml, getPasswordResetOTPHtml } = require('./emailTemplates');

// Initialize Resend client
let resend = null;

/**
 * Initialize the Resend email client
 */
function initializeResend() {
    if (!resend && process.env.RESEND_API_KEY) {
        resend = new Resend(process.env.RESEND_API_KEY);
    }
    return resend;
}

/**
 * Initialize and verify email service
 * Returns a promise that resolves when email service is ready
 */
async function initializeEmailService() {
    try {
        if (!process.env.RESEND_API_KEY) {
            throw new Error('RESEND_API_KEY not configured in environment variables');
        }

        initializeResend();
        
        console.log('✅ Resend email service initialized');
        console.log(`📬 Email from: ${process.env.EMAIL_FROM || 'onboarding@resend.dev'}`);
        console.log('💡 Using Resend API (HTTPS) - no SMTP ports needed');
        
        return { success: true };
    } catch (error) {
        console.error('❌ Email service initialization failed:', error.message);
        console.error('⚠️  Email features will not work. Please check RESEND_API_KEY in .env');
        console.error('💡 Get your API key from: https://resend.com/api-keys');
        return { success: false, error: error.message };
    }
}

/**
 * Send an email using Resend
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (fallback)
 */
async function sendEmail({ to, subject, html, text }) {
    try {
        const client = initializeResend();
        
        if (!client) {
            throw new Error('Resend client not initialized');
        }

        const emailData = {
            from: process.env.EMAIL_FROM || 'ARTEVA Maison <onboarding@resend.dev>',
            to: [to],
            subject,
            html
        };

        const { data, error } = await client.emails.send(emailData);

        if (error) {
            throw new Error(error.message);
        }

        console.log(`📧 Email sent to ${to}: ${data.id}`);
        return { success: true, messageId: data.id };
    } catch (error) {
        console.error('❌ Email send error:', error.message);
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

    // Status titles map for subject line
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

// Initialize Resend on module load
initializeResend();

module.exports = {
    sendEmail,
    sendOrderConfirmation,
    sendOrderStatusUpdate,
    sendWelcomeEmail,
    sendOTPEmail,
    initializeEmailService
};

