# Email Service Fix - Deployment Checklist

## Problem
SMTP timeout errors on production (Render blocks SMTP ports 587/465)

## Solution
Switch to Resend API (HTTP-based, works everywhere)

## Deployment Steps

### 1. Install Dependencies
```bash
cd arteva-maison-backend
npm install resend
```

### 2. Get Resend API Key
1. Sign up: https://resend.com/signup
2. Get API key: https://resend.com/api-keys
3. Copy the key (starts with `re_`)

### 3. Update Environment Variables

**On Render Dashboard:**
1. Go to your service settings
2. Add environment variable:
   - Key: `RESEND_API_KEY`
   - Value: `re_your_actual_key`
3. Update `EMAIL_FROM`:
   - Value: `ARTEVA Maison <onboarding@resend.dev>` (temporary)

**Or in .env file (local):**
```bash
RESEND_API_KEY=re_your_actual_key
EMAIL_FROM=ARTEVA Maison <onboarding@resend.dev>
```

### 4. Deploy
```bash
git add .
git commit -m "Fix: Switch to Resend for email service"
git push
```

### 5. Verify
After deployment, check logs for:
```
📧 Email service ready (Resend)
```

### 6. Test
- Create a new user account
- Place a test order
- Check email delivery

## Optional: Add Your Domain (Better Deliverability)

1. Go to: https://resend.com/domains
2. Add domain: `artevamaisonkw.com`
3. Add DNS records (provided by Resend)
4. After verification, update `EMAIL_FROM`:
   ```
   EMAIL_FROM=ARTEVA Maison <noreply@artevamaisonkw.com>
   ```

## Files Changed

✅ `package.json` - Added resend dependency
✅ `src/services/emailService.js` - Hybrid email service (Resend + SMTP fallback)
✅ `.env` - Added RESEND_API_KEY configuration
✅ `arteva-maison-frontend/index.html` - Fixed newsletter form (added id/name attributes)

## Rollback Plan

If something goes wrong, the system automatically falls back to SMTP (Gmail).

To force SMTP only:
1. Don't set `RESEND_API_KEY`
2. System will use Gmail SMTP (if ports aren't blocked)

## Support

- Resend Setup Guide: `RESEND_SETUP.md`
- Email Setup Guide: `EMAIL_SETUP_GUIDE.md`

## Quick Commands

```bash
# Install dependencies
npm install

# Test locally
npm run dev

# Deploy to production
git push
```

## Expected Results

Before:
```
❌ Email service initialization failed: SMTP verification timeout
```

After:
```
📧 Email service ready (Resend)
✅ All email features working
```

## Free Tier Limits

- 3,000 emails/month
- 100 emails/day
- More than enough for your current traffic!
