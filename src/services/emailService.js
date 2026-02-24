/**
 * Unified Email Service with Multiple Providers
 * Supports: Gmail SMTP, Mailgun, SendGrid, Resend
 * Automatic fallback if one provider fails
 */

const nodemailer = require('nodemailer');
const { getWelcomeEmailHtml, getOrderConfirmationHtml, getOrderStatusUpdateHtml, getPasswordResetOTPHtml } = require('./emailTemplates');

// Email providers configuration
const providers = {
    gmail: {
        name: 'Gmail SMTP',
        limit: '500/day',
        enabled: false,
        transporter: null
    },
    mailgun: {
        name: 'Mailgun',
        limit: '10,000/month (333/day)',
        enabled: false,
        transporter: null
    },
    sendgrid: {
        name: 'SendGrid',
        limit: '100/day',
        enabled: false,
        transporter: null
    },
    resend: {
        name: 'Resend',
        limit: '100/day (free)',
        enabled: false,
        client: null
    }
};

/**
 * Initialize Gmail SMTP transporter
 */
function initializeGmail() {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        return false;
    }

    try {
        providers.gmail.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD // App-specific password
            }
        });
        providers.gmail.enabled = true;
        console.log('✅ Gmail SMTP initialized (500 emails/day)');
        return true;
    } catch (error) {
        console.error('❌ Gmail SMTP initialization failed:', error.message);
        return false;
    }
}

/**
 * Initialize Mailgun transporter
 */
function initializeMailgun() {
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        return false;
    }

    try {
        providers.mailgun.transporter = nodemailer.createTransport({
            host: 'smtp.mailgun.org',
            port: 587,
            secure: false,
            auth: {
                user: `postmaster@${process.env.MAILGUN_DOMAIN}`,
                pass: process.env.MAILGUN_API_KEY
            }
        });
        providers.mailgun.enabled = true;
        console.log('✅ Mailgun SMTP initialized (10,000 emails/month)');
        return true;
    } catch (error) {
        console.error('❌ Mailgun SMTP initialization failed:', error.message);
        return false;
    }
}

/**
 * Initialize SendGrid transporter
 */
function initializeSendGrid() {
    if (!process.env.SENDGRID_API_KEY) {
        return false;
    }

    try {
        providers.sendgrid.transporter = nodemailer.createTransport({
            host: 'smtp.sendgrid.net',
            port: 587,
            secure: false,
            auth: {
                user: 'apikey',
                pass: process.env.SENDGRID_API_KEY
            }
        });
        providers.sendgrid.enabled = true;
        console.log('✅ SendGrid SMTP initialized (100 emails/day)');
        return true;
    } catch (error) {
        console.error('❌ SendGrid SMTP initialization failed:', error.message);
        return false;
    }
}

/**
 * Initialize Resend client
 */
function initializeResend() {
    if (!process.env.RESEND_API_KEY) {
        return false;
    }

    try {
        const { Resend } = require('resend');
        providers.resend.client = new Resend(process.env.RESEND_API_KEY);
        providers.resend.enabled = true;
        console.log('✅ Resend initialized (100 emails/day free)');
        return true;
    } catch (error) {
        console.error('❌ Resend initialization failed:', error.message);
        return false;
    }
}

/**
 * Initialize all available email providers
 */
function initializeEmailService() {
    console.log('\n📧 Initializing Email Service...');
    
    const gmailOk = initializeGmail();
    const mailgunOk = initializeMailgun();
    const sendgridOk = initializeSendGrid();
    const resendOk = initializeResend();

    const enabledProviders = [
        gmailOk && 'Gmail (500/day)',
        mailgunOk && 'Mailgun (10k/month)',
        sendgridOk && 'SendGrid (100/day)',
        resendOk && 'Resend (100/day)'
    ].filter(Boolean);

    if (enabledProviders.length === 0) {
        console.error('❌ No email providers configured!');
        console.error('   Add at least one of: GMAIL_USER, MAILGUN_API_KEY, SENDGRID_API_KEY, or RESEND_API_KEY');
        return false;
    }

    console.log(`✅ Email service ready with ${enabledProviders.length} provider(s):`);
    enabledProviders.forEach(p => console.log(`   - ${p}`));
    console.log('');

    return true;
}

/**
 * Send email using the first available provider with automatic fallback
 */
async function sendEmail({ to, subject, html, text }) {
    const errors = [];

    // Try Gmail first (highest daily limit)
    if (providers.gmail.enabled) {
        try {
            const info = await providers.gmail.transporter.sendMail({
                from: process.env.EMAIL_FROM || `"ARTEVA Maison" <${process.env.GMAIL_USER}>`,
                to,
                subject,
                html,
                text: text || subject
            });
            console.log(`📧 Email sent via Gmail to ${to}: ${info.messageId}`);
            return { success: true, messageId: info.messageId, provider: 'gmail' };
        } catch (error) {
            errors.push(`Gmail: ${error.message}`);
            console.warn(`⚠️  Gmail failed, trying next provider...`);
        }
    }

    // Try Mailgun second (highest monthly limit)
    if (providers.mailgun.enabled) {
        try {
            const info = await providers.mailgun.transporter.sendMail({
                from: process.env.EMAIL_FROM || `"ARTEVA Maison" <noreply@${process.env.MAILGUN_DOMAIN}>`,
                to,
                subject,
                html,
                text: text || subject
            });
            console.log(`📧 Email sent via Mailgun to ${to}: ${info.messageId}`);
            return { success: true, messageId: info.messageId, provider: 'mailgun' };
        } catch (error) {
            errors.push(`Mailgun: ${error.message}`);
            console.warn(`⚠️  Mailgun failed, trying next provider...`);
        }
    }

    // Try SendGrid third
    if (providers.sendgrid.enabled) {
        try {
            const info = await providers.sendgrid.transporter.sendMail({
                from: process.env.EMAIL_FROM || `"ARTEVA Maison" <noreply@artevamaisonkw.com>`,
                to,
                subject,
                html,
                text: text || subject
            });
            console.log(`📧 Email sent via SendGrid to ${to}: ${info.messageId}`);
            return { success: true, messageId: info.messageId, provider: 'sendgrid' };
        } catch (error) {
            errors.push(`SendGrid: ${error.message}`);
            console.warn(`⚠️  SendGrid failed, trying next provider...`);
        }
    }

    // Try Resend last
    if (providers.resend.enabled) {
        try {
            const result = await providers.resend.client.emails.send({
                from: process.env.EMAIL_FROM || 'ARTEVA Maison <onboarding@resend.dev>',
                to,
                subject,
                html,
                text: text || subject
            });
            console.log(`📧 Email sent via Resend to ${to}: ${result.id}`);
            return { success: true, messageId: result.id, provider: 'resend' };
        } catch (error) {
            errors.push(`Resend: ${error.message}`);
        }
    }

    // All providers failed
    console.error('❌ All email providers failed:', errors.join(', '));
    return { success: false, error: 'All email providers failed', errors };
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
        providers: Object.entries(providers).map(([key, config]) => ({
            name: config.name,
            enabled: config.enabled,
            limit: config.limit
        })),
        totalEnabled: Object.values(providers).filter(p => p.enabled).length
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
