# Auto-Start Quick Reference Card

## 🚀 Enable Auto-Start (One-Time Setup)

```bash
# 1. Copy service file
sudo cp ~/print-station/print-station.service /etc/systemd/system/

# 2. Reload systemd
sudo systemctl daemon-reload

# 3. Enable auto-start on boot
sudo systemctl enable print-station

# 4. Start service now
sudo systemctl start print-station

# 5. Check it's running
sudo systemctl status print-station
```

**Expected:** `Active: active (running)` ✅

---

## 📋 Daily Commands

### Check Status
```bash
sudo systemctl status print-station
```

### View Live Logs
```bash
sudo journalctl -u print-station -f
```
Press `Ctrl+C` to exit (service keeps running)

### Restart Service
```bash
sudo systemctl restart print-station
```

### Stop Service
```bash
sudo systemctl stop print-station
```

### Start Service
```bash
sudo systemctl start print-station
```

---

## 🔄 What Happens Automatically

### On Boot:
1. Raspberry Pi powers on
2. Linux starts (10 seconds)
3. Network connects (15 seconds)
4. CUPS printer service starts (20 seconds)
5. Print station starts (25 seconds)
6. Connects to backend (30 seconds)
7. **Ready to print!** (40 seconds total)

### On Crash:
1. Service detects crash
2. Waits 10 seconds
3. Restarts automatically
4. Reconnects to backend
5. **Ready to print!**

### On Power Outage:
1. Power restored
2. Raspberry Pi boots
3. Service starts automatically
4. **Ready to print!** (40 seconds)

---

## ✅ Verification

### Is Auto-Start Enabled?
```bash
sudo systemctl is-enabled print-station
```
**Expected:** `enabled` ✅

### Is Service Running?
```bash
sudo systemctl is-active print-station
```
**Expected:** `active` ✅

### When Did It Start?
```bash
sudo systemctl status print-station | grep Active
```
**Shows:** Start time and uptime

### How Many Times Restarted?
```bash
sudo journalctl -u print-station | grep Started | wc -l
```
**Shows:** Number of starts (should be low)

---

## 🧪 Testing

### Test 1: Reboot
```bash
sudo reboot
```
Wait 2 minutes, SSH back in, check status.

### Test 2: Stop and Wait
```bash
sudo systemctl stop print-station
```
Wait 10 seconds, check status (should auto-restart).

### Test 3: Power Cycle
Unplug power, wait 10 seconds, plug back in, wait 2 minutes, check status.

### Test 4: Place Order
Place order on website, check logs for print confirmation.

---

## 🆘 Troubleshooting

### Service Won't Start
```bash
# Check logs for errors
sudo journalctl -u print-station -n 50

# Try manual start
cd ~/print-station
node print-station.js
```

### Service Keeps Restarting
```bash
# Watch logs
sudo journalctl -u print-station -f

# Common issues:
# - Invalid API_KEY in .env
# - Backend URL wrong
# - Network not connected
# - Printer not configured
```

### Fix Configuration
```bash
nano ~/print-station/.env
# Fix API_KEY, API_URL, PRINTER_NAME
# Save: Ctrl+X, Y, Enter

# Restart service
sudo systemctl restart print-station
```

---

## 📊 Monitoring

### View Last 20 Log Lines
```bash
sudo journalctl -u print-station -n 20
```

### View Logs Since Boot
```bash
sudo journalctl -u print-station -b
```

### View Errors Only
```bash
sudo journalctl -u print-station | grep -i error
```

### Count Printed Receipts
```bash
sudo journalctl -u print-station | grep "Printed receipt" | wc -l
```

### Check Memory Usage
```bash
sudo systemctl status print-station | grep Memory
```

---

## 🔧 Service File Location

**File:** `/etc/systemd/system/print-station.service`

**View:**
```bash
cat /etc/systemd/system/print-station.service
```

**Edit:**
```bash
sudo nano /etc/systemd/system/print-station.service
# After editing:
sudo systemctl daemon-reload
sudo systemctl restart print-station
```

---

## 📝 Configuration File Location

**File:** `/home/pi/print-station/.env`

**View:**
```bash
cat ~/print-station/.env
```

**Edit:**
```bash
nano ~/print-station/.env
# After editing:
sudo systemctl restart print-station
```

---

## 🎯 Key Features

✅ **Starts on boot** - No manual start needed
✅ **Restarts on crash** - Automatic recovery
✅ **Survives power outages** - Boots and starts automatically
✅ **Waits for network** - Won't start until connected
✅ **Waits for printer** - Won't start until CUPS ready
✅ **Logs everything** - Easy debugging
✅ **No display needed** - Runs headless

---

## 📞 Quick Help

### Can't Connect?
```bash
ssh pi@printstation.local
# or
ssh pi@192.168.1.XXX
```

### Forgot Password?
Reflash SD card with Raspberry Pi Imager (start over).

### Service Not Found?
```bash
sudo cp ~/print-station/print-station.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### Printer Not Working?
```bash
lpstat -p hp-smarttank
# If not found, add in CUPS: http://printstation.local:631
```

---

## 🎉 Success Indicators

When everything works, you'll see:

```bash
$ sudo systemctl status print-station
● print-station.service - Arteva Maison Print Station - HP SmartTank
   Loaded: loaded (/etc/systemd/system/print-station.service; enabled)
   Active: active (running) since Wed 2026-05-13 10:30:00 UTC; 5min ago
```

```bash
$ sudo journalctl -u print-station -n 5
✓ Browser initialized successfully
✓ Connected to backend (Socket ID: abc123)
✓ Joined admin room for order notifications
✓ Print station running
✓ Listening for new orders...
```

**That's it! Your print station is running automatically!** 🚀

---

## 📚 More Info

- **Full Guide:** `IDIOTS_GUIDE.md`
- **Detailed Auto-Start:** `AUTO_START_GUIDE.md`
- **Troubleshooting:** `PRINT_STATION_HP_SMARTTANK.md`

---

**Print this card and keep it near your Raspberry Pi!** 📄
