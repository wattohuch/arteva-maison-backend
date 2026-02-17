# Render Deployment Guide - Email Service Fix

## ✅ Test Results

Your Resend API key is working perfectly! Test email sent successfully.

**Email ID:** 2f855894-600d-4cef-a178-350d6836a977

Check your inbox at: walson549@gmail.com

## Deploy to Render (3 Steps)

### Step 1: Update Environment Variables on Render

1. Go to your Render dashboard: https://dashboard.render.com
2. Select your backend service
3. Go to "Environment" tab
4. Add this new environment variable:

```
Key: RESEND_API_KEY
Value: re_QuqeTfPm_CK6P4atNKNSxs9kAXFE96udZ
```

5. Update this existing variable:

```
Key: EMAIL_FROM
Value: ARTEVA Maison <onboarding@resend.dev>
```

6. Click "Save Changes"

### Step 2: Deploy Your Code

```bash
# Make sure all changes are committed
git add .
git commit -m "Fix: Switch to Resend email service"
git push
```

Render will automatically deploy your changes.

### Step 3: Verify Deployment

After deployment completes, check your Render logs. You should see:

```
📧 Email service ready (Resend)
```

Instead of:

```
❌ Email service initialization failed: SMTP verification timeout
```

## Important: Test Mode Limitation

⚠️ **Current Limitation:** In test mode (using `onboarding@resend.dev`), you can only send emails to your registered email: `walson549@gmail.com`

This means:
- ❌ Customer emails won't be delivered yet
- ✅ System is working, just restricted

## Solution: Add Your Domain (Required for Production)

To send emails to your customers, you need to verify your domain:

### 1. Add Domain in Resend

1. Go to: https://resend.com/domains
2. Click "Add Domain"
3. Enter: `artevamaisonkw.com`

### 2. Add DNS Records

Resend will show you 3 DNS records to add. Go to your domain registrar (where you bought artevamaisonkw.com) and add:

**SPF Record (TXT):**
```
Name: @
Type: TXT
Value: v=spf1 include:_spf.resend.com ~all
TTL: 3600
```

**DKIM Record (TXT):**
```
Name: resend._domainkey
Type: TXT
Value: [Copy from Resend dashboard]
TTL: 3600
```

**DMARC Record (TXT):**
```
Name: _dmarc
Type: TXT
Value: v=DMARC1; p=none; rua=mailto:walson549@gmail.com
TTL: 3600
```

### 3. Wait for Verification

- DNS propagation takes 5-30 minutes
- Resend will automatically verify once DNS is updated
- You'll see a green checkmark when verified

### 4. Update EMAIL_FROM

After domain verification, update on Render:

```
EMAIL_FROM=ARTEVA Maison <noreply@artevamaisonkw.com>
```

Now you can send to ANY email address! 🎉

## Testing After Deployment

### Test 1: Create New User Account
1. Go to your website
2. Create a new account
3. Check if welcome email arrives

### Test 2: Place Test Order
1. Add product to cart
2. Complete checkout
3. Check if order confirmation email arrives

### Test 3: Check Resend Dashboard
1. Go to: https://resend.com/emails
2. View all sent emails
3. Check delivery status

## Monitoring

**Resend Dashboard:** https://resend.com/emails

You can see:
- ✅ Delivered emails
- ❌ Failed emails
- 📊 Open rates
- 📈 Click rates

## Free Tier Limits

- 3,000 emails/month
- 100 emails/day
- Perfect for your current traffic!

## Troubleshooting

### "Email service not configured"
- Check RESEND_API_KEY is set on Render
- Restart your service

### "Can only send to walson549@gmail.com"
- You need to verify your domain
- Follow "Add Your Domain" steps above

### Emails not arriving
- Check spam folder
- Check Resend dashboard for delivery status
- Verify domain is properly configured

## Support

- Resend Docs: https://resend.com/docs
- Resend Support: support@resend.com
- Check logs on Render dashboard

## Summary

✅ Resend API key is working
✅ Test email sent successfully
✅ Code is ready to deploy
⏳ Need to add domain for production use

Deploy now and add your domain to enable customer emails!
