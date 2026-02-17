/**
 * Resend Email Service Test Script
 * Run this to verify your Resend API key is working
 */

require('dotenv').config();
const { Resend } = require('resend');

console.log('========================================');
console.log('Testing Resend Email Service');
console.log('========================================\n');

console.log('Configuration:');
console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? '✅ Configured' : '❌ NOT SET');
console.log('EMAIL_FROM:', process.env.EMAIL_FROM);
console.log('\n');

if (!process.env.RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY not found in .env file');
    console.error('Please add: RESEND_API_KEY=re_your_key');
    process.exit(1);
}

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

console.log('📧 Sending test email...\n');

// Send test email
resend.emails.send({
    from: process.env.EMAIL_FROM || 'ARTEVA Maison <onboarding@resend.dev>',
    to: 'walson549@gmail.com', // Your Resend registered email
    subject: 'ARTEVA Maison - Resend Test Email ✅',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #C9A961 0%, #8B7355 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 28px;">✅ Email Service Working!</h1>
            </div>
            
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                <h2 style="color: #C9A961; margin-top: 0;">Resend is Configured Correctly</h2>
                
                <p style="color: #333; line-height: 1.6;">
                    Your ARTEVA Maison email service is now using <strong>Resend</strong> and working perfectly!
                </p>
                
                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #C9A961;">
                    <h3 style="color: #333; margin-top: 0;">✨ What's Working:</h3>
                    <ul style="color: #666; line-height: 1.8;">
                        <li>✅ Order confirmation emails</li>
                        <li>✅ Order status updates</li>
                        <li>✅ Welcome emails for new users</li>
                        <li>✅ Password reset emails</li>
                    </ul>
                </div>
                
                <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="color: #2e7d32; margin: 0;">
                        <strong>💡 Next Step:</strong> Add your domain (artevamaisonkw.com) in Resend to use your own email address instead of onboarding@resend.dev
                    </p>
                </div>
                
                <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                
                <p style="color: #999; font-size: 12px; margin: 0;">
                    <strong>Test Details:</strong><br>
                    Sent at: ${new Date().toLocaleString()}<br>
                    From: ${process.env.EMAIL_FROM || 'onboarding@resend.dev'}<br>
                    Provider: Resend API<br>
                    API Key: ${process.env.RESEND_API_KEY.substring(0, 10)}...
                </p>
            </div>
        </div>
    `
}).then((result) => {
    if (result.error) {
        console.error('❌ FAILED TO SEND EMAIL');
        console.error('Error:', result.error.message);
        console.error('\n');
        
        if (result.error.message.includes('testing emails')) {
            console.error('📝 Note: In test mode, you can only send to: walson549@gmail.com');
            console.error('To send to any email:');
            console.error('1. Go to: https://resend.com/domains');
            console.error('2. Add your domain: artevamaisonkw.com');
            console.error('3. Add DNS records (SPF, DKIM)');
            console.error('4. Update EMAIL_FROM to use your domain');
        }
        
        process.exit(1);
    }
    
    console.log('✅ TEST EMAIL SENT SUCCESSFULLY!');
    console.log('📬 Email ID:', result.data?.id || result.id);
    console.log('📧 Check your inbox: walson549@gmail.com');
    console.log('\n========================================');
    console.log('🎉 Resend is working perfectly!');
    console.log('========================================\n');
    console.log('Next steps:');
    console.log('1. Deploy your backend to production');
    console.log('2. Add RESEND_API_KEY to your Render environment variables');
    console.log('3. Add your domain in Resend to send to any email address');
    console.log('\n');
    process.exit(0);
}).catch((error) => {
    console.error('❌ FAILED TO SEND EMAIL');
    console.error('Error:', error.message);
    console.error('\n');
    console.error('Common issues:');
    console.error('1. Invalid API key - check your key at https://resend.com/api-keys');
    console.error('2. API key doesn\'t have permission to send emails');
    console.error('3. Network connectivity issues');
    console.error('\n');
    process.exit(1);
});
