# Raspberry Pi deployment

Running the ARTÉVA backend, including the WhatsApp Cloud API integration, on a
Raspberry Pi that survives reboots, crashes and flaky home broadband.

> **Note on the existing Pi.** This repository already contains
> `raspi-print-station/`, which is a *different program*: a receipt printer
> agent using Baileys. That is unrelated to the Cloud API and has its own
> `package.json` and README. This document is about running the main backend.

---

## Hardware

| | Minimum | Comfortable |
|---|---|---|
| Model | Pi 4, 2GB | Pi 4/5, 4GB |
| Storage | 16GB A1 microSD | 32GB+ SSD over USB3 |
| Network | Wi-Fi | Wired ethernet |

An SSD matters more than RAM. MongoDB on a microSD card is the usual cause of a
Pi deployment that feels fine for a month and then crawls — SD cards wear out
under write-heavy loads, and a database is exactly that.

Node's default heap is generous relative to a 2GB Pi. Cap it (see the systemd
unit below) so the kernel's OOM killer never has to choose between your
application and your database.

---

## Install

```bash
# Node 20+ — required. The project's own engines field enforces it.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

node --version      # must be >= 20

# MongoDB. On 64-bit Raspberry Pi OS, use the official ARM64 packages.
# On 32-bit, MongoDB will not run — use MongoDB Atlas instead and set
# MONGODB_URI to the cloud connection string.
uname -m            # aarch64 = 64-bit, armv7l = 32-bit
```

Then:

```bash
sudo useradd -r -m -s /bin/bash arteva
sudo -u arteva -i

git clone https://github.com/wattohuch/arteva-maison-backend.git ~/arteva
cd ~/arteva
npm ci --omit=dev

cp .env.example .env
nano .env          # fill in the values — see docs/WHATSAPP_SETUP.md
chmod 600 .env     # the file holds tokens; do not leave it world-readable
```

Verify before making it a service:

```bash
npm start
```

The boot log states plainly whether WhatsApp is configured. Stop with Ctrl-C.

### A note on `canvas`

`canvas` compiles native code and is the slowest part of `npm ci` on a Pi —
expect several minutes, and install its build dependencies first:

```bash
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev \
  libjpeg-dev libgif-dev librsvg2-dev
```

It is used by the receipt renderer. If you are not printing receipts from this
machine, it is still required at install time because the dependency is
unconditional.

---

## Run as a service

`/etc/systemd/system/arteva-backend.service`:

```ini
[Unit]
Description=ARTEVA Maison backend
Documentation=https://github.com/wattohuch/arteva-maison-backend
# Wait for the network to be genuinely routable, not merely configured.
After=network-online.target mongod.service
Wants=network-online.target

[Service]
Type=simple
User=arteva
WorkingDirectory=/home/arteva/arteva
EnvironmentFile=/home/arteva/arteva/.env
Environment=NODE_ENV=production
# Cap the heap so the OOM killer never has to choose between us and MongoDB.
Environment=NODE_OPTIONS=--max-old-space-size=512
ExecStart=/usr/bin/node src/server.js

# Restart on crash AND on a clean-but-unexpected exit.
Restart=always
RestartSec=10
# If it fails 5 times in 5 minutes, stop trying — something is genuinely
# broken and a restart loop only makes the logs harder to read.
StartLimitBurst=5
StartLimitIntervalSec=300

StandardOutput=journal
StandardError=journal
SyslogIdentifier=arteva

# Hardening. The process needs its own directory and the network; nothing else.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/arteva/arteva/backups /home/arteva/arteva/logs
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now arteva-backend
sudo systemctl status arteva-backend
journalctl -u arteva-backend -f
```

`enable` is what makes it survive a reboot. `Restart=always` is what makes it
survive a crash. Test both — a deployment that has never actually been rebooted
is a deployment you do not know works:

```bash
sudo systemctl restart arteva-backend    # crash recovery
sudo reboot                              # the real test
```

After the reboot, `curl localhost:5000/api/whatsapp/health` should answer
without anyone logging in.

### Network flapping

Home broadband drops. systemd restarts the process on crash, but a process
that stays up while its database connection is dead is worse — it accepts
requests and fails them. Mongoose reconnects on its own, and the health
endpoint reports `database: disconnected` while it is down, so point your
uptime monitor at `/api/whatsapp/health` rather than at the TCP port.

---

## Exposing the webhook

Meta requires a **publicly reachable HTTPS URL with a valid certificate**.
`localhost` will not work, self-signed will not work, and plain HTTP will not
work. A Pi on home broadband is behind NAT, so it needs something in front.

```
Internet
   ↓  HTTPS, valid certificate
Reverse proxy / tunnel
   ↓  HTTP over the local network or a tunnel
Raspberry Pi :5000
   ↓
Application
   ↓  HTTPS
WhatsApp Cloud API
```

Pick one:

### Cloudflare Tunnel — recommended for a home connection

No port forwarding, no static IP, no certificate management, survives a
changing IP address.

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

cloudflared tunnel login
cloudflared tunnel create arteva
cloudflared tunnel route dns arteva api.your-domain.com
```

`/home/arteva/.cloudflared/config.yml`:

```yaml
tunnel: arteva
credentials-file: /home/arteva/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: api.your-domain.com
    service: http://localhost:5000
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Webhook URL: `https://api.your-domain.com/api/meta/whatsapp`

### Caddy — if you have a static IP and can forward ports

Forward 80 and 443 to the Pi, then:

```
api.your-domain.com {
    reverse_proxy localhost:5000
}
```

Caddy obtains and renews the certificate automatically.

### Not suitable for production

`ngrok` free tier and similar give a URL that changes on restart. Meta would
need reconfiguring every time the Pi reboots, and inbound messages are lost in
between. Fine for a first test, not for a shop.

---

## Resource notes

The WhatsApp integration was written with a small machine in mind:

- **Media is not stored on the Pi.** Inbound images and documents are streamed
  to Cloudinary and only a URL is kept locally. Nothing accumulates on the SD
  card.
- **Media is size-capped at 16MB**, checked before the download starts and
  again against the delivered bytes.
- **The webhook answers before it works.** Meta gets its 200 immediately and
  processing happens after, so a slow Pi never causes Meta to retry.
- **Message and webhook-event records expire automatically** — 180 days and 30
  days respectively, via MongoDB TTL indexes. The collections do not grow
  without bound.
- **Retries are bounded and backed off**, so a network outage produces three
  spaced attempts rather than a hot loop.

Watch it with:

```bash
systemctl status arteva-backend      # memory in use
journalctl -u arteva-backend --since "1 hour ago" | grep WA-
vcgencmd measure_temp                # thermal throttling shows up as slowness
df -h                                # a full SD card looks like random failures
```

---

## Backups

`autoBackup.js` writes to `backups/` daily at 04:00. On a Pi that is the same
SD card as the database, which means a card failure loses both. Copy them off:

```bash
# crontab -e, as the arteva user
30 4 * * * rsync -a ~/arteva/backups/ user@nas:/backups/arteva/
```

---

## Updating

```bash
sudo -u arteva -i
cd ~/arteva
git pull
npm ci --omit=dev
npm test
sudo systemctl restart arteva-backend
```

Run the tests before restarting. They need no credentials and no network, and
they will catch a broken deploy before your customers do.
