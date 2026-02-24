/**
 * Test Mailgun Email Service
 */

require('dotenv').config();
const { sendEmail, getEmailServiceStatus } = require('./src/services/emailService');

async function testMailgun() {
    console.log('\n📧 Email Service Status:');
    const status = getEmailServiceStatus();
    console.log(JSON.stringify(status, null, 2));
    
    console.log('\n📤 Sending test email via Mailgun...');
    console.log('To: walson549@gmail.com');
    console.log('Subject: Test Email - ARTEVA Maison\n');
    
    const result = await sendEmail({
        to: 'walson549@gmail.com',
        subject: 'Test Email - ARTEVA Maison',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #2c3e50;">🎉 Mailgun is Working!</h1>
                <p>This email was sent via Mailgun SMTP.</p>
                <p><strong>Provider:</strong> Mailgun</p>
                <p><strong>Limit:</strong> 10,000 emails/month (333/day)</p>
                <p><strong>Status:</strong> ✅ Active</p>
                <hr style="border: 1px solid #eee; margin: 20px 0;">
                <p style="color: #7f8c8d; font-size: 12px;">
                    ARTEVA Maison - Email Service Test<br>
                    If you received this, your email service is working perfectly!
                </p>
            </div>
        `
    });
    
    console.log('\n📊 Result:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.success) {
        console.log('\n✅ SUCCESS! Email sent via', result.provider);
        console.log('📬 Check walson549@gmail.com for the test email');
    } else {
        console.log('\n❌ FAILED:', result.error);
        if (result.errors) {
            console.log('Errors:', result.errors);
        }
    }
}

testMailgun().catch(console.error);
