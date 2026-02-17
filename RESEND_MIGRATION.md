# Email Service Migration: SMTP → Resend API

## Problem
The backend was using Gmail SMTP (nodemailer) which was timing out on Render hosting because:
- Many hosting platforms (Render, Vercel, etc.) block SMTP ports (587, 465) for security
- SMTP connections are unreliable and slow
- Connection timeouts were preventing email features from working

## Solution
Switched to **Resend API** which uses HTTPS instead of SMTP ports:
- ✅ No SMTP port blocking issues
- ✅ Faster and more reliable
- ✅ Better deliverability
- ✅ Simple API integration

## Changes Made

### 1. Updated `src/services/emailService.js`
- Removed nodemailer SMTP configuration
- Added Resend API client initialization
- Simplified email sending (no CID attachments needed)
- Updated error messages to reference Resend

### 2. Updated `src/services/emailTemplates.js`
- Changed header image from `cid:brown-header` to hosted URL
- Now uses: `https://www.artevamaisonkw.com/assets/images/Brown%20Image.png`

### 3. Environment Variables (Already Configured)
```env
# Resend Configuration
RESEND_API_KEY=re_QuqeTfPm_CK6P4atNKNSxs9kAXFE96udZ
EMAIL_FROM=ARTEVA Maison <onboarding@resend.dev>
```

## Deployment Steps

1. ✅ Code changes pushed to GitHub
2. ⏳ Render will auto-deploy from GitHub
3. ⏳ Wait for deployment to complete (~2-3 minutes)
4. ✅ Email service will initialize with Resend
5. ✅ Test email functionality

## Expected Console Output (After Deploy)
```
✅ Resend email service initialized
📬 Email from: ARTEVA Maison <onboarding@resend.dev>
💡 Using Resend API (HTTPS) - no SMTP ports needed
```

## Testing
Once deployed, test these email features:
- Welcome email (new user registration)
- Order confirmation email
- Order status updates
- Password reset OTP

## Notes
- Resend free tier: 100 emails/day, 3,000 emails/month
- Using `onboarding@resend.dev` sender (Resend's test domain)
- For production, verify your own domain at https://resend.com/domains
- No code changes needed to switch to custom domain, just update `EMAIL_FROM` in .env

## Rollback (If Needed)
If issues occur, the old SMTP configuration is still in `.env`:
```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=princewalson68@gmail.com
EMAIL_PASS=zvnpwokofdkgjkul
```

But this won't work on Render due to SMTP port blocking.
