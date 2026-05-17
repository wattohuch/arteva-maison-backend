# ARTÉVA MAISON — Raspberry Pi Print + WhatsApp Station v4

Production-hardened print station and WhatsApp notification agent for Raspberry Pi.

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
│  → CUPS → USB    │  │  Sends via WhatsApp    │
└──────────────────┘  └───────────────────────┘
```

## Quick Start

```bash
# 1. Copy to Pi
scp -r raspi-print-station/ pi@PI_IP:~/print-station/

# 2. SSH in and run setup
ssh pi@PI_IP
cd ~/print-station
bash setup.sh

# 3. Configure
nano .env   # Set PRINTER_NAME

# 4. Set up printer
sudo hp-setup -i
lpstat -p -d    # Find printer name

# 5. Test print
npm run test-print

# 6. Start services
sudo systemctl start arteva-print
sudo systemctl start arteva-whatsapp
```

## Services

| Service | Port | Command |
|---------|------|---------|
| Print Station | 3100 | `sudo systemctl start arteva-print` |
| WhatsApp Agent | 3101 | `sudo systemctl start arteva-whatsapp` |

## Health Checks

```bash
curl http://localhost:3100/health   # Print station
curl http://localhost:3101/health   # WhatsApp agent
```

## Production Features

- **Mutex lock**: One print job at a time (no corruption)
- **Payload validation**: Rejects oversized/malformed orders
- **Print timeout**: Kills stuck jobs after 2 minutes
- **Memory monitoring**: Auto-GC when heap exceeds limit
- **Rotating logs**: 7-day retention, 5MB max per file
- **Atomic writes**: fsync + rename (survives power cuts)
- **USB power fix**: Disables autosuspend (prevents mid-print disconnect)
- **Swap**: 512MB swap file (prevents OOM kills)
- **Systemd**: Auto-start, auto-restart, memory limits
- **Watchdog**: Checks heartbeat, memory, temperature every minute

## Useful Commands

```bash
# Service management
sudo systemctl status arteva-print
sudo systemctl status arteva-whatsapp
sudo systemctl restart arteva-print
journalctl -u arteva-print -f --no-pager

# Health checks
npm run check-health
npm run check-wa-health
npm run check-printer

# Recovery
npm run retry-failed   # Re-queue failed jobs
npm run stress-test     # Stress test with 10 orders

# Logs
tail -f logs/print-station-*.log
tail -f logs/whatsapp-agent-*.log
cat logs/watchdog.log
```

## Troubleshooting

### Printer stops mid-print
1. Check USB: `lsusb` and `lpstat -p`
2. Check memory: `free -m` and `curl localhost:3100/health`
3. Check temp: `cat /sys/class/thermal/thermal_zone0/temp`
4. USB power fix applied? Check `/boot/cmdline.txt` for `usbcore.autosuspend=-1`

### WhatsApp not sending
1. Check agent: `sudo systemctl status arteva-whatsapp`
2. Check if QR scan needed: `journalctl -u arteva-whatsapp -f`
3. Delete auth and rescan: `rm -rf auth_info_baileys && sudo systemctl restart arteva-whatsapp`

### Out of memory
1. Check: `free -m`
2. Swap active? `swapon --show`
3. Restart: `sudo systemctl restart arteva-print`

### After power cut
Both services auto-start. Pending jobs resume automatically.
Check: `npm run check-health`
