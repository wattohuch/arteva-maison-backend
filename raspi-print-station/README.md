# ARTÉVA MAISON — Raspberry Pi Print Station v2

Auto-prints new paid orders on your HP SmartTank printer.

## What's different from the old scripts

| Problem in old scripts | Fixed in v2 |
|---|---|
| Used JWT auth (`Bearer token`) — fails because Pi doesn't log in | Uses API key auth (`?key=arteva-print-2026`) |
| Fetched receipt HTML from backend endpoint that needs JWT | Generates receipt HTML locally |
| Used `socket.io-client` — backend doesn't support print station sockets | Simple polling (reliable, works always) |
| Used full `puppeteer` (downloads 300MB Chromium) | Uses `puppeteer-core` (uses system Chromium) |
| Hardcoded Chromium path `/usr/bin/chromium` | Auto-detects Chromium location |
| No printer auto-detection | Auto-detects CUPS default printer |

## Quick Start on Raspberry Pi

```bash
# 1. Copy this folder to Pi
scp -r raspi-print-station/ pi@YOUR_PI_IP:~/print-station/

# 2. SSH into Pi
ssh pi@YOUR_PI_IP

# 3. Run setup (installs everything)
cd ~/print-station
bash setup.sh

# 4. Set up HP printer if not already done
sudo hp-setup -i

# 5. Find your printer name
lpstat -p -d

# 6. Edit .env with your printer name
nano .env

# 7. Test print
npm run test-print

# 8. Start the service
sudo systemctl start arteva-print

# 9. Check it's running
sudo systemctl status arteva-print
journalctl -u arteva-print -f
```

## Useful Commands

```bash
# Check printer status
npm run check-printer

# Check API connectivity
npm run check-api

# View live logs
tail -f logs/print-station.log

# Restart service
sudo systemctl restart arteva-print

# Stop service
sudo systemctl stop arteva-print
```
