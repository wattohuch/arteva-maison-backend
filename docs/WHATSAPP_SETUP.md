# WhatsApp Cloud API — setup

Everything on the code side is built. What remains is creating the Meta
credentials and pasting them into `.env`.

**Read this first:** a phone number can be on the WhatsApp Cloud API *or* on
the WhatsApp / WhatsApp Business phone app — never both. Registering a number
to the Cloud API permanently deletes its WhatsApp account, its chat history and
its groups, and that number can never use the phone app again. Decide which
number before you start. See [Choosing a number](#choosing-a-number).

---

## Quick reference

| | |
|---|---|
| Webhook URL | `https://your-domain.com/api/meta/whatsapp` |
| Health check | `GET /api/whatsapp/health` |
| Retired URL | `/api/whatsapp/webhook` — returns 410, do not use |

```
Clone → npm install → fill .env → npm start → set the webhook in Meta → working
```

---

## Choosing a number

| | Use a second number | Move your existing number |
|---|---|---|
| Chat history | kept | **permanently deleted** |
| Phone app on that number | keeps working | **never again** |
| Staff replying from a phone | unchanged | must move to Business Suite inbox |
| Customers see | your business name | your business name |

Both show customers the **display name** you register ("ARTÉVA Maison"), not
the digits — so a second number costs nothing in how it looks, and keeps your
support line intact. That is the recommended path.

---

## 1. Create the app

1. <https://developers.facebook.com/apps/> → **Create app**
2. Use case: **Other** → type: **Business** → link it to your Business account
3. In the app: **Add product → WhatsApp → Set up**

## 2. Get the credentials

### Phone number ID

**WhatsApp → API Setup.** Copy the **Phone number ID** — a long number, *not*
the phone number itself. This is `WHATSAPP_PHONE_NUMBER_ID`.

The same page shows a **temporary access token** that expires in 24 hours. It
is fine for a first test and useless for production. Get a permanent one:

### Permanent access token

1. <https://business.facebook.com/settings/system-users>
2. **Add** → name it `ARTEVA API` → role **Admin** → **Create**
3. **Assign assets** → **Apps** → your app → **Full control**
4. **Generate new token** → select the app → tick
   **`whatsapp_business_messaging`** and **`whatsapp_business_management`** →
   expiry **Never** → **Generate**
5. Copy it now — Meta shows it once

This is `WHATSAPP_ACCESS_TOKEN`. A system-user token is not tied to anyone's
personal login, so it survives someone leaving the company or changing their
password.

### App secret

**App dashboard → Settings → Basic → App secret → Show.**
This is `WHATSAPP_APP_SECRET`.

It is what proves an inbound webhook genuinely came from Meta. **Without it the
webhook refuses every request in production.** That is deliberate: the endpoint
is public, the signature is its only authentication, and without a secret
anyone who learned the URL could forge customer messages and make your number
reply to strangers.

### Verify token

Invent any random string — `openssl rand -hex 16` is fine. You will type the
same value into the Meta dashboard in step 4. This is `WHATSAPP_VERIFY_TOKEN`.

### Business account ID

**WhatsApp → API Setup → WhatsApp Business Account ID.** Optional for sending;
needed for template management APIs. This is `WHATSAPP_BUSINESS_ACCOUNT_ID`.

## 3. Register the number

**WhatsApp → API Setup → Add phone number.**

The number must not currently be on WhatsApp. If it is, delete that WhatsApp
account first and wait ~20 minutes.

Set the **display name** to your business name. Meta reviews it, usually within
hours. Once approved, customers see the name rather than the digits — this is
what "big companies" have.

## 4. Configure `.env`

Copy `.env.example` to `.env` and fill in:

```env
WHATSAPP_ACCESS_TOKEN=EAAxxxxx...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=<the random string you invented>
WHATSAPP_APP_SECRET=<from Settings → Basic>
PUBLIC_WEBHOOK_URL=https://your-domain.com/api/meta/whatsapp
WHATSAPP_OWNER_PHONE=96500000000,96500000001
```

Start the server. It prints exactly what is missing:

```
✅ WhatsApp Cloud API: configuration complete
```

or

```
⚠️  WhatsApp configuration incomplete:
     WHATSAPP_APP_SECRET is missing — App dashboard > Settings > Basic > App secret
```

Confirm with the health endpoint:

```bash
curl https://your-domain.com/api/whatsapp/health
```

```json
{ "status": "healthy", "whatsapp": "configured", "database": "connected", "missing": [] }
```

Add `?probe=1` to also make a live call to Meta and confirm the token works.
It costs a round trip, so leave it off for uptime monitors.

## 5. Connect the webhook

**Deploy first** — verification fails if the server does not yet have
`WHATSAPP_VERIFY_TOKEN`.

1. App dashboard → **WhatsApp → Configuration → Webhook → Edit**
2. **Callback URL:** `https://your-domain.com/api/meta/whatsapp`
3. **Verify token:** exactly what you set as `WHATSAPP_VERIFY_TOKEN`
4. **Verify and save**
5. **Manage** → subscribe to **`messages`** and **`message_status`**

Meta requires HTTPS with a valid certificate. `localhost` will not work — see
[Raspberry Pi deployment](./RASPBERRY_PI_DEPLOYMENT.md#exposing-the-webhook).

## 6. Message templates

Free-form text only reaches a customer **within 24 hours of their own last
message**. Every order notification falls outside that window, so it needs an
approved template. Without one, Meta rejects the send with code `131047` —
the server records it as failed and logs the reason.

1. <https://business.facebook.com/wa/manage/message-templates/>
2. **Create template** → category **Utility** (not Marketing — Utility is
   approved faster and costs less)
3. Suggested body for order confirmation:

   ```
   Hello {{1}}, your ARTÉVA order {{2}} is confirmed. Total {{3}}. Track it here: {{4}}
   ```

4. Once approved, name it in `.env`:

   ```env
   WHATSAPP_TEMPLATE_CUSTOMER_NEW_ORDER=order_confirmed
   WHATSAPP_TEMPLATE_CUSTOMER_NEW_ORDER_LANG=en
   ```

With nothing configured the system keeps sending free-form text, which works
inside the 24-hour window and fails outside it. Configuring a template is what
makes proactive notification reliable.

Supported keys: `WHATSAPP_TEMPLATE_CUSTOMER_NEW_ORDER`,
`WHATSAPP_TEMPLATE_STATUS_UPDATE`, `WHATSAPP_TEMPLATE_DELIVERY_PROOF`,
`WHATSAPP_TEMPLATE_OWNER_NEW_ORDER`, `WHATSAPP_TEMPLATE_INBOUND_FORWARD`.

---

## Testing

### Sending

```bash
TOKEN=<an admin JWT>

curl -X POST https://your-domain.com/api/whatsapp/messages/text \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"to":"96599887766","text":"Test from ARTEVA"}'
```

Expect `{"success":true,"data":{"messageId":"wamid...."}}`.

Note: the recipient must have messaged you in the last 24 hours, or be on your
test-number allow list, or you must use a template.

### Receiving

Message your WhatsApp business number from a personal phone, then:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://your-domain.com/api/whatsapp/conversations
```

The conversation appears with your message. Fetch it:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://your-domain.com/api/whatsapp/conversations/96599887766
```

### Automated tests

```bash
npm run test:whatsapp
```

64 assertions covering webhook verification and signatures, duplicate
protection, status ordering, retry classification, payload shape for every
message type, and that no secret appears in any diagnostic output. Meta is
stubbed, so no network or credentials are needed.

---

## API reference

All routes require an admin session except `/health`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/whatsapp/health` | Configuration and connectivity (public) |
| `POST` | `/api/whatsapp/messages/text` | Free-form text |
| `POST` | `/api/whatsapp/messages/template` | Approved template |
| `POST` | `/api/whatsapp/messages/media` | Image, document, audio, video, sticker |
| `POST` | `/api/whatsapp/messages/media/upload` | Upload a file, get a media id |
| `POST` | `/api/whatsapp/messages/location` | Location pin |
| `POST` | `/api/whatsapp/messages/interactive` | Reply buttons or list |
| `POST` | `/api/whatsapp/messages/:id/read` | Mark inbound read |
| `GET` | `/api/whatsapp/conversations` | Conversation list |
| `GET` | `/api/whatsapp/conversations/:waId` | One conversation |
| `GET` | `/api/whatsapp/messages/:id` | One message and its status |
| `GET` | `/api/meta/whatsapp` | Meta verification handshake |
| `POST` | `/api/meta/whatsapp` | Meta webhook (signature verified) |

Responses: `422` means Meta rejected it permanently — bad number, unapproved
template, outside the service window. `502` means Meta was unreachable and
retrying is reasonable.

---

## Troubleshooting

**Webhook verification fails in the Meta dashboard**
The server has not been deployed with `WHATSAPP_VERIFY_TOKEN`, or the value
does not match exactly. Check `curl "https://your-domain.com/api/meta/whatsapp?hub.mode=subscribe&hub.verify_token=YOURTOKEN&hub.challenge=test"`
returns `test`.

**Webhook returns 403**
`WHATSAPP_APP_SECRET` is not set and `NODE_ENV=production`. Failing closed is
intentional — see step 2.

**Webhook returns 401**
The signature did not match. The app secret in `.env` is not the one belonging
to the app sending the webhook.

**Webhook returns 410**
Meta is still pointed at the old `/api/whatsapp/webhook`. Change the Callback
URL to `/api/meta/whatsapp`.

**Messages report success but never arrive**
Almost always the 24-hour window. Check the stored message:
`GET /api/whatsapp/messages/<wamid>` — a `failed` status with `errorCode
131047` means you need an approved template.

**`131026` message undeliverable**
The number is not on WhatsApp, or cannot receive messages. Not retryable, and
the system correctly does not retry it.

**`190` invalid access token**
The token expired — you are using the 24-hour test token rather than a
permanent system-user token. See step 2.

**Duplicate replies to one customer message**
Should not happen; every event is claimed by id before processing. If it does,
check the `whatsappwebhookevents` collection is being written — a database
outage makes the system fall back to processing, preferring a duplicate
greeting over a lost message.

**Nothing in the logs at all**
Meta is not reaching the server. Check the webhook subscription includes the
`messages` field, and that the URL is publicly reachable over HTTPS with a
certificate that validates.
