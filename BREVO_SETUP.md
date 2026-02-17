# Brevo (Sendinblue) Setup - No DNS Required!

## Why Brevo?

✅ FREE tier: 300 emails/day
✅ NO DNS verification required
✅ Works on Render (uses HTTPS API)
✅ No credit card needed
✅ Professional service

## Step 1: Create Brevo Account

1. Go to https://www.brevo.com
2. Click "Sign up free"
3. Enter your email and create account
4. Verify your email

## Step 2: Get API Key

1. Login to Brevo dashboard
2. Go to https://app.brevo.com/settings/keys/api
3. Click "Generate a new API key"
4. Name it: "ARTEVA Maison Production"
5. Copy the API key (starts with `xkeysib-...`)

## Step 3: Update Environment Variables

Add to your Render environment variables:

```env
BREVO_API_KEY=xkeysib-your-api-key-here
EMAIL_FROM=ARTEVA Maison <noreply@artevamaisonkw.com>
```

Note: You can use ANY email in EMAIL_FROM with Brevo, even without DNS!

## Step 4: Install Brevo Package

```bash
cd arteva-maison-backend
npm install @getbrevo/brevo
```

## Step 5: Update Code

I'll update the emailService.js to use Brevo instead of Resend.

## Step 6: Deploy

Push changes to GitHub, Render will auto-deploy.

## Brevo Free Tier Limits

- 300 emails/day
- 9,000 emails/month
- No DNS verification needed
- All features included

## Upgrade Options (if needed later)

- **Lite:** $25/month - 10,000 emails/month
- **Business:** $65/month - 20,000 emails/month

## Comparison

| Feature | Resend Free | Brevo Free |
|---------|-------------|------------|
| Emails/day | 100 | 300 |
| DNS Required | YES ❌ | NO ✅ |
| Cost | Free | Free |
| Works on Render | YES | YES |

## Next Steps

1. Create Brevo account
2. Get API key
3. I'll update the code
4. Deploy and test

This solves your DNS problem completely!
