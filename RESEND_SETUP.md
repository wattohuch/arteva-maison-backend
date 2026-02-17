# Resend Email Setup Guide

## Why Resend?

Your current SMTP setup is timing out because many hosting platforms (like Render) block outbound SMTP ports for security reasons. Resend solves this by using HTTP APIs instead of SMTP.

**Benefits:**
- ✅ Works on all hosting platforms (no port blocking)
- ✅ Better deliverability rates
- ✅ Free tier: 3,000 emails/month, 100/day
- ✅ Simple API, no complex SMTP configuration
- ✅ Built-in analytics and tracking

## Setup Steps (5 minutes)

### 1. Create Resend Account

Go to: https://resend.com/signup

Sign up with your email (free account).

### 2. Get Your API Key

1. After signing in, go to: https://resend.com/api-keys
2. Click "Create API Key"
3. Name it: "ARTEVA Maison Production"
4. Copy the API key (starts with `re_`)

### 3. Add Domain (Optional but Recommended)

For better deliverability, add your domain:

1. Go to: https://resend.com/domains
2. Click "Add Domain"
3. Enter: `artevamaisonkw.com`
4. Add the DNS records shown (SPF, DKIM, DMARC)
5. Wait for verification (usually 5-10 minutes)

**Without domain:** You can use `onboarding@resend.dev` as sender (limited to 100 emails/day)
**With domain:** You can use `noreply@artevamaisonkw.com` (3,000 emails/month)

### 4. Update Environment Variables

In your `.env` file or Render dashboard, add:

```bash
RESEND_API_KEY=re_your_actual_api_key_here
EMAIL_FROM=ARTEVA Maison <noreply@artevamaisonkw.com>
```

**Important:** 
- If you haven't verified your domain yet, use: `EMAIL_FROM=ARTEVA Maison <onboarding@resend.dev>`
- After domain verification, change to: `EMAIL_FROM=ARTEVA Maison <noreply@artevamaisonkw.com>`

### 5. Install Resend Package

```bash
cd arteva-maison-backend
npm install resend
```

### 6. Deploy and Test

After deploying, your email service will automatically use Resend!

The system tries Resend first, then falls back to SMTP if Resend isn't configured.

## DNS Records for Domain Verification

When you add your domain in Resend, you'll need to add these DNS records to your domain registrar:

**SPF Record (TXT):**
```
Name: @
Value: v=spf1 include:_spf.resend.com ~all
```

**DKIM Record (TXT):**
```
Name: resend._domainkey
Value: [Provided by Resend]
```

**DMARC Record (TXT):**
```
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:princewalson68@gmail.com
```

## Testing

After setup, test your emails:

1. Create a new user account on your site
2. Check if you receive the welcome email
3. Place a test order
4. Check if you receive the order confirmation

## Monitoring

View email logs in Resend dashboard:
- https://resend.com/emails

You can see:
- Delivery status
- Open rates
- Click rates
- Bounce rates

## Troubleshooting

### "API key not found"
- Make sure `RESEND_API_KEY` is set in your environment variables
- Restart your server after adding the key

### "Domain not verified"
- Use `onboarding@resend.dev` temporarily
- Check DNS records are correctly added
- Wait 10-15 minutes for DNS propagation

### Still using SMTP?
- Check server logs to see which provider is active
- Make sure Resend package is installed: `npm list resend`

## Cost

**Free Tier:**
- 3,000 emails/month
- 100 emails/day
- Perfect for small to medium e-commerce sites

**Paid Plans (if you grow):**
- $20/month: 50,000 emails
- $80/month: 100,000 emails

For your current traffic, the free tier should be more than enough!

## Support

- Resend Docs: https://resend.com/docs
- Resend Support: support@resend.com
- Your current setup: Hybrid (tries Resend, falls back to SMTP)
