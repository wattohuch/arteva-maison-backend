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

### Option A — over the API (no dashboard needed)

Templates can be filed without a browser signed into Business Manager. Two
admin endpoints do it:

```bash
# See what would be submitted, without submitting anything
curl -X POST https://<your-api>/api/whatsapp/templates/provision \
  -H "Authorization: Bearer <admin JWT>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# File them for review
curl -X POST https://<your-api>/api/whatsapp/templates/provision \
  -H "Authorization: Bearer <admin JWT>" \
  -H "Content-Type: application/json" -d '{}'
```

This submits all seven templates in English and Arabic. It is idempotent:
anything already on the account is skipped, so re-running after a partial
failure files only what is missing rather than queueing duplicates for review.

Optional body fields: `languages` (default `["en","ar"]`), `only` (restrict to
named env vars), `dryRun`.

The access token needs the **`whatsapp_business_management`** permission —
`whatsapp_business_messaging` alone can send but cannot manage templates.

Then watch for approval, which usually takes minutes:

```bash
curl https://<your-api>/api/whatsapp/templates -H "Authorization: Bearer <admin JWT>"
```

That reports each template's status *and* checks its placeholder count against
what the code actually sends. The check matters: a template approved with three
variables that the code sends four to is rejected with `132000` on every send,
and the only symptom is a customer saying their confirmation never arrived.

#### Or from an environment variable, with no API call at all

Set these on the host and restart. The server files the templates during
start-up and prints the outcome to the log:

```env
WHATSAPP_PROVISION_TEMPLATES=true
WHATSAPP_PROVISION_DRY_RUN=true   # optional: report only, submit nothing
```

Useful when the person who can reach Meta and the person holding an admin
session are not at the same machine. It is idempotent, so a restart never
files a second copy, and it never blocks the boot — if Meta is unreachable the
shop still starts and the failure is logged. Remove the flag once the log says
there is nothing left to file.

Watch for lines tagged `[WA-TPL]`.
#### From the admin dashboard, without a terminal

Sign in to the admin dashboard as an owner or admin, open the browser console
(F12) and paste:

```js
await (async () => {
  const base = location.hostname === 'localhost'
    ? 'http://localhost:5000/api'
    : 'https://arteva-maison-backend-gy1x.onrender.com/api';
  const r = await fetch(base + '/whatsapp/templates/provision', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + localStorage.getItem('arteva_token'),
    },
    body: JSON.stringify({ dryRun: true }),   // set false to actually submit
  });
  console.table((await r.json()).data.created);
})();
```

It reuses the session already in the browser, so no token has to be copied
anywhere. Change `dryRun` to `false` once the listing looks right.

### Option B — by hand in the dashboard

1. <https://business.facebook.com/wa/manage/message-templates/>
2. **Create template** → category **Utility** (not Marketing — Utility is
   approved faster and costs less)
3. Suggested body for order confirmation:

   ```
   Hello {{1}}, your ARTÉVA order {{2}} is confirmed. Total {{3}}. Track it here: {{4}}
   ```

### Setting the variables

Once approved, name each template in `.env`. The name is the same across
languages; the language is its own variable:

```env
WHATSAPP_TEMPLATE_CUSTOMER_NEW_ORDER=arteva_order_confirmed
WHATSAPP_TEMPLATE_CUSTOMER_NEW_ORDER_LANG=en
```

With nothing configured the system keeps sending free-form text, which works
inside the 24-hour window and fails outside it. Configuring a template is what
makes proactive notification reliable.

| Env var | Template filed as | Variables |
|---|---|---|
| `WHATSAPP_TEMPLATE_CUSTOMER_NEW_ORDER` | `arteva_order_confirmed` | name, order no., total, tracking URL |
| `WHATSAPP_TEMPLATE_STATUS_UPDATE` | `arteva_order_status` | name, order no., status, tracking URL |
| `WHATSAPP_TEMPLATE_DELIVERY_PROOF` | `arteva_order_delivered` | name, order no., proof URL |
| `WHATSAPP_TEMPLATE_OWNER_NEW_ORDER` | `arteva_owner_new_order` | order no., customer, total, item count |
| `WHATSAPP_TEMPLATE_INBOUND_FORWARD` | `arteva_customer_message` | customer phone, message |
| `WHATSAPP_TEMPLATE_WELCOME` | `arteva_welcome` | name |
| `WHATSAPP_TEMPLATE_REFUND_RETURN` | `arteva_return_received` | name, order no. |

Each also takes a `_LANG` suffix, falling back to `WHATSAPP_TEMPLATE_LANG`,
then `en`.

---

## Handing a conversation to a person

When the assistant cannot help, it escalates: every owner phone gets an
alert with the customer's number, what they asked, what the assistant
answered, and the order and driver if a number was quoted. The assistant
then stays out of that conversation so it cannot talk over whoever picks
it up.

### Replying

Reply to the alert on WhatsApp and it goes straight to the customer. The
reply gesture is what identifies them — it matters when two people need
help at once, where "the most recent escalation" would send one customer
the other's answer.

On desktop, where people rarely use reply, put the number first instead:

```
96599887766 It ships tomorrow, sorry for the wait.
```

Either way the owner gets a receipt saying it landed, so a relayed reply
is never confused with one that vanished.

### Ending or extending the handover

Two owner-only commands, sent the same way — reply to the alert, or put the
customer's number first:

| Command | Effect |
|---|---|
| `/end` | The assistant answers this customer again from now on |
| `/hold` | The assistant stays out, and the clock restarts |

Neither is forwarded to the customer, and neither announces anything to
them. To say goodbye, send that message first and then `/end`.

Without them the handover ends one way only: `WHATSAPP_ESCALATION_COOLDOWN_HOURS`
(default 2) of silence. That is wrong in both directions — a finished
conversation keeps the assistant out for the rest of the window, and one
still being worked on gets the bot back the moment it goes quiet for long
enough.

`/hold` also works on a conversation that was never escalated, which is how
you claim one before the assistant says something you would rather it did
not.

Only owner numbers have these — `WHATSAPP_OWNER_PHONE`, or the owner
accounts. A customer typing `/end` is treated as ordinary text. A sentence
that merely contains the word ("we will /end that line soon") is relayed
normally; only a message that is exactly the command is executed.

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
