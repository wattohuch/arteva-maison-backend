# Email Service Setup Guide - Gmail SMTP

## Current Configuration

Your email service is already configured to use Gmail SMTP:

- **Email Host**: smtp.gmail.com
- **Port**: 587 (TLS)
- **Email**: princewalson68@gmail.com
- **App Password**: Configured in .env

## Testing Email Service

To verify your email service is working in production:

```bash
cd arteva-maison-backend
node test-email.js
```

This will:
1. Verify SMTP connection
2. Send a test email to your configured email address

## Common Issues & Solutions

### Issue 1: "Invalid login" or "Authentication failed"

**Solution**: Verify your Gmail App Password
- Go to: https://myaccount.google.com/apppasswords
- Generate a new app password
- Update `EMAIL_PASS` in `.env` file with the new password (no spaces)

### Issue 2: Emails not being sent in production

**Possible causes**:
1. Firewall blocking port 587
2. App password expired or incorrect
3. Gmail account security settings changed

**Solution**: 
- Run the test script to diagnose
- Check server logs for email errors
- Verify 2-Step Verification is enabled on Gmail account

### Issue 3: Emails going to spam

**Solution**:
- Add SPF record to your domain DNS
- Add DKIM record to your domain DNS
- Consider using a dedicated email service like SendGrid or AWS SES for production

## Email Service Features

Your backend currently supports:
- ✅ Order confirmation emails
- ✅ Order status update emails
- ✅ Welcome emails for new users
- ✅ Password reset OTP emails

## Production Recommendations

For better deliverability in production, consider:

1. **Use a dedicated email service**:
   - SendGrid (free tier: 100 emails/day)
   - AWS SES (very cheap, reliable)
   - Mailgun (free tier: 5,000 emails/month)

2. **Configure your domain**:
   - Add SPF record
   - Add DKIM record
   - Add DMARC record

3. **Monitor email delivery**:
   - Track bounce rates
   - Monitor spam complaints
   - Keep email lists clean

## Current Status

✅ Gmail SMTP is configured and ready to use
✅ Email service is production-ready
✅ All email templates are implemented

Run the test script to verify everything is working!
