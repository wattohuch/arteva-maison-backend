#!/bin/bash
# ── ARTÉVA MAISON Print Station v4 — Production Setup ────────
# Run on Raspberry Pi:  bash setup.sh
set -e

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║  ARTÉVA Print Station v4 — Setup     ║"
echo "  ║  Production-Hardened Edition         ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. System packages
echo "📦 Installing system packages..."
sudo apt update -qq
sudo apt install -y cups || true
sudo apt install -y chromium 2>/dev/null || sudo apt install -y chromium-browser 2>/dev/null || echo "⚠ Chromium not found — install manually"
sudo apt install -y printer-driver-hpcups 2>/dev/null || sudo apt install -y hplip 2>/dev/null || echo "⚠ HP drivers not found"
# Fonts are installed LOCALLY on purpose: receipts render with no network
# access (see templates.js), so whatever is needed has to be on this machine.
# Noto covers Arabic; the Latin faces below are the closest packaged matches to
# the website's Cormorant Garamond / Montserrat, and the template already
# declares serif/sans fallbacks if they are unavailable.
sudo apt install -y fonts-noto-core 2>/dev/null || sudo apt install -y fonts-noto 2>/dev/null || echo "⚠ Noto fonts not found — Arabic may not render correctly"
sudo apt install -y fonts-montserrat 2>/dev/null || true
sudo apt install -y fonts-ebgaramond 2>/dev/null || true
if fc-list 2>/dev/null | grep -qi "noto.*arabic"; then
    echo "  ✅ Arabic font present (Noto Sans Arabic) — receipts render offline"
else
    echo "  ⚠ No Arabic font detected! Arabic will print as boxes."
    echo "    Try: sudo apt install fonts-noto-core"
fi

# 2. Add user to lpadmin group
echo "👤 Adding $USER to printer group..."
sudo usermod -aG lpadmin "$USER"

# 3. Enable CUPS
echo "🖨️  Enabling CUPS..."
sudo systemctl enable cups
sudo systemctl start cups

# 4. Check for printer
echo ""
echo "📋 Available printers:"
lpstat -p 2>/dev/null || echo "  (none found — run: sudo hp-setup -i)"
echo ""

# 5. Install Node.js deps
echo "📦 Installing Node.js dependencies..."
cd "$SCRIPT_DIR"
npm install --production

# 6. Create directories
echo "📁 Creating directories..."
mkdir -p "$SCRIPT_DIR/queue/pending"
mkdir -p "$SCRIPT_DIR/queue/completed"
mkdir -p "$SCRIPT_DIR/queue/failed"
mkdir -p "$SCRIPT_DIR/logs"

# ═══════════════════════════════════════════════════
# 7. SWAP (prevents OOM kills on Pi with 1GB RAM)
# ═══════════════════════════════════════════════════
echo "💾 Configuring swap..."
SWAP_SIZE=512  # MB
if [ -f /swapfile ]; then
    CURRENT_SWAP=$(sudo swapon --show --noheadings --bytes | awk '{sum += $3} END {print int(sum/1048576)}')
    if [ "${CURRENT_SWAP:-0}" -lt "$SWAP_SIZE" ]; then
        echo "  Increasing swap to ${SWAP_SIZE}MB..."
        sudo swapoff -a 2>/dev/null || true
        sudo dd if=/dev/zero of=/swapfile bs=1M count=$SWAP_SIZE status=progress
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
    else
        echo "  Swap already ${CURRENT_SWAP}MB (sufficient)"
    fi
else
    echo "  Creating ${SWAP_SIZE}MB swap file..."
    sudo dd if=/dev/zero of=/swapfile bs=1M count=$SWAP_SIZE status=progress
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# Optimize swappiness for Pi (use swap only when needed)
echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/99-swap.conf
sudo sysctl vm.swappiness=10

# ═══════════════════════════════════════════════════
# 8. USB POWER MANAGEMENT (prevent printer disconnects)
# ═══════════════════════════════════════════════════
echo "🔌 Disabling USB power management..."
# Prevent USB autosuspend (causes printer mid-print disconnects)
#
# The path moved: Raspberry Pi OS Bookworm and later use
# /boot/firmware/cmdline.txt, older releases /boot/cmdline.txt. This script
# only knew the old one, so on a current Pi the grep failed, `sed -i` was
# handed a file that does not exist, and `set -e` aborted the whole setup part
# way through — after the services were written but before the watchdog and log
# rotation existed. Find the real file, and never let this step kill setup.
CMDLINE=""
for candidate in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
    if [ -f "$candidate" ]; then CMDLINE="$candidate"; break; fi
done

if [ -n "$CMDLINE" ]; then
    if grep -q "usbcore.autosuspend=-1" "$CMDLINE"; then
        echo "  Already set in $CMDLINE"
    elif sudo sed -i 's/$/ usbcore.autosuspend=-1/' "$CMDLINE"; then
        echo "  Added usbcore.autosuspend=-1 to $CMDLINE (takes effect after reboot)"
    else
        echo "  ⚠ Could not edit $CMDLINE — add 'usbcore.autosuspend=-1' by hand"
    fi
else
    echo "  ⚠ No cmdline.txt found (not a Raspberry Pi OS image?) — skipping"
fi
# Also set at runtime
echo -1 | sudo tee /sys/module/usbcore/parameters/autosuspend > /dev/null 2>&1 || true

# ═══════════════════════════════════════════════════
# 9. SYSTEMD SERVICE — Print Station
# ═══════════════════════════════════════════════════
echo "⚙️  Creating print station systemd service..."
sudo tee /etc/systemd/system/arteva-print.service > /dev/null << EOF
[Unit]
Description=ARTEVA Maison Print Station
After=network-online.target cups.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node --max-old-space-size=256 --expose-gc $SCRIPT_DIR/print-station.js
Restart=always
RestartSec=5
StartLimitIntervalSec=0
Environment=NODE_ENV=production
StandardOutput=append:$SCRIPT_DIR/logs/output.log
StandardError=append:$SCRIPT_DIR/logs/error.log
# Memory protection
MemoryMax=400M
MemoryHigh=300M
# OOM score (lower = less likely to be killed)
OOMScoreAdjust=-500

[Install]
WantedBy=multi-user.target
EOF

# ═══════════════════════════════════════════════════
# 10. SYSTEMD SERVICE — WhatsApp Agent
# ═══════════════════════════════════════════════════
echo "⚙️  Creating WhatsApp agent systemd service..."
sudo tee /etc/systemd/system/arteva-whatsapp.service > /dev/null << EOF
[Unit]
Description=ARTEVA Maison WhatsApp Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node --max-old-space-size=128 $SCRIPT_DIR/whatsapp-agent.js
# on-failure, not always: the agent exits 0 when WhatsApp has logged this
# device out, which no restart can fix — it needs a human to scan a QR code.
# Under Restart=always that turned into a crash loop every 5 seconds that
# buried the one log line explaining what was actually required. Crashes still
# exit non-zero and are still restarted.
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=0
Environment=NODE_ENV=production
StandardOutput=append:$SCRIPT_DIR/logs/wa-output.log
StandardError=append:$SCRIPT_DIR/logs/wa-error.log
MemoryMax=200M
MemoryHigh=150M

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable arteva-print.service
sudo systemctl enable arteva-whatsapp.service

# ═══════════════════════════════════════════════════
# 11. WATCHDOG (with memory check)
# ═══════════════════════════════════════════════════
echo "🐕 Installing watchdog..."
chmod +x "$SCRIPT_DIR/watchdog.sh"
chmod +x "$SCRIPT_DIR/wa-reset.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/doctor.sh" 2>/dev/null || true

# Installed into ROOT's crontab, not the calling user's.
#
# It used to go into the user crontab, where every corrective action it takes
# needs privileges it does not have: `systemctl restart arteva-print` prompts
# for authentication and fails, and `echo 3 > /proc/sys/vm/drop_caches` is
# permission-denied. The watchdog ran every minute for months and could never
# actually restart anything — the safety net was decorative. Root's crontab can
# do what the script is asking for.
(sudo crontab -l 2>/dev/null | grep -v "watchdog.sh" ; \
 echo "* * * * * $SCRIPT_DIR/watchdog.sh >> $SCRIPT_DIR/logs/watchdog.log 2>&1") | sudo crontab -

# Remove the old powerless entry from the user crontab if it is still there
if crontab -l 2>/dev/null | grep -q "watchdog.sh"; then
    echo "  Removing old (unprivileged) watchdog entry from $USER's crontab..."
    crontab -l 2>/dev/null | grep -v "watchdog.sh" | crontab - || true
fi
echo "  ✅ Watchdog installed in root's crontab (can actually restart services)"

# ═══════════════════════════════════════════════════
# 12. LOG ROTATION (prevent SD card from filling up)
# ═══════════════════════════════════════════════════
echo "📋 Setting up log rotation..."
sudo tee /etc/logrotate.d/arteva-print > /dev/null << EOF
$SCRIPT_DIR/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║  ✅ Production Setup Complete!       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Features installed:"
echo "  ✅ Auto-start on boot (both services)"
echo "  ✅ Auto-restart on crash (5s delay)"
echo "  ✅ Memory-limited (256MB print, 128MB WA)"
echo "  ✅ OOM protection (lower kill priority)"
echo "  ✅ 512MB swap file"
echo "  ✅ USB autosuspend disabled"
echo "  ✅ Persistent disk queue"
echo "  ✅ Watchdog heartbeat monitor"
echo "  ✅ Rotating log files (7 day retention)"
echo "  ✅ Print station health on :3100"
echo "  ✅ WhatsApp agent health on :3101"
echo ""
echo "  Next steps:"
echo "  1. Set up printer:  sudo hp-setup -i"
echo "  2. Edit config:     nano $SCRIPT_DIR/.env"
echo "  3. Test print:      npm run test-print"
echo "  4. Start print:     sudo systemctl start arteva-print"
echo "  5. Start WhatsApp:  sudo systemctl start arteva-whatsapp"
echo "  6. Check health:    curl http://localhost:3100/health"
echo "  7. Check WA health: curl http://localhost:3101/health"
echo "  8. View logs:       journalctl -u arteva-print -f"
echo "  9. View WA logs:    journalctl -u arteva-whatsapp -f"
echo ""
