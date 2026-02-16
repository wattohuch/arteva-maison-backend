
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { getWelcomeEmailHtml, getOrderConfirmationHtml, getOrderStatusUpdateHtml, getPasswordResetOTPHtml } = require('./emailTemplates');

// Logo path for email CID embedding
const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'images', 'logo.png');
const HEADER_IMG_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'images', 'Brown Image.png');
const BG_LOGO_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'images', 'arteva_maison_email_logo.png');

// Create reusable transporter
let transporter = null;

/**
 * Initialize the email transporter
 */
function initializeTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT) || 587,
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }
    return transporter;
}

/**
 * Initialize and verify email service
 * Returns a promise that resolves when email service is ready
 */
async function initializeEmailService() {
    try {
        const transport = initializeTransporter();
        
        // Verify connection with promise
        await transport.verify();
        
        console.log('📧 Email service initialized and ready');
        console.log(`📬 Email configured: ${process.env.EMAIL_USER}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Email service initialization failed:', error.message);
        console.error('⚠️  Email features will not work. Please check EMAIL_USER and EMAIL_PASS in .env');
        return { success: false, error: error.message };
    }
}

/**
 * Send an email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (fallback)
 */
async function sendEmail({ to, subject, html, text, attachments }) {
    try {
        const transport = initializeTransporter();

        const mailOptions = {
            from: process.env.EMAIL_FROM || '"ARTEVA Maison" <noreply@artevamaisonkw.com>',
            to,
            subject,
            text: text || subject,
            html
        };

        // Attach logo if the file exists
        if (attachments) {
            mailOptions.attachments = attachments;
        } else {
            const defaultAttachments = [];

            if (fs.existsSync(LOGO_PATH)) {
                defaultAttachments.push({
                    filename: 'logo.png',
                    path: LOGO_PATH,
                    cid: 'arteva-logo'
                });
            }

            if (fs.existsSync(HEADER_IMG_PATH)) {
                defaultAttachments.push({
                    filename: 'header-bg.png',
                    path: HEADER_IMG_PATH,
                    cid: 'brown-header'
                });
            }

            if (fs.existsSync(BG_LOGO_PATH)) {
                defaultAttachments.push({
                    filename: 'bg-logo.png',
                    path: BG_LOGO_PATH,
                    cid: 'arteva-logo-bg'
                });
            } else if (fs.existsSync(LOGO_PATH)) {
                // Fallback to regular logo if specific bg logo missing
                defaultAttachments.push({
                    filename: 'bg-logo-fallback.png',
                    path: LOGO_PATH,
                    cid: 'arteva-logo-bg'
                });
            }

            mailOptions.attachments = defaultAttachments;
        }

        const info = await transport.sendMail(mailOptions);

        console.log(`📧 Email sent to ${to}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
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

// Initialize transporter on module load (but don't verify yet - that happens in initializeEmailService)
initializeTransporter();

module.exports = {
    sendEmail,
    sendOrderConfirmation,
    sendOrderStatusUpdate,
    sendWelcomeEmail,
    sendOTPEmail,
    initializeEmailService
};

