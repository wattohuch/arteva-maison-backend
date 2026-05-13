# Print Station Quick Start Guide

## 🎯 Goal
Set up a Raspberry Pi 4/5 as an automated print station with **8GB SD card** and **no display** (headless).

## 📦 What You Need
- Raspberry Pi 4 or 5
- 8GB MicroSD card
- USB thermal printer (80mm receipt printer)
- Ethernet cable or WiFi
- Power supply
- Your computer (for setup)

## 🚀 Quick Setup (30 Minutes)

### Step 1: Flash SD Card (5 min)

1. Download **Raspberry Pi Imager**: https://www.raspberrypi.com/software/
2. Open Imager and select:
   - **Device**: Raspberry Pi 4 or 5
   - **OS**: Raspberry Pi OS Lite (64-bit)
   - **Storage**: Your 8GB SD card
3. Click **Settings** (⚙️) and configure:
   - ✅ Hostname: `printstation`
   - ✅ Username: `pi` / Password: (your choice)
   - ✅ WiFi: (your network) - if using WiFi
   - ✅ Enable SSH: Use password authentication
   - ✅ Timezone: Asia/Kuwait
4. Click **Write** and wait

### Step 2: Boot Raspberry Pi (3 min)

1. Insert SD card into Raspberry Pi
2. Connect ethernet cable (or use WiFi)
3. Connect USB printer
4. Power on
5. Wait 2-3 minutes

### Step 3: Connect via SSH (2 min)

From your computer (Windows PowerShell):
```powershell
ssh pi@printstation.local
# Enter your password
```

If that doesn't work, find IP address from your router and use:
```powershell
ssh pi@192.168.1.XXX
```

### Step 4: Run Setup Script (10 min)

Copy and paste this into SSH terminal:
```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/arteva-print-station/main/setup-print-station.sh | bash
```

Or manually:
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install CUPS (printing)
sudo apt install -y cups cups-client printer-driver-escpos
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo systemctl enable cups
sudo systemctl start cups

# Create directory
mkdir -p ~/print-station/logs ~/print-station/data
```

### Step 5: Transfer Files (3 min)

From your Windows computer (in backend folder):
```powershell
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"

scp print-station.js pi@printstation.local:~/print-station/
scp print-station-package.json pi@printstation.local:~/print-station/package.json
scp print-station.env.example pi@printstation.local:~/print-station/.env
scp print-station.service pi@printstation.local:~/print-station/
```

### Step 6: Install Dependencies (2 min)

Back in SSH:
```bash
cd ~/print-station
npm install
```

### Step 7: Configure Printer (5 min)

1. Open browser on your computer: `http://printstation.local:631`
2. Go to **Administration** → **Add Printer**
3. Login: username `pi`, your password
4. Select your USB printer → Continue
5. Name: `receipt-printer` → Continue
6. Driver: **Generic ESC/POS** → Add Printer
7. Click **Set Default Options**

Test printer:
```bash
echo "Test Print" | lpr -P receipt-printer
```

### Step 8: Configure Print Station (3 min)

```bash
nano ~/print-station/.env
```

Update these lines:
```bash
API_URL=https://arteva-maison-backend.onrender.com
API_KEY=your_admin_api_key_here
PRINTER_INTERFACE=/dev/usb/lp0
```

Save: `Ctrl+X`, `Y`, `Enter`

### Step 9: Test (2 min)

```bash
cd ~/print-station
TEST_MODE=true node print-station.js
```

You should see a test receipt print! ✅

### Step 10: Enable Auto-Start (2 min)

```bash
sudo cp ~/print-station/print-station.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable print-station
sudo systemctl start print-station
sudo systemctl status print-station
```

## ✅ Done!

Your print station is now running 24/7 and will automatically print new orders.

## 📊 Monitor Your Print Station

### View Logs
```bash
ssh pi@printstation.local
sudo journalctl -u print-station -f
```

### Check Status
```bash
ssh pi@printstation.local "sudo systemctl status print-station"
```

### Restart Service
```bash
ssh pi@printstation.local "sudo systemctl restart print-station"
```

## 🔧 Common Issues

### Can't SSH?
- Try IP address: `ssh pi@192.168.1.XXX`
- Check router for Raspberry Pi IP
- Ensure SSH was enabled in Imager settings

### Printer Not Working?
```bash
# Check if detected
lsusb

# Check printer status
lpstat -t

# Restart CUPS
sudo systemctl restart cups
```

### Service Won't Start?
```bash
# Check logs
sudo journalctl -u print-station -n 50

# Test manually
cd ~/print-station
node print-station.js
```

### Out of Space?
```bash
# Check space
df -h

# Clean up
sudo apt autoremove -y
sudo apt clean
npm cache clean --force
```

## 📝 Daily Operations

### No maintenance needed!
The print station runs automatically. Just ensure:
- Raspberry Pi is powered on
- Printer has paper
- Network is connected

### Check once a day:
```bash
ssh pi@printstation.local "sudo systemctl status print-station"
```

## 🔄 Update Print Station

When you have new code:
```powershell
# From your computer
scp print-station.js pi@printstation.local:~/print-station/

# Restart service
ssh pi@printstation.local "sudo systemctl restart print-station"
```

## 💾 Backup

Save your configuration:
```powershell
scp pi@printstation.local:~/print-station/.env ./print-station-backup.env
```

## 🆘 Emergency Commands

```bash
# Restart everything
ssh pi@printstation.local "sudo reboot"

# Stop printing
ssh pi@printstation.local "sudo systemctl stop print-station"

# Clear print queue
ssh pi@printstation.local "cancel -a"
```

## 📞 Support Checklist

If something goes wrong:
1. ✅ Is Raspberry Pi powered on?
2. ✅ Is printer connected and has paper?
3. ✅ Can you SSH into it?
4. ✅ Check logs: `sudo journalctl -u print-station -n 50`
5. ✅ Test printer: `echo "test" | lpr`
6. ✅ Check service: `sudo systemctl status print-station`

## 🎉 Success Indicators

You'll know it's working when:
- ✅ Service status shows "active (running)"
- ✅ Test print works
- ✅ New orders automatically print
- ✅ Logs show "Processing order..."
- ✅ No errors in `journalctl`

---

**That's it!** Your headless print station is ready. No display needed, works 24/7, fully automated. 🚀
