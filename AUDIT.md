# Backend Audit — 26 July 2026

Audit of `arteva-maison-backend`: ~17,000 lines, ~100 files, 21 route modules,
23 controllers, 17 services, 20 models.

This document records what was examined, what was changed, and — importantly —
what was **not** changed and why. Read the "Not done" section before planning
follow-up work.

---

## Summary

The backend was in better shape than a first glance suggests. A previous pass had
already installed most of the "industry-standard" layer this audit was asked to
introduce: a central error handler with stable machine-readable codes, an
`ApiError` class, `helmet`, `compression`, tiered rate limiting, CORS
allow-listing, request-id correlation, NoSQL-injection sanitising, and an
`asyncHandler` wrapper used consistently across controllers. Database indexes are
well covered — Order, Product, PromoVisit, ProductView and SiteVisit all carry
appropriate compound indexes, and no N+1 loops were found in the hot paths.

The real problems were narrower and more serious than "architecture": **three
authorisation/authentication holes, one of them a working payment-fraud vector**,
and a validation layer that was declared as a dependency, referenced in a comment,
and did not exist.

Test coverage went from 47 to 59 assertions; all pass.

---

## Critical findings (fixed)

### 1. Forged webhook could mark any order paid — `paymentControllerDeema.js`

**Severity: critical. Unauthenticated payment fraud.**

`POST /api/payments/deema/webhook` is unauthenticated, as a provider webhook must
be. It took the payment status directly from the request body:

```js
let paymentStatus = (data.status || '').toUpperCase();
if (chargeId && !paymentStatus) { /* only NOW ask the provider */ }
```

The authoritative lookup ran only when the body **omitted** a status. So this
request marked an order paid:

```json
{ "merchant_order_id": "<order number>", "status": "CAPTURED" }
```

…which decremented stock, printed a receipt, sent customer and owner
confirmations, and confirmed the order — with no money taken. Order numbers are
not secret: they appear in tracking links and on printed receipts.

The mirror case was equally exploitable — `"status": "CANCELLED"` on someone
else's order cancelled it.

**Fix:** status is now read only from `deemaService.getChargeStatus(chargeId)`.
The request body is treated as a hint about *which* charge to ask about, nothing
more. If the provider cannot be reached, the webhook makes no decision at all and
returns 200 — the callback path and `/deema/reconcile` both re-check later, so
declining to act loses nothing. A body that disagrees with the provider is logged.

For contrast, the MyFatoorah webhook was already correct: it reads only
`Data.PaymentId` and re-queries the provider. No change needed there.

### 2. Any signed-in customer could mark orders delivered and COD-paid

**Severity: high. Goods without payment.**

`PUT /api/delivery/status/:orderId` carried `protect` but no role check. Any
authenticated customer could set **any** order to `delivered`, and the handler
marks COD orders `paid` on delivery. A shopper could place a cash-on-delivery
order and immediately mark it paid and delivered.

**Fix:** now `protect, driver` (driver/admin/owner/superuser), plus enum
validation on the status.

### 3. Anyone at all could write GPS coordinates to any order

**Severity: medium.**

`PUT /api/delivery/location/:orderId` had **no middleware whatsoever** — the route
comment said `// Location update (delivery pilot - could add specific auth)`. An
anonymous caller could write arbitrary coordinates onto any order and have them
broadcast to the customer's live tracking page over the socket.

**Fix:** now `protect, driver`, with bounded lat/lng validation.

Note: nothing calls either endpoint — not the React app, not the legacy
`assets/js` bundle, not the Pi agents. The driver app uses
`/api/driver/orders/:id/status`. They are **dead as well as insecure**; they were
secured rather than deleted because deleting endpoints is a breaking change and
that is the owner's call. See "Recommended next steps".

---

## Validation layer (built)

`express-validator` was in `package.json`, `server.js` claimed *"Additional
validation is done via express-validator in routes"*, and **not one file imported
it**. Every endpoint took `req.body` on trust and relied on Mongoose to reject bad
input at save time. That fails in three ways: type coercion silently accepts wrong
types, anything not persisted is never checked, and errors surface inconsistently.

Added:

- `src/middleware/validate.js` — runs validator chains and raises failures as
  `ApiError(400, 'VALIDATION_ERROR', …)` so the existing central handler formats
  them. Response shape is unchanged: `{ success, code, message, details, requestId }`,
  with `details` as `{field, message}` pairs — the same shape the Mongoose branch
  already emitted, so clients parse one thing, not two.
- `src/validators/authValidators.js`
- `src/validators/cartValidators.js`
- `src/validators/deliveryValidators.js`
- `src/validators/commonValidators.js` (Mongo id params, pagination)

Applied to `auth`, `cart`, `orders` and `delivery` routes.

Two real bugs this closed:

- **Cart quantity was untyped.** `cart.items[i].quantity += quantity` with a
  string `"3"` concatenates (`1 += "3"` → `"13"`, which Mongoose then casts to 13
  units). A negative quantity passed the stock check outright, because
  `product.stock < -5` is always false. Now constrained to a positive integer.
- **`if (!lat || !lng)`** rejected a legitimate coordinate of `0` and accepted any
  non-zero value including strings and objects. Now bounded floats.

Deliberately **not** used: `normalizeEmail()`, which rewrites addresses (stripping
dots and `+tags`) and would stop existing accounts matching their stored email.
Passwords are never trimmed — a leading space is a valid password character.

---

## Unbounded pagination (fixed)

`paginate()` passed `limit` straight from the query string to Mongo with no
ceiling, so `?limit=1000000000` asked for the entire collection in one response —
reachable unauthenticated on `/api/products`. Negative input produced a negative
`skip`, which Mongo rejects outright.

Now clamped to `MAX_PAGE_SIZE = 10000` inside `paginate()`, with matching
validation on the routes.

The ceiling is deliberately *not* a tidy 100: the admin visitor log requests
`limit=1000` and the legacy admin bundle requests `limit=10000`. Those are real
working screens and capping below them would break them. This is a guard against
absurd values, not a sensible page size — see debt below.

---

## Dead code and dependencies (removed)

| Removed | Reason |
|---|---|
| `src/controllers/paymentController.stripe.backup.js` (264 lines) | Stripe was replaced by MyFatoorah/Deema. Zero referrers. |
| `src/services/emailServiceBrevo.js` | Zero referrers — `emailService.js` is the only one used. |
| `src/services/emailService-resend.js` | Zero referrers. |
| dep `express-mongo-sanitize` | Zero imports. Replaced by `middleware/sanitize.js` because it mutates `req.query`, which Express 5 makes read-only. |
| dep `pino` | Zero imports. |
| dep `qrcode-terminal` | Zero imports. |

`mongodb-memory-server` was moved from `dependencies` to `devDependencies` — it is
test-only, and as a production dependency it ships a MongoDB **binary downloader**
into the deployed image.

Also corrected the false comment in `server.js` claiming validation existed.

---

## Reviewed and found sound (no change)

- **Error handling** — `middleware/error.js` normalises CastError, duplicate key,
  Mongoose validation, JWT and Axios failures into typed codes; suppresses internals
  on unexpected 500s in production; logs stacks only for genuine faults.
- **MyFatoorah webhook** — re-queries the provider rather than trusting the body.
- **Print/WhatsApp agent endpoints** — shared-key auth compared with
  `crypto.timingSafeEqual`, with a loud boot warning when the default key is in use.
- **Password hashing** — bcrypt, cost 10, `select: false` on the field.
- **Revenue access** — owner-only role gate plus a scoped, short-lived unlock token.
- **Indexes** — compound indexes present on every hot query path.
- **`paginate`/`buildSortQuery`** — sort is an allow-list map, so no injection via `sortBy`.
- **Stock movements** — `stockService` reconciles against `stockHeld`, making edits
  and refunds idempotent. Genuinely good code; left alone.

---

## Not done — read this before planning follow-up

The brief asked to restandardise every endpoint onto
`Route → Middleware → Validation → Controller → Service → Repository`, with no
business logic in controllers. **That was not attempted, and the codebase does not
currently follow it.**

`adminController.js` alone is 1,888 lines and mixes HTTP handling, business rules,
stock movement, WhatsApp/email dispatch, print queueing and aggregation pipelines.
`paymentControllerMyFatoorah.js` is 996 lines in the same style — the webhook
handler quoted above is a single ~120-line function that also auto-saves customer
addresses.

Rewriting those into a layered architecture means touching every payment, order
and admin flow. The brief also said, in bold, do not change business logic, do not
alter payment or order flows, and introduce no breaking changes. With 59 smoke
assertions as the only safety net — no unit tests around the payment controllers
at all — a refactor of that size would be a large uncontrolled change to the parts
of the system that move money.

I judged the security fixes and the validation layer to be worth far more per unit
of risk. A layered rewrite is viable but should be done **one controller at a
time, behind tests written first**, and it is a project rather than a task.

Also not addressed:

- **36 ad-hoc scripts in the repo root** (`fix-passwords.js`, `make-admin.js`,
  `mock_order.js`, `simulate-order.js`, `decode-token.js`, …). Several connect to
  production and mutate data. They are undocumented and unreferenced by the app.
  Not deleted because some are plainly operational tools you may rely on. They
  should move to `scripts/` with a README, and anything obsolete deleted.
- **Password-reset OTPs are stored in plaintext** (`resetPasswordOTP`) and compared
  with `!==`. The 10-minute expiry and 30-req/15-min auth rate limit make brute
  force impractical, so this is hardening rather than an open hole — but the OTP
  should be hashed, and verification attempts should be counted and capped.
- **Validation coverage is partial.** `auth`, `cart`, `orders` and `delivery` are
  covered. `products`, `categories`, `hero`, `images`, `promoCodes`, `payments`,
  `driver` and the admin router are not.
- **Admin screens fetch everything in one request** (`limit=10000`). They need real
  pagination; the clamp is a guard, not a fix.
- **`assets/js` legacy admin bundle** still calls this API alongside the React app.
  Two clients against one API doubles the compatibility surface of any change.
- **No structured logging.** `console.log` throughout, with emoji. Fine at this
  scale, but there is no request-scoped logger and no log levels in production
  beyond the error handler's own lines.
- **No automated tests for payment controllers.** The highest-risk code in the
  repo has the least coverage. This is the gap I would close first.

---

## Recommended next steps, in priority order

1. **Delete or keep `/api/delivery/status` and `/api/delivery/location`.** They are
   now secured but unused. Removing them shrinks the attack surface; your call.
2. **Write tests around the payment controllers**, then refactor them. Not before.
3. **Hash the reset OTP** and cap verification attempts.
4. **Extend validation** to the remaining routers, starting with `payments` and the
   admin router.
5. **Move the root scripts** into `scripts/` with a README; delete the obsolete ones.
6. **Retire the legacy `assets/js` admin** once the React admin covers it fully.

---

## Verification

```
npm test   →  59 passed, 0 failed
```

Covering, new in this pass: unauthenticated and customer access to both delivery
endpoints, that a customer cannot mark a COD order paid, admin access still works,
`VALIDATION_ERROR` shape and field naming, negative cart quantity, malformed
Mongo id, bad status enum, and the pagination ceiling.
