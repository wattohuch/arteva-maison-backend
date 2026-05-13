# Raspberry Pi Auto-Start Guide - Print Station

## Overview
This guide ensures your Raspberry Pi automatically starts the print station when:
- ✅ Raspberry Pi boots up
- ✅ Power is restored after outage
- ✅ Print station crashes (auto-restart)
- ✅ Network reconnects

**No manual intervention needed!**

---

## How It Works

### Systemd Service
The print station runs as a **systemd service**, which is Linux's built-in service manager. It:
- Starts automatically on boot
- Restarts automatically if it crashes
- Waits for network and printer to be ready
- Logs all output for debugging

### Service Configuration
File: `print-station.service`

```ini
[Unit]
Description=Arteva Maison Print Station - HP SmartTank
After=network-online.target cups.service
Wants=network-online.target cups.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/print-station
ExecStart=/usr/bin/node /home/pi/print-station/print-station-hp.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Key Features:
- **After=network-online.target** - Waits for internet connection
- **After=cups.service** - Waits for printer service
- **Restart=always** - Restarts if crashes
- **RestartSec=10** - Waits 10 seconds before restart
- **WantedBy=multi-user.target** - Starts on boot

---

## Setup Instructions

### Step 1: Copy Files to Raspberry Pi

SSH into your Raspberry Pi:
```bash
ssh pi@raspberrypi.local
```

Create print station directory:
```bash
mkdir -p /home/pi/print-station
cd /home/pi/print-station
```

Copy these files from your computer to Raspberry Pi:
- `print-station-hp.js`
- `print-station-hp-package.json` (rename to `package.json`)
- `print-station.env.example` (rename to `.env`)
- `print-station.service`

**Option A: Using SCP (from your computer):**
```bash
scp print-station-hp.js pi@raspberrypi.local:/home/pi/print-station/
scp print-station-hp-package.json pi@raspberrypi.local:/home/pi/print-station/package.json
scp print-station.env.example pi@raspberrypi.local:/home/pi/print-station/.env
scp print-station.service pi@raspberrypi.local:/home/pi/print-station/
```

**Option B: Using USB Drive:**
1. Copy files to USB drive
2. Insert USB into Raspberry Pi
3. Mount USB: `sudo mount /dev/sda1 /mnt`
4. Copy files: `cp /mnt/*.js /home/pi/print-station/`
5. Unmount: `sudo umount /mnt`

**Option C: Using Git (easiest):**
```bash
cd /home/pi
git clone https://github.com/your-repo/arteva-maison-backend.git
cp arteva-maison-backend/print-station-hp.js print-station/
cp arteva-maison-backend/print-station-hp-package.json print-station/package.json
cp arteva-maison-backend/print-station.env.example print-station/.env
cp arteva-maison-backend/print-station.service print-station/
```

### Step 2: Install Dependencies

```bash
cd /home/pi/print-station
npm install
```

This installs:
- `socket.io-client` - Real-time connection to backend
- `axios` - HTTP requests
- `puppeteer` - HTML to PDF conversion
- `dotenv` - Environment variables

### Step 3: Configure Environment

Edit `.env` file:
```bash
nano /home/pi/print-station/.env
```

Set these values:
```bash
# Backend API
API_URL=https://arteva-maison-backend.onrender.com
API_KEY=your_admin_jwt_token_here

# Printer
PRINTER_NAME=hp-smarttank
PAPER_SIZE=A4

# Features
PRINT_RECEIPT=true
PRINT_LABEL=false
PRINT_PACKING=false

# Logging
LOG_FILE=/home/pi/print-station/logs/print-station.log
STATE_FILE=/home/pi/print-station/data/last-order.json
TEMP_DIR=/home/pi/print-station/temp
```

**Get API_KEY:**
1. Open your website in browser
2. Login to admin panel
3. Press F12 (Developer Tools)
4. Go to Console tab
5. Type: `localStorage.getItem('token')`
6. Copy the token (without quotes)
7. Paste into `.env` as `API_KEY`

Save and exit: `Ctrl+X`, then `Y`, then `Enter`

### Step 4: Create Directories

```bash
mkdir -p /home/pi/print-station/logs
mkdir -p /home/pi/print-station/data
mkdir -p /home/pi/print-station/temp
```

### Step 5: Test Print Station (Manual)

Before enabling auto-start, test manually:
```bash
cd /home/pi/print-station
node print-station-hp.js
```

You should see:
```
========================================
🖨️  Arteva Maison Print Station
    HP SmartTank Edition
========================================
Station ID: ps-hp-raspberrypi
Backend: https://arteva-maison-backend.onrender.com
Printer: hp-smarttank
Paper: A4
Mode: Real-time Socket.io + Fallback Polling
========================================

✓ Browser initialized successfully
🔌 Connecting to backend: https://arteva-maison-backend.onrender.com
✓ Connected to backend (Socket ID: abc123)
✓ Joined admin room for order notifications
✓ Print station running
✓ Listening for new orders...
```

Press `Ctrl+C` to stop.

### Step 6: Install Systemd Service

Copy service file to systemd directory:
```bash
sudo cp /home/pi/print-station/print-station.service /etc/systemd/system/
```

Reload systemd to recognize new service:
```bash
sudo systemctl daemon-reload
```

Enable service (start on boot):
```bash
sudo systemctl enable print-station
```

Start service now:
```bash
sudo systemctl start print-station
```

### Step 7: Verify Service is Running

Check service status:
```bash
sudo systemctl status print-station
```

You should see:
```
● print-station.service - Arteva Maison Print Station - HP SmartTank
   Loaded: loaded (/etc/systemd/system/print-station.service; enabled; vendor preset: enabled)
   Active: active (running) since Wed 2026-05-13 10:30:00 UTC; 5s ago
 Main PID: 1234 (node)
    Tasks: 11 (limit: 4915)
   Memory: 45.2M
   CGroup: /system.slice/print-station.service
           └─1234 /usr/bin/node /home/pi/print-station/print-station-hp.js

May 13 10:30:00 raspberrypi systemd[1]: Started Arteva Maison Print Station - HP SmartTank.
May 13 10:30:01 raspberrypi node[1234]: ✓ Browser initialized successfully
May 13 10:30:02 raspberrypi node[1234]: ✓ Connected to backend
May 13 10:30:02 raspberrypi node[1234]: ✓ Print station running
```

**Key indicators:**
- `Loaded: ... enabled` - Will start on boot ✅
- `Active: active (running)` - Currently running ✅
- `✓ Connected to backend` - Connected to Render ✅

### Step 8: View Live Logs

Watch logs in real-time:
```bash
sudo journalctl -u print-station -f
```

Press `Ctrl+C` to stop watching.

View last 50 lines:
```bash
sudo journalctl -u print-station -n 50
```

View logs since boot:
```bash
sudo journalctl -u print-station -b
```

---

## Testing Auto-Start

### Test 1: Reboot Raspberry Pi
```bash
sudo reboot
```

Wait 2-3 minutes, then SSH back in:
```bash
ssh pi@raspberrypi.local
```

Check if service started automatically:
```bash
sudo systemctl status print-station
```

**Expected:** `Active: active (running)` ✅

### Test 2: Simulate Power Outage
1. Unplug Raspberry Pi power
2. Wait 10 seconds
3. Plug power back in
4. Wait 2-3 minutes for boot
5. SSH in and check status

**Expected:** Service running automatically ✅

### Test 3: Simulate Crash
Stop the service:
```bash
sudo systemctl stop print-station
```

Wait 10 seconds, then check status:
```bash
sudo systemctl status print-station
```

**Expected:** Service restarted automatically ✅

### Test 4: Place Order
1. Go to your website
2. Place a test order
3. Check Raspberry Pi logs:
```bash
sudo journalctl -u print-station -f
```

**Expected:**
```
🆕 New order notification received: AM-2024-001
📦 Processing order AM-2024-001
✓ Printed receipt for order AM-2024-001
```

---

## Service Management Commands

### Start Service:
```bash
sudo systemctl start print-station
```

### Stop Service:
```bash
sudo systemctl stop print-station
```

### Restart Service:
```bash
sudo systemctl restart print-station
```

### Check Status:
```bash
sudo systemctl status print-station
```

### Enable Auto-Start (on boot):
```bash
sudo systemctl enable print-station
```

### Disable Auto-Start:
```bash
sudo systemctl disable print-station
```

### View Logs:
```bash
sudo journalctl -u print-station -f
```

### Clear Logs:
```bash
sudo journalctl --rotate
sudo journalctl --vacuum-time=1s
```

---

## Troubleshooting

### Service Won't Start

**Check logs:**
```bash
sudo journalctl -u print-station -n 50
```

**Common issues:**

1. **Node.js not found:**
   ```bash
   sudo apt install -y nodejs npm
   ```

2. **Dependencies missing:**
   ```bash
   cd /home/pi/print-station
   npm install
   ```

3. **Chromium not found:**
   ```bash
   sudo apt install -y chromium-browser
   ```

4. **Permissions error:**
   ```bash
   sudo chown -R pi:pi /home/pi/print-station
   chmod +x /home/pi/print-station/print-station-hp.js
   ```

5. **API_KEY missing:**
   ```bash
   nano /home/pi/print-station/.env
   # Add API_KEY=your_token_here
   ```

### Service Keeps Restarting

**Check logs for errors:**
```bash
sudo journalctl -u print-station -f
```

**Common causes:**
- Invalid API_KEY
- Backend URL wrong
- Network not connected
- Printer not configured

**Fix:**
1. Verify `.env` configuration
2. Test network: `ping google.com`
3. Test backend: `curl https://arteva-maison-backend.onrender.com/health`
4. Test printer: `lpstat -p hp-smarttank`

### Printer Not Found

**List printers:**
```bash
lpstat -p -d
```

**Expected output:**
```
printer hp-smarttank is idle. enabled since ...
```

**If printer not found:**
1. Open CUPS: http://raspberrypi.local:631
2. Add printer
3. Name it: `hp-smarttank`
4. Test print page

### Network Issues

**Check network:**
```bash
ping google.com
ping arteva-maison-backend.onrender.com
```

**If network down:**
- Check ethernet cable
- Check WiFi connection: `sudo raspi-config` → Network
- Restart network: `sudo systemctl restart networking`

### Backend Connection Failed

**Test backend:**
```bash
curl https://arteva-maison-backend.onrender.com/health
```

**Expected:** `{"status":"ok"}`

**If fails:**
- Backend might be sleeping (Render free tier)
- Wait 30 seconds and try again
- Check Render dashboard

---

## Auto-Start Verification Checklist

After setup, verify these:

- [ ] Service file copied to `/etc/systemd/system/print-station.service`
- [ ] Service enabled: `sudo systemctl is-enabled print-station` → `enabled`
- [ ] Service running: `sudo systemctl is-active print-station` → `active`
- [ ] Logs show connection: `sudo journalctl -u print-station -n 20`
- [ ] Reboot test: Service starts automatically after reboot
- [ ] Power test: Service starts after power cycle
- [ ] Print test: Order prints automatically

---

## What Happens on Boot

### Boot Sequence:
1. **Raspberry Pi powers on** (0 seconds)
2. **Linux kernel loads** (5 seconds)
3. **Network starts** (10 seconds)
4. **CUPS printer service starts** (15 seconds)
5. **Print station service starts** (20 seconds)
6. **Node.js initializes** (25 seconds)
7. **Puppeteer browser launches** (30 seconds)
8. **Socket.io connects to backend** (35 seconds)
9. **Print station ready** (40 seconds)

**Total boot time:** ~40 seconds from power on to ready

### What You'll See:
- Raspberry Pi LED blinks (booting)
- LED solid green (boot complete)
- Print station connects to backend
- Ready to print orders

**No display needed!** Everything runs headless.

---

## Monitoring

### Check if Running:
```bash
sudo systemctl is-active print-station
```

### Check Uptime:
```bash
sudo systemctl status print-station | grep Active
```

### Check Last Restart:
```bash
sudo journalctl -u print-station | grep Started | tail -1
```

### Check Error Count:
```bash
sudo journalctl -u print-station | grep -i error | wc -l
```

### Check Print Count:
```bash
sudo journalctl -u print-station | grep "Printed receipt" | wc -l
```

---

## Summary

### ✅ Auto-Start Features:
- Starts automatically on boot
- Starts automatically after power outage
- Restarts automatically if crashes
- Waits for network and printer
- Logs all activity
- No manual intervention needed

### 📋 Setup Steps:
1. Copy files to Raspberry Pi
2. Install dependencies (`npm install`)
3. Configure `.env` file
4. Test manually (`node print-station-hp.js`)
5. Install service (`sudo cp ... /etc/systemd/system/`)
6. Enable service (`sudo systemctl enable print-station`)
7. Start service (`sudo systemctl start print-station`)
8. Verify running (`sudo systemctl status print-station`)

### 🔧 Management:
- **Start:** `sudo systemctl start print-station`
- **Stop:** `sudo systemctl stop print-station`
- **Restart:** `sudo systemctl restart print-station`
- **Status:** `sudo systemctl status print-station`
- **Logs:** `sudo journalctl -u print-station -f`

### 🚀 Result:
**Plug in Raspberry Pi → Wait 40 seconds → Print station ready!**

No SSH, no commands, no manual start. Just power on and go! ⚡

---

**Questions? Check `IDIOTS_GUIDE.md` for complete setup instructions.**
