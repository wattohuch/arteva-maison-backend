# 🚀 Quick Start - Deploy Email Fix

## ✅ Status: Ready to Deploy

Your Resend API key is working! Test email sent successfully.

## 📦 Deploy in 3 Steps

### 1️⃣ Add to Render (2 minutes)

Go to: https://dashboard.render.com → Your Service → Environment

Add:
```
RESEND_API_KEY = re_QuqeTfPm_CK6P4atNKNSxs9kAXFE96udZ
EMAIL_FROM = ARTEVA Maison <onboarding@resend.dev>
```

Click "Save Changes"

### 2️⃣ Deploy Code (1 minute)

```bash
git add .
git commit -m "Fix: Email service with Resend"
git push
```

### 3️⃣ Verify (1 minute)

Check Render logs for:
```
📧 Email service ready (Resend)
```

## ⚠️ Important: Add Domain (Required)

**Current:** Can only send to walson549@gmail.com
**Need:** Send to all customers

### Add Domain (10 minutes)

1. Go to: https://resend.com/domains
2. Add: `artevamaisonkw.com`
3. Add 3 DNS records (shown by Resend)
4. Wait 5-30 minutes
5. Update Render: `EMAIL_FROM = ARTEVA Maison <noreply@artevamaisonkw.com>`

**See:** `RENDER_DEPLOYMENT.md` for DNS details

## 📊 What's Fixed

✅ Newsletter form (id/name attributes)
✅ Email service (Resend API)
✅ No more SMTP timeout errors
✅ Works on Render (no port blocking)

## 🧪 Test Locally

```bash
cd arteva-maison-backend
node test-resend.js
```

## 📚 Full Documentation

- `EMAIL_FIX_SUMMARY.md` - Complete overview
- `RENDER_DEPLOYMENT.md` - Detailed deployment guide
- `RESEND_SETUP.md` - Resend configuration guide

## 🎯 Success!

Deploy now → Add domain → Customer emails working! 🎉
