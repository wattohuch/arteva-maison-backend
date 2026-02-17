const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');
const { getWelcomeEmailHtml, getOrderConfirmationHtml, getOrderStatusUpdateHtml, getPasswordResetOTPHtml } = require('./emailTemplates');

// Initialize Resend
let resend = null;

/**
 * Initialize Resend client
 */
function initializeResend() {
    if (!resend && process.env.RESEND_API_KEY) {
        resend = new Resend(process.env.RESEND_API_KEY);
        console.log('📧 Email service ready (Resend)');
    }
    return resend;
}

/**
 * Send an email using Resend
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 */
async function sendEmail({ to, subject, html, text }) {
    try {
        const client = initializeResend();
        
        if (!client) {
            console.error('❌ Resend not initialized. Check RESEND_API_KEY in .env');
            return { success: false, error: 'Email service not configured' };
        }

        const result = await client.emails.send({
            from: process.env.EMAIL_FROM || 'ARTEVA Maison <onboarding@resend.dev>',
            to: to,
            subject: subject,
            html: html,
            text: text || subject
        });

        console.log(`📧 Email sent to ${to}: ${result.id}`);
        return { success: true, messageId: result.id };
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

// Initialize on module load
initializeResend();

module.exports = {
    sendEmail,
    sendOrderConfirmation,
    sendOrderStatusUpdate,
    sendWelcomeEmail,
    sendOTPEmail
};
