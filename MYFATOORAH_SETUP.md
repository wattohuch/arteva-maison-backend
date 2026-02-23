# MyFatoorah Payment Gateway Setup Guide

## Overview
MyFatoorah is integrated to support:
- **KNET** (Kuwait National Electronic Payment)
- **Credit/Debit Cards** (VISA, MasterCard)
- **Apple Pay**

## Setup Steps

### 1. Get MyFatoorah Account
1. Visit [MyFatoorah.com](https://myfatoorah.com/)
2. Sign up for a merchant account
3. Complete KYC verification
4. Get your API keys from the dashboard

### 2. Configure Environment Variables

Add these to your `.env` file:

```env
# MyFatoorah Payment Gateway
MYFATOORAH_API_KEY=your_api_key_here
MYFATOORAH_MODE=test
# Change to 'live' when ready for production
```

**Test Mode:**
- Use test API key for development
- Test URL: `https://apitest.myfatoorah.com`

**Live Mode:**
- Use live API key for production
- Live URL: `https://api.myfatoorah.com`

### 3. Install Dependencies

```bash
cd arteva-maison-backend
npm install axios
```

### 4. Deploy Backend

The integration is already complete in the code. Just deploy:

```bash
git add .
git commit -m "Integrate MyFatoorah payment gateway"
git push origin main
```

Render will auto-deploy the backend.

### 5. Update Environment on Render

1. Go to Render Dashboard
2. Select your backend service
3. Go to Environment tab
4. Add:
   - `MYFATOORAH_API_KEY` = your API key
   - `MYFATOORAH_MODE` = `test` (or `live`)
5. Save changes (will trigger redeploy)

### 6. Deploy Frontend

```bash
cd arteva-maison-frontend
git add .
git commit -m "Update checkout for MyFatoorah"
git push origin main
```

Vercel will auto-deploy the frontend.

## Payment Method IDs

MyFatoorah uses these IDs:
- `1` = KNET
- `2` = VISA/MasterCard
- `20` = Apple Pay

## Testing

### Test Cards (Test Mode Only)

**Successful Payment:**
- Card: `5123450000000008`
- Expiry: Any future date
- CVV: Any 3 digits

**Failed Payment:**
- Card: `4000000000000002`
- Expiry: Any future date
- CVV: Any 3 digits

### Test KNET
In test mode, MyFatoorah provides a test KNET interface.

## Callback URLs

The integration uses these URLs:
- **Success:** `https://www.artevamaisonkw.com/order-success`
- **Error:** `https://www.artevamaisonkw.com/checkout?error=payment_failed`

## Webhook Setup (Optional but Recommended)

1. In MyFatoorah dashboard, go to Webhooks
2. Add webhook URL: `https://arteva-maison-backend-gy1x.onrender.com/api/payments/webhook`
3. Select events: `TransactionStatusChanged`
4. Save

This ensures order status updates even if user closes browser.

## Features Implemented

✅ KNET payment
✅ Credit/Debit card payment
✅ Apple Pay
✅ Cash on Delivery (COD)
✅ Order tracking
✅ Email confirmations
✅ Real-time payment verification
✅ Automatic stock updates
✅ Webhook support

## Removed

❌ Stripe integration (completely removed)

## Support

For MyFatoorah support:
- Email: support@myfatoorah.com
- Docs: https://myfatoorah.readme.io/docs

## Currency

All payments are in **KWD** (Kuwaiti Dinar).

## Go Live Checklist

- [ ] Get live API key from MyFatoorah
- [ ] Update `MYFATOORAH_MODE=live` in Render environment
- [ ] Test all payment methods in live mode
- [ ] Verify webhook is working
- [ ] Test email confirmations
- [ ] Monitor first few transactions closely
