# Resend Domain Verification Guide

## Current Issue

Resend free tier only allows sending emails to your own email address (`walson549@gmail.com`). To send to customers, you need to verify your domain.

## Solution: Verify Your Domain

### Step 1: Go to Resend Dashboard
1. Visit: https://resend.com/domains
2. Login with your Resend account
3. Click "Add Domain"

### Step 2: Add Your Domain
1. Enter: `artevamaisonkw.com`
2. Click "Add"

### Step 3: Add DNS Records
Resend will show you DNS records to add. You need to add these to your domain registrar:

**Example records (yours will be different):**
```
Type: TXT
Name: _resend
Value: resend-verify=abc123xyz...
```

```
Type: MX
Name: @
Value: feedback-smtp.resend.com
Priority: 10
```

```
Type: TXT
Name: @
Value: v=spf1 include:_spf.resend.com ~all
```

### Step 4: Add Records to Your Domain Provider

**If using Namecheap:**
1. Login to Namecheap
2. Go to Domain List → Manage
3. Advanced DNS tab
4. Add the records Resend provided

**If using GoDaddy:**
1. Login to GoDaddy
2. My Products → DNS
3. Add the records Resend provided

**If using Cloudflare:**
1. Login to Cloudflare
2. Select your domain
3. DNS tab
4. Add the records Resend provided

### Step 5: Verify Domain
1. Go back to Resend dashboard
2. Click "Verify" next to your domain
3. Wait for verification (can take a few minutes to 24 hours)

### Step 6: Update Email FROM Address

Once verified, update your `.env` file:

**Current (testing only):**
```env
EMAIL_FROM=ARTEVA Maison <onboarding@resend.dev>
```

**After verification:**
```env
EMAIL_FROM=ARTEVA Maison <noreply@artevamaisonkw.com>
```

Or use any email with your domain:
```env
EMAIL_FROM=ARTEVA Maison <hello@artevamaisonkw.com>
EMAIL_FROM=ARTEVA Maison <support@artevamaisonkw.com>
EMAIL_FROM=ARTEVA Maison <orders@artevamaisonkw.com>
```

### Step 7: Redeploy
After updating `.env` on Render:
1. Go to Render dashboard
2. Your backend service
3. Environment tab
4. Update `EMAIL_FROM` variable
5. Save (will auto-redeploy)

---

## Temporary Workaround (For Testing)

Until domain is verified, you can only send to `walson549@gmail.com`. 

**Option 1: Test with your own email**
- Create test orders with walson549@gmail.com
- Test password reset with walson549@gmail.com
- Test admin emails to yourself

**Option 2: Use Gmail SMTP for now (not recommended)**
Keep Resend for production, but temporarily switch back to Gmail for testing:

```env
# Temporarily use Gmail for testing
EMAIL_SERVICE=gmail
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=princewalson68@gmail.com
EMAIL_PASS=zvnpwokofdkgjkul
```

But remember: Gmail SMTP doesn't work on Render in production!

---

## Resend Pricing

**Free Tier:**
- 100 emails/day
- 3,000 emails/month
- Only to verified email (walson549@gmail.com) OR verified domain

**Paid Plans:**
- $20/month: 50,000 emails/month
- No domain verification required
- Better deliverability

---

## Recommended Approach

1. **Verify domain** (best solution, free)
2. **Use your email for testing** until domain verified
3. **Upgrade to paid plan** if you need to send immediately

---

## DNS Verification Troubleshooting

**If verification fails:**
1. Wait 24 hours (DNS propagation takes time)
2. Check DNS records are correct: https://mxtoolbox.com/SuperTool.aspx
3. Make sure there are no typos in the records
4. Contact your domain registrar if issues persist

**Check DNS propagation:**
```bash
nslookup -type=TXT _resend.artevamaisonkw.com
```

---

## Current Status

- ✅ Resend API key configured
- ✅ Email service working
- ❌ Domain not verified (can only send to walson549@gmail.com)
- ⏳ Need to verify artevamaisonkw.com

Once domain is verified, all email features will work for all customers!
