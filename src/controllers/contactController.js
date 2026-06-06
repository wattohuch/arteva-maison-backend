const { asyncHandler } = require('../middleware/error');
const { sendEmail } = require('../services/emailService');

// Escape HTML to prevent XSS in email templates
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// @desc    Send contact form message
// @route   POST /api/contact
// @access  Public
const sendContactMessage = asyncHandler(async (req, res) => {
    const { firstName, lastName, email, phone, subject, message } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !message) {
        res.status(400);
        throw new Error('Please fill in all required fields');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        res.status(400);
        throw new Error('Please provide a valid email address');
    }

    // Recipient email address
    const recipientEmail = 'princewalson68@gmail.com';

    // Create email HTML content (escape user input to prevent XSS)
    const safeName = `${escapeHtml(firstName)} ${escapeHtml(lastName)}`;
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone);
    const safeSubject = escapeHtml(subject) || 'General Inquiry';
    const safeMessage = escapeHtml(message);

    const emailHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: #333; margin-top: 0;">New Contact Form Submission</h2>
                <p style="color: #666; margin-bottom: 0;">You have received a new message from the ARTEVA Maison website.</p>
            </div>
            
            <div style="background-color: #fff; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #333; width: 150px;">Name:</td>
                        <td style="padding: 10px 0; color: #666;">${safeName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #333;">Email:</td>
                        <td style="padding: 10px 0; color: #666;">${safeEmail}</td>
                    </tr>
                    ${safePhone ? `
                    <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #333;">Phone:</td>
                        <td style="padding: 10px 0; color: #666;">${safePhone}</td>
                    </tr>
                    ` : ''}
                    <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #333;">Subject:</td>
                        <td style="padding: 10px 0; color: #666;">${safeSubject}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #333; vertical-align: top;">Message:</td>
                        <td style="padding: 10px 0; color: #666; white-space: pre-wrap;">${safeMessage}</td>
                    </tr>
                </table>
            </div>
            
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #999; font-size: 12px;">
                <p>This message was sent from the ARTEVA Maison contact form.</p>
                <p>Reply directly to: ${safeEmail}</p>
            </div>
        </div>
    `;

    // Send email (no attachments needed for contact form)
    const emailResult = await sendEmail({
        to: recipientEmail,
        subject: `Contact Form: ${subject || 'General Inquiry'} - ${firstName} ${lastName}`,
        html: emailHtml,
        text: `
New Contact Form Submission

Name: ${firstName} ${lastName}
Email: ${email}
${phone ? `Phone: ${phone}` : ''}
Subject: ${subject || 'General Inquiry'}

Message:
${message}

---
Reply directly to: ${email}
        `.trim(),
        attachments: [] // No attachments for contact form emails
    });

    if (!emailResult.success) {
        res.status(500);
        throw new Error('Failed to send email. Please try again later.');
    }

    // Send WhatsApp auto-reply if phone number provided (fire-and-forget)
    if (phone) {
        try {
            const whatsappService = require('../services/whatsappService');
            whatsappService.sendContactAutoReply(phone, true);
        } catch (waErr) {
            console.error('[CONTACT] WhatsApp auto-reply failed:', waErr.message);
            // Don't fail the request — WhatsApp is optional
        }
    }

    res.json({
        success: true,
        message: 'Your message has been sent successfully. We will get back to you shortly.'
    });
});

module.exports = {
    sendContactMessage
};

