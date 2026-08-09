# Connecting ARTÉVA Maison to Meta

Everything below is already built. What remains is creating the accounts on
Meta's side and pasting the credentials into environment variables.
Nothing switches on until its variable is set — an unset key means that feature
renders and behaves as if it does not exist, so you can do these one at a time
and in any order.

**Where the variables go**

| Where | How |
|---|---|
| Backend (Render) | Dashboard → your service → **Environment** → Add Environment Variable → **Save** (redeploys automatically) |
| Frontend (Vercel) | Project → **Settings → Environment Variables** → add → **Redeploy** |

Frontend variables **must** start with `VITE_` or the build strips them.

---

## Before anything else: Business Manager

1. Go to **https://business.facebook.com/**
2. **Create account** → business name `ARTÉVA Maison`, your name, business email.
3. Confirm the email Meta sends.
4. **Settings → Business assets → Add → Facebook Page** — add or claim the ARTÉVA page.
5. **Settings → Accounts → Instagram accounts → Add** — connect `@arteva.maison`.

Everything else attaches to this business.

---

## 1. Meta Pixel + Conversions API

Tracks who visits, what they look at and what they buy, so ads can be targeted
and measured. This is the piece with the clearest commercial return.

### Create the pixel

1. **https://business.facebook.com/events_manager2/**
2. **Connect data sources → Web → Connect**.
3. Name it `ARTEVA Maison Website`, enter `https://www.artevamaisonkw.com`.
4. Choose **Meta Pixel + Conversions API**.
5. Copy the **Pixel ID** (15–16 digits).

### Generate the server access token

6. Still in Events Manager, open your pixel → **Settings**.
7. Scroll to **Conversions API** → **Generate access token**.
8. Copy it immediately — Meta shows it once. It does not expire.

### Set the variables

**Vercel (frontend)**
```
VITE_META_PIXEL_ID=<your pixel id>
```

**Render (backend)**
```
META_PIXEL_ID=<the same pixel id>
META_CAPI_ACCESS_TOKEN=<the token from step 8>
```

Redeploy both.

### Verify it works

9. Events Manager → your pixel → **Test events**.
10. Copy the **test event code** shown there.
11. Add `META_TEST_EVENT_CODE=<that code>` on Render temporarily.
12. Open the site, view a product, add to cart, place a test order.
13. Events should appear live: `PageView`, `ViewContent`, `AddToCart`,
    `InitiateCheckout`, `Purchase`.
14. **Remove `META_TEST_EVENT_CODE` when you are done** or real traffic keeps
    landing in the test tab instead of your live data.

You should see each `Purchase` once, not twice, even though it is sent from
both the browser and the server — they share an `event_id` derived from the
order number, and Meta discards the duplicate. If you *do* see doubles, the two
halves disagree about the order number; tell me and I will look.

**Do not install a pixel through Google Tag Manager as well.** That is the
usual cause of every event being counted twice.

---

## 2. Instagram / Facebook Shop

Puts the catalogue on Instagram so products can be tagged in posts and stories.

### Requirements Meta enforces

- Instagram must be a **Business** or **Creator** account (Instagram app →
  Settings → Account type).
- It must be connected to the Facebook Page.
- You must sell physical goods and have a working returns/refund policy page.
- Review takes anywhere from a day to two weeks.

### Create the catalogue

1. **https://business.facebook.com/commerce/**
2. **Add catalogue** → **Ecommerce** → **Upload product info** → name it
   `ARTÉVA Maison Products`.
3. Open the catalogue → **Data sources** → **Add products** →
   **Use a data feed** → **Scheduled feed**.
4. Paste this URL:

   ```
   https://arteva-maison-backend-gy1x.onrender.com/api/meta/catalog.xml
   ```

5. Set the schedule to **Daily** (hourly if stock moves fast).
6. **Upload** — Meta fetches it immediately and reports any rejected items.

The feed is generated live from the database, so price, stock and images track
the site with no export step. Products marked inactive drop out automatically;
anything without an image or a price is skipped rather than submitted and
rejected. Out-of-stock items are published as `out of stock` and coming-soon
items as `preorder`.

### Turn on Instagram Shopping

7. **Commerce Manager → Shops → Create shop** → pick the catalogue → connect
   the Instagram account.
8. Submit for review.
9. Once approved: Instagram app → **Settings → Business → Shopping → Continue**
   and select the catalogue.

> **Check first:** Instagram Shopping is not available in every country. Confirm
> Kuwait is currently eligible before promising the client a date —
> https://www.facebook.com/business/help/2371372636254534

---

## 3. WhatsApp Cloud API

The code for this has existed for a while and has never had credentials, which
is why order notifications do not send.

### Create the app

1. **https://developers.facebook.com/apps/** → **Create app**.
2. Use case: **Other** → type: **Business** → link it to the ARTÉVA business.
3. In the app: **Add product → WhatsApp → Set up**.

### Get the credentials

4. **WhatsApp → API Setup**. You get a test number immediately.
5. Copy the **Phone number ID** (a long number, *not* the phone number itself).
6. Copy the temporary access token — **it expires in 24 hours**, so it is only
   good for a first test.

### Permanent token (required for production)

7. **https://business.facebook.com/settings/system-users**
8. **Add** → name `ARTEVA API` → role **Admin** → **Create**.
9. **Assign assets** → **Apps** → your app → **Full control**.
10. **Generate new token** → select the app → tick **whatsapp_business_messaging**
    and **whatsapp_business_management** → set expiry **Never** → **Generate**.
11. Copy it now; it is shown once.

### Register the real number

12. **WhatsApp → API Setup → Add phone number**.
13. The number **must not currently be on WhatsApp or WhatsApp Business**. If
    `+965 5068 3207` is in use, delete that WhatsApp account first and wait
    ~20 minutes, or use a different number.
14. Verify by SMS or call. Copy the new **Phone number ID**.

### Set the variables (Render)

```
WHATSAPP_ACCESS_TOKEN=<permanent token from step 11>
WHATSAPP_PHONE_NUMBER_ID=<phone number id from step 14>
WHATSAPP_VERIFY_TOKEN=<invent any random string, e.g. arteva-wh-9f3k2>
META_APP_SECRET=<App dashboard → Settings → Basic → App secret → Show>
```

`META_APP_SECRET` is what lets the server prove an incoming webhook really came
from Meta. Without it the endpoint accepts anything posted to it.

### Connect the webhook

15. App dashboard → **WhatsApp → Configuration → Webhook → Edit**.
16. **Callback URL:**
    ```
    https://arteva-maison-backend-gy1x.onrender.com/api/meta/whatsapp
    ```
17. **Verify token:** exactly what you set as `WHATSAPP_VERIFY_TOKEN`.
18. **Verify and save** — this fails if the backend has not redeployed with the
    variable yet, so deploy first.
19. **Manage** → subscribe to **messages** and **message_status**.

### Message templates

Outside a 24-hour window from a customer's own message, Meta only allows
pre-approved templates. Order notifications are exactly that case.

20. **https://business.facebook.com/wa/manage/message-templates/**
21. **Create template** → category **Utility** (not Marketing — Utility is
    approved faster and costs less) → language English, then add Arabic.
22. Create one per notification the site sends: order confirmed, order packed,
    out for delivery, delivered.
23. Approval usually takes minutes to a few hours.

> Tell me the template names once approved — the current service sends free-form
> text, which only works inside the 24-hour window. Wiring it to named templates
> is a small change, but it needs the exact names and variable order.

---

## 4. Taking the app live

1. App dashboard → toggle **App Mode** from Development to **Live**.
2. This requires a **Privacy Policy URL** and a **Data Deletion** URL or
   instructions. Meta will not let the app go live without them, and in
   Development mode only accounts listed as app testers can use it.

> Sign in with Facebook was removed from the site. There is no
> `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` to set, and nothing to configure
> under **Add product → Facebook Login**. If those variables are still set on
> Render or Vercel from the earlier setup, they are unused and can be deleted.

---

## Checking your work

With the backend deployed, as an admin:

```
GET https://arteva-maison-backend-gy1x.onrender.com/api/meta/status
```

It reports which of the integrations are configured, how many products the
catalogue feed will publish, and whether webhook signature checking is active.

For email delivery there is a **Check email delivery** button in
**Admin → Marketing** — unrelated to Meta, but it is the other thing currently
failing silently.

---

## What I could not do for you

Every step above needs a login to your client's Meta Business account. I have
no way to sign in as them, and it would not be right to: connecting these
integrations grants Meta access to customer data and commits the business to
Meta's terms. That is the client's decision to make and their account to make
it from.

Send me the values when you have them, or paste any error Meta shows and I will
work out what it means.
