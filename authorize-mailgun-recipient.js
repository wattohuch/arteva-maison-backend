/**
 * Authorize recipient for Mailgun sandbox domain
 * Sandbox domains can only send to authorized recipients
 */

require('dotenv').config();
const axios = require('axios');

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const RECIPIENT_EMAIL = 'walson549@gmail.com';

async function authorizeRecipient() {
    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
        console.error('❌ Missing MAILGUN_API_KEY or MAILGUN_DOMAIN in .env');
        process.exit(1);
    }

    console.log('\n📧 Authorizing recipient for Mailgun sandbox...');
    console.log(`Domain: ${MAILGUN_DOMAIN}`);
    console.log(`Recipient: ${RECIPIENT_EMAIL}\n`);

    try {
        // Add authorized recipient to sandbox domain
        const response = await axios.post(
            `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/authorized_recipients`,
            `address=${encodeURIComponent(RECIPIENT_EMAIL)}`,
            {
                auth: {
                    username: 'api',
                    password: MAILGUN_API_KEY
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        console.log('✅ Authorization request sent successfully!');
        console.log('Response:', response.data);
        console.log('\n📬 Mailgun sent a verification email to:', RECIPIENT_EMAIL);
        console.log('Please check the inbox and click the verification link.');
        console.log('\n⏳ After verification, you can send emails to this address.\n');
    } catch (error) {
        if (error.response) {
            console.error('❌ Failed to authorize recipient');
            console.error('Status:', error.response.status);
            console.error('Error:', error.response.data);
            
            if (error.response.status === 401) {
                console.error('\n💡 Tip: Check your MAILGUN_API_KEY in .env');
            } else if (error.response.status === 400) {
                console.error('\n💡 Tip: Recipient might already be authorized or pending verification');
            }
        } else {
            console.error('❌ Error:', error.message);
        }
        process.exit(1);
    }
}

authorizeRecipient();
