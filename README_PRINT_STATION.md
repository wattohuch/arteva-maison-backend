# 🖨️ Arteva Maison Print Station

## Overview

Automated print station for Raspberry Pi that instantly prints receipts when orders arrive. Works like Cloudflare Tunnel - always connected, always ready, zero manual intervention.

## Features

✅ **Real-time Printing** - WebSocket connection for instant order notifications  
✅ **Auto-Start** - Survives power outages and reboots  
✅ **Zero Interaction** - No confirmations, no button clicks  
✅ **Exact Format** - Matches backend receipt format perfectly  
✅ **Headless** - No display needed, runs in background  
✅ **8GB Optimized** - Works on minimal SD card  
✅ **Self-Healing** - Auto-reconnects on network issues  
✅ **Fallback Polling** - Never misses an order  

## Quick Start

1. **Flash SD Card** - Raspberry Pi OS Lite (64-bit)
2. **Boot & Connect** - SSH into Raspberry Pi
3. **Install** - Node.js, CUPS, dependencies
4. **Configure** - Printer and API key
5. **Enable** - Systemd service for auto-start
6. **Done!** - Prints automatically forever

## Documentation

### 📚 Complete Guides

- **[COMPLETE_SETUP_GUIDE.md](./COMPLETE_SETUP_GUIDE.md)** - Full step-by-step setup (30 min)
- **[SETUP_CHECKLIST.md](./SETUP_CHECKLIST.md)** - Printable checklist
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Command reference card

### 📖 Understanding the System

- **[PRINT_STATION_HOW_IT_WORKS.md](./PRINT_STATION_HOW_IT_WORKS.md)** - How it works
- **[PRINT_STATION_ARCHITECTURE.md](./PRINT_STATION_ARCHITECTURE.md)** - System architecture
- **[PRINT_STATION_CONFIRMATION.md](./PRINT_STATION_CONFIRMATION.md)** - Feature confirmation

### 🔧 Alternative Guides

- **[PRINT_STATION_HEADLESS_SETUP.md](./PRINT_STATION_HEADLESS_SETUP.md)** - Detailed headless setup
- **[PRINT_STATION_QUICK_START.md](./PRINT_STATION_QUICK_START.md)** - Quick start guide

## Files

```
print-station.js              # Main script (Smart real-time edition)
print-station-package.json    # Dependencies (rename to package.json)
print-station.env.example     # Configuration template (rename to .env)
print-station.service         # Systemd service file
setup-print-station.sh        # Automated setup script
```

## Requirements

### Hardware
- Raspberry Pi 4 or 5
- 8GB MicroSD card (Class 10+)
- USB thermal printer (80mm)
- Power supply
- Network connection

### Software
- Raspberry Pi OS Lite (64-bit)
- Node.js 18+
- CUPS printing system
- Socket.io client

## Installation

### Quick Install

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install CUPS
sudo apt install -y cups cups-client printer-driver-escpos
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo systemctl enable cups
sudo systemctl start cups

# 4. Create directory
mkdir -p ~/print-station/logs ~/print-station/data
cd ~/print-station

# 5. Transfer files from your computer
# (See COMPLETE_SETUP_GUIDE.md for details)

# 6. Install dependencies
npm install

# 7. Configure
nano .env
# Set API_URL and API_KEY

# 8. Test
TEST_MODE=true node print-station.js

# 9. Enable auto-start
sudo cp print-station.service /etc/systemd/system/
sudo systemctl enable print-station
sudo systemctl start print-station
```

## Configuration

Edit `.env` file:

```bash
# Backend
API_URL=https://arteva-maison-backend.onrender.com
API_KEY=your_admin_api_key_here

# Printer
PRINTER_INTERFACE=/dev/usb/lp0
PRINTER_TYPE=EPSON

# Options
PRINT_RECEIPT=true
PRINT_LABEL=true
PRINT_PACKING=true
```

## Usage

### Start Service
```bash
sudo systemctl start print-station
```

### Stop Service
```bash
sudo systemctl stop print-station
```

### View Logs
```bash
sudo journalctl -u print-station -f
```

### Check Status
```bash
sudo systemctl status print-station
```

### Test Printer
```bash
echo "Test" | lpr -P receipt-printer
```

## How It Works

```
Customer Orders → Backend Receives → Socket.io Event Emitted
                                            ↓
                                    Print Station Receives
                                            ↓
                                    Prints Automatically
                                            ↓
                                    Ready for Next Order
```

**No polling, no delays, no confirmations - just instant printing!**

## Monitoring

### Live Logs
```bash
ssh pi@printstation.local
sudo journalctl -u print-station -f
```

### Health Check
```bash
sudo systemctl status print-station
lpstat -t
ping arteva-maison-backend.onrender.com
df -h /
```

## Troubleshooting

### Service Won't Start
```bash
sudo journalctl -u print-station -n 50
cd ~/print-station && node print-station.js
```

### Printer Not Working
```bash
lsusb
lpstat -t
sudo systemctl restart cups
```

### Can't Connect
```bash
ping arteva-maison-backend.onrender.com
cat ~/print-station/.env | grep API_KEY
```

## Maintenance

- **Daily:** Keep printer loaded with paper
- **Weekly:** Check logs for errors
- **Monthly:** Update system packages
- **Quarterly:** Backup configuration

## Support

For detailed help, see:
- [COMPLETE_SETUP_GUIDE.md](./COMPLETE_SETUP_GUIDE.md) - Full setup instructions
- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - Command reference
- [Troubleshooting section](#troubleshooting) - Common issues

## Architecture

- **Connection:** Persistent WebSocket (Socket.io)
- **Fallback:** Polling every 60 seconds
- **Auto-Restart:** Systemd service
- **Receipt Format:** Matches backend exactly
- **Duplicate Prevention:** State tracking
- **Error Recovery:** Auto-reconnection

## Security

- API key authentication
- HTTPS/WSS encryption
- Firewall configured
- Non-root execution
- SSH key recommended

## Performance

- **Latency:** < 1 second from order to print
- **Uptime:** 24/7 operation
- **Memory:** ~50MB RAM usage
- **Storage:** ~500MB total
- **Network:** Minimal bandwidth

## License

Proprietary - Arteva Maison

## Author

Arteva Maison Development Team

---

## Quick Links

- 📖 [Complete Setup Guide](./COMPLETE_SETUP_GUIDE.md)
- ✅ [Setup Checklist](./SETUP_CHECKLIST.md)
- 📋 [Quick Reference](./QUICK_REFERENCE.md)
- 🏗️ [Architecture](./PRINT_STATION_ARCHITECTURE.md)
- ❓ [How It Works](./PRINT_STATION_HOW_IT_WORKS.md)

---

**Questions?** Check the [COMPLETE_SETUP_GUIDE.md](./COMPLETE_SETUP_GUIDE.md) for detailed instructions.
