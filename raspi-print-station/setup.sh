#!/bin/bash
# ── ARTÉVA MAISON Print Station v3 — Production Setup ────────
# Run on Raspberry Pi:  bash setup.sh
set -e

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║  ARTÉVA Print Station v3 — Setup     ║"
echo "  ║  Production-Grade Edition            ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# 1. System packages
echo "📦 Installing system packages..."
sudo apt update -qq
sudo apt install -y chromium-browser cups hplip

# 2. Add user to lpadmin group
echo "👤 Adding $USER to printer group..."
sudo usermod -aG lpadmin $USER

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
cd "$(dirname "$0")"
npm install --production

# 6. Create queue directories
echo "📁 Creating queue directories..."
SCRIPT_DIR="$(pwd)"
mkdir -p "$SCRIPT_DIR/queue/pending"
mkdir -p "$SCRIPT_DIR/queue/completed"
mkdir -p "$SCRIPT_DIR/queue/failed"
mkdir -p "$SCRIPT_DIR/logs"

# 7. Create production systemd service
echo "⚙️  Creating systemd service (production-grade)..."
sudo tee /etc/systemd/system/arteva-print.service > /dev/null << EOF
[Unit]
Description=ARTEVA Maison Print Station
After=network-online.target cups.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node $SCRIPT_DIR/print-station.js
Restart=always
RestartSec=3
StartLimitIntervalSec=0
Environment=NODE_ENV=production
StandardOutput=append:$SCRIPT_DIR/logs/output.log
StandardError=append:$SCRIPT_DIR/logs/error.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable arteva-print.service

# 8. Install watchdog cron job
echo "🐕 Installing watchdog..."
chmod +x "$SCRIPT_DIR/watchdog.sh"
# Remove old cron entry if exists, then add new one
(crontab -l 2>/dev/null | grep -v "watchdog.sh" ; echo "* * * * * $SCRIPT_DIR/watchdog.sh >> $SCRIPT_DIR/logs/watchdog.log 2>&1") | crontab -

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║  ✅ Production Setup Complete!       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Features installed:"
echo "  ✅ Auto-start on boot"
echo "  ✅ Auto-restart on crash (3s delay)"
echo "  ✅ Persistent disk queue"
echo "  ✅ Watchdog heartbeat monitor"
echo "  ✅ Rotating log files"
echo "  ✅ Health endpoint on :3100"
echo ""
echo "  Next steps:"
echo "  1. Set up printer:  sudo hp-setup -i"
echo "  2. Edit config:     nano $SCRIPT_DIR/.env"
echo "  3. Test print:      npm run test-print"
echo "  4. Start service:   sudo systemctl start arteva-print"
echo "  5. Check health:    curl http://localhost:3100/health"
echo "  6. View logs:       journalctl -u arteva-print -f"
echo ""
