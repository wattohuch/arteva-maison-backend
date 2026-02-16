/**
 * Email Service Test Script
 * Run this to verify your Gmail SMTP configuration
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('========================================');
console.log('Testing Email Service Configuration');
console.log('========================================\n');

console.log('Configuration:');
console.log('EMAIL_HOST:', process.env.EMAIL_HOST);
console.log('EMAIL_PORT:', process.env.EMAIL_PORT);
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '***configured***' : 'NOT SET');
console.log('\n');

// Create transporter
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Test connection
console.log('Testing SMTP connection...\n');

transporter.verify(function (error, success) {
    if (error) {
        console.log('❌ EMAIL SERVICE ERROR:');
        console.log('Error:', error.message);
        console.log('\n');
        console.log('Common Issues:');
        console.log('1. Gmail App Password not enabled');
        console.log('   - Go to: https://myaccount.google.com/apppasswords');
        console.log('   - Generate a new app password');
        console.log('   - Update EMAIL_PASS in .env file');
        console.log('\n');
        console.log('2. Less secure app access disabled');
        console.log('   - Gmail requires App Passwords for security');
        console.log('\n');
        console.log('3. Wrong credentials');
        console.log('   - Verify EMAIL_USER and EMAIL_PASS in .env');
        console.log('\n');
    } else {
        console.log('✅ EMAIL SERVICE IS WORKING!');
        console.log('Server is ready to send emails');
        console.log('\n');
        
        // Send test email
        console.log('Sending test email...\n');
        
        transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Send to yourself
            subject: 'ARTEVA Maison - Email Service Test',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #C9A961;">✅ Email Service Working!</h2>
                    <p>Your ARTEVA Maison email service is configured correctly.</p>
                    <p>This test email was sent from your backend server.</p>
                    <hr style="border: 1px solid #C9A961; margin: 20px 0;">
                    <p style="color: #666; font-size: 12px;">
                        Sent at: ${new Date().toLocaleString()}<br>
                        From: ${process.env.EMAIL_USER}
                    </p>
                </div>
            `
        }, (error, info) => {
            if (error) {
                console.log('❌ Failed to send test email:', error.message);
            } else {
                console.log('✅ Test email sent successfully!');
                console.log('Message ID:', info.messageId);
                console.log('Check your inbox:', process.env.EMAIL_USER);
            }
            console.log('\n========================================');
            process.exit(0);
        });
    }
});
