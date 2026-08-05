# ARTÉVA MAISON — Raspberry Pi Print + WhatsApp Station v6

Print station and WhatsApp agent for Raspberry Pi.

---

## How much of this is automatic?

**Everything, once it is paired.** Day to day you do nothing:

| | |
|---|---|
| Pi reboots / power cut | Both services auto-start; queued receipts resume |
| A service crashes | systemd restarts it |
| Internet or WhatsApp drops | Reconnects on its own with backoff |
| A process wedges | Watchdog restarts it (every minute, from root's crontab) |
| Printer unplugged | Orders queue to disk, flush automatically when it returns |
| **Recipient can't decrypt a message** | **Automatically re-sent so they can read it** |
| Disk filling up | Old completed jobs and logs pruned automatically |

**Pairing is the one thing that needs a human, and it is one-time.** Scanning a
QR code is WhatsApp's security model — no API can bypass it. A pairing then
lasts indefinitely; it only ends if someone unlinks the device in WhatsApp, or
the business phone stays offline for ~14 days.

---

## ⚠️ "Waiting for this message" — now self-healing

If a message from the business number arrives as

> **في انتظار هذه الرسالة، قد يستغرق ذلك بعض الوقت**
> **"Waiting for this message. This may take a while."**

that is **not a delay**. It is WhatsApp on the *recipient's* phone saying it
**could not decrypt** what we sent.

WhatsApp is built to recover from this: the recipient's phone sends back a
*retry receipt* asking for the message again, and the sender re-sends it against
a fresh encryption session. Baileys does that for you — but only if you give it
a way to look the original message up, via `getMessage`.

**This agent never did.** Baileys' default is `getMessage: async () => undefined`
and its retry code re-sends only `if (msg)`, so every retry request was answered
with "nothing" and **recipients stayed stuck permanently** instead of recovering
seconds later. That is why the problem persisted for days rather than fixing
itself.

The agent now keeps the last `WA_SENT_STORE_MAX` (default 300) outgoing messages
and serves them on request, so undecryptable messages repair themselves with no
human involved. Watch it work:

```bash
npm run check-wa-health     # decryptRetries: recovered / unrecoverable
```

- `recovered > 0` — self-healing did its job.
- `unrecoverable > 0` — the original had aged out of the store; those stay
  unreadable. Raise `WA_SENT_STORE_MAX` if it keeps happening.
- both `0` — nothing has failed to decrypt.

### If the session itself is corrupted

Auto-retry cannot fix a session whose keys are broken beyond use. Then, once:

```bash
bash wa-reset.sh
```

It stops the service, sets the old session aside, walks you through one QR scan,
restarts, sends a test message, asks whether it arrived readable, and turns
customer greetings on for you if it did. **Delivered ≠ readable** — the sending
side genuinely cannot tell the difference, so that one check has to be done by
eye.

Until a test passes, the **customer auto-greeting stays OFF** (`WA_AUTO_GREET`),
because an unreadable message from the brand is worse than none.

### What corrupts a session

| Cause | Prevented by |
|---|---|
| Two agents sharing `auth_info_baileys` | Single-instance PID lock — a second agent refuses to start |
| Reconnect leaving the old socket alive | The old socket is ended and its listeners removed first |
| Sending before the session settles | `WA_WARMUP_MS` quiet window after connect |
| Copying `auth_info_baileys` between machines | Excluded from `deploy.sh` and `.gitignore` — never copy it |

**Never** run `node whatsapp-agent.js` by hand while the service is running, and
never copy the session folder anywhere.

### Want zero pairing, ever?

Meta's official **WhatsApp Cloud API** needs no QR, no Pi and no session — set
`WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` on the backend and
outbound messages go straight through Meta. The Pi agent is then only needed for
*incoming* customer messages (greeting and forwarding to owners). That is the
lowest-maintenance setup available.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Render Backend                  │
│  (MongoDB WhatsApp queue + Print poll API)   │
└───────────┬──────────────┬──────────────────┘
            │              │
     Poll /30s       Poll /10s
            │              │
┌───────────▼──────┐  ┌────▼──────────────────┐
│  print-station   │  │  whatsapp-agent       │
│  :3100/health    │  │  :3101/health          │
│  Chromium → PDF  │  │  Baileys (WhatsApp)    │
│  → CUPS → USB    │  │  Sends queued messages │
└──────────────────┘  └───────────────────────┘
```

The WhatsApp **queue** path only carries messages if the backend has
`WHATSAPP_PI_FALLBACK=true`. Otherwise the backend sends via Meta's Cloud API
and the Pi agent only handles incoming customer messages (greeting/forwarding).

---

## Setting up the Pi (no git required)

Run this **on the Pi**. It downloads just this folder from GitHub as a tarball —
`git` is never involved.

```bash
sudo apt update && sudo apt install -y curl nodejs npm

mkdir -p ~/print-station && cd ~/print-station
curl -fsSL https://codeload.github.com/wattohuch/arteva-maison-backend/tar.gz/refs/heads/main \
  | tar -xz --strip-components=2 arteva-maison-backend-main/raspi-print-station

bash setup.sh
```

Then finish the configuration:

```bash
cp .env.example .env
nano .env                    # ← set PRINT_KEY (required) and PRINTER_NAME
```

Set up the printer and confirm it prints:

```bash
sudo hp-setup -i             # or your printer's setup
lpstat -p -d                 # copy the queue name into PRINTER_NAME
npm run test-print           # a real receipt should come out
sudo systemctl start arteva-print
```

Pair WhatsApp (one time — have the business phone ready):

```bash
bash wa-reset.sh             # scans a QR, tests it, offers to enable greetings
```

Check everything:

```bash
npm run doctor
```

### Updating later

**From the Pi** — re-downloads this folder from GitHub and restarts:

```bash
cd ~/print-station && bash update.sh
```

**From your PC** — pushes your working copy over SSH, no GitHub round-trip:

```bash
bash deploy.sh pi@192.168.1.50
```

Both syntax-check every script before installing it, and both leave Pi-local
state alone:

`.env` · `auth_info_baileys/` · `queue/` · `logs/` · `greeted-state.json`

> Never copy `auth_info_baileys/` between machines. Two devices on one WhatsApp
> session corrupt its encryption keys, and every recipient then sees
> "Waiting for this message".

---

## Daily operations

```bash
npm run doctor            # full health check — start here when something is off
npm run check-health      # print station JSON
npm run check-wa-health   # WhatsApp agent JSON
npm run status            # both systemd units

npm run wa:test -- 9655XXXXXXX   # send a real message and verify it is READABLE
npm run wa:reset                 # re-pair WhatsApp after session corruption

npm run retry-failed      # move queue/failed/* back to pending
npm run stress-test       # 10 synthetic orders

journalctl -u arteva-print -f
journalctl -u arteva-whatsapp -f
```

`npm run doctor` checks Node, `.env`, whether `PRINT_KEY` is still the public
default, dependencies, the printer, the Arabic font, both services, whether the
watchdog can actually restart things, disk, queue depth, backend reachability,
and how many agent processes are running.

---

## Configuration

Every variable is documented in [`.env.example`](.env.example). The ones that
matter most:

| Variable | Default | Why it matters |
|---|---|---|
| `PRINT_KEY` | *public default* | **Change it.** With the default, anyone who has seen this repo can read customer names, phones and addresses from the poll endpoint. Must match `PRINT_AGENT_KEY` on the server. |
| `PRINTER_NAME` | auto-detect | CUPS queue name from `lpstat -p -d` |
| `WA_AUTO_GREET` | `false` | Customer-facing auto-reply. Leave off until `wa:test` passes. |
| `WA_FORWARD_TO_ADMIN` | `true` | Forward incoming customer messages to `ADMIN_PHONES` |
| `WA_WARMUP_MS` | `8000` | Quiet window after connect. Lowering it risks undecryptable messages. |
| `RECEIPT_WEB_FONTS` | `false` | Off = receipts print with no internet at all |
| `CHROMIUM_PATH` | auto-detect | Set if Chromium is somewhere unusual |
| `HEALTH_TOKEN` | *(none)* | Both health endpoints listen on `0.0.0.0`; set this to require a token |

---

## Reliability behaviour

- **Nothing is printed twice.** An order printed but not acknowledged to the API
  is recorded on disk, so a restart cannot reprint the customer's receipt.
- **Nothing is queued twice.** An order already in `pending/` or `failed/` is
  not re-queued on the next poll.
- **Receipts print with the internet down.** Rendering uses locally installed
  fonts and no external stylesheet.
- **A crash restarts the service.** An uncaught exception exits so systemd can
  restart it, instead of leaving a half-dead process with a live heartbeat.
- **A missing printer does not lose orders.** Jobs stay on disk and are flushed
  automatically when the printer reappears.
- **Power cuts are survivable.** Queue writes are `fsync` + atomic rename; a
  stale instance lock is reclaimed by PID liveness check.
- **The watchdog can act.** It runs from *root's* crontab, so its
  `systemctl restart` actually works.
- **The disk cannot silently fill.** Low space is logged, completed jobs are
  trimmed periodically, and the watchdog prunes when space runs short.

---

## Troubleshooting

### Nothing prints
```bash
npm run doctor
lpstat -p -d                      # printer known to CUPS?
curl localhost:3100/health        # pendingJobs climbing?
journalctl -u arteva-print -n 50
```
Jobs stay in `queue/pending/` while the printer is offline and flush on their
own when it returns.

### Arabic prints as boxes
```bash
sudo apt install fonts-noto-core && fc-cache -f
sudo systemctl restart arteva-print
```

### WhatsApp messages unreadable
See [the top of this file](#️-read-this-first-waiting-for-this-message).

### WhatsApp will not connect
```bash
npm run check-wa-health           # needsQrScan / connected / warmedUp
ls NEEDS_QR_SCAN 2>/dev/null && bash wa-reset.sh
pgrep -cf whatsapp-agent.js       # MUST be 1 — more than one corrupts the session
```

### Printer stops mid-print
Usually USB autosuspend. `setup.sh` disables it; confirm it applied:
```bash
grep usbcore /boot/firmware/cmdline.txt || grep usbcore /boot/cmdline.txt
```
(needs a reboot to take effect)

### Out of disk
```bash
df -h .
rm -f queue/completed/*.json
find logs -name '*.gz' -delete
```

### After a power cut
Both services auto-start and pending jobs resume. Verify with
`npm run doctor`.

---

© 2026 ARTÉVA Maison.
