/**
 * Test Mailgun Email Service
 * Usage: node test-mailgun.js [recipient@email.com]
 */

require('dotenv').config();
const { sendEmail, getEmailServiceStatus } = require('./src/services/emailService');

const recipient = process.argv[2] || 'walson549@gmail.com';

async function testMailgun() {
    console.log('\n📧 Email Service Status:');
    const status = getEmailServiceStatus();
    console.log(JSON.stringify(status, null, 2));

    if (!status.enabled) {
        console.error('\n❌ Email service is not enabled. Check MAILGUN_API_KEY and MAILGUN_DOMAIN in .env');
        process.exit(1);
    }

    console.log(`\n📤 Sending test email via Mailgun...`);
    console.log(`To: ${recipient}`);
    console.log('Subject: Test Email - ARTEVA Maison\n');

    const result = await sendEmail({
        to: recipient,
        subject: 'Test Email - ARTEVA Maison',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #2c3e50;">🎉 Mailgun is Working!</h1>
                <p>This email was sent via the Mailgun API.</p>
                <p><strong>Provider:</strong> Mailgun</p>
                <p><strong>Domain:</strong> ${status.domain}</p>
                <p><strong>From:</strong> ${status.from}</p>
                <p><strong>Status:</strong> ✅ Active</p>
                <hr style="border: 1px solid #eee; margin: 20px 0;">
                <p style="color: #7f8c8d; font-size: 12px;">
                    ARTEVA Maison - Email Service Test<br>
                    Sent at: ${new Date().toISOString()}<br>
                    If you received this, your email service is working perfectly!
                </p>
            </div>
        `
    });

    console.log('\n📊 Result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
        console.log('\n✅ SUCCESS! Email sent via', result.provider);
        console.log(`📬 Check ${recipient} for the test email`);
    } else {
        console.log('\n❌ FAILED:', result.error);
    }
}

testMailgun().catch(console.error);
