# 🚀 Complete Print Station Setup Guide
## From Scratch to Auto-Printing

**Goal**: Set up Raspberry Pi that automatically prints receipts when orders arrive, survives power outages, and matches your backend receipt format exactly.

---

## 📦 What You Need

### Hardware (Required)
- ✅ Raspberry Pi 4 or 5 (any RAM)
- ✅ 8GB MicroSD card (Class 10 minimum)
- ✅ USB Thermal Printer (80mm receipt printer - EPSON/STAR/compatible)
- ✅ Power supply (official Raspberry Pi adapter)
- ✅ Ethernet cable OR WiFi
- ✅ Your computer (for initial setup)

### Hardware (NOT Needed)
- ❌ Display/Monitor
- ❌ Keyboard
- ❌ Mouse
- ❌ HDMI cable

---

## 🎯 PART 1: Prepare SD Card (On Your Computer)

### Step 1.1: Download Raspberry Pi Imager

**Windows/Mac/Linux:**
1. Go to: https://www.raspberrypi.com/software/
2. Download and install "Raspberry Pi Imager"
3. Open the application

### Step 1.2: Flash SD Card

1. **Insert your 8GB SD card** into your computer

2. **In Raspberry Pi Imager:**
   - Click "Choose Device" → Select **Raspberry Pi 4** or **Raspberry Pi 5**
   - Click "Choose OS" → **Raspberry Pi OS (other)** → **Raspberry Pi OS Lite (64-bit)**
     - ⚠️ Important: Choose "Lite" (no desktop) to save space
   - Click "Choose Storage" → Select your 8GB SD card

3. **Click the Settings gear icon (⚙️)** - THIS IS CRITICAL!

4. **Configure these settings:**

   ```
   ✅ Set hostname: printstation
   
   ✅ Set username and password:
      Username: pi
      Password: [choose a strong password - remember it!]
   
   ✅ Configure wireless LAN (if using WiFi):
      SSID: [your WiFi network name]
      Password: [your WiFi password]
      Wireless LAN country: KW (or your country)
   
   ✅ Set locale settings:
      Time zone: Asia/Kuwait
      Keyboard layout: us
   
   ✅ Enable SSH:
      ☑ Use password authentication
   ```

5. **Click "Save"**

6. **Click "Write"** and wait (takes 5-10 minutes)

7. **When done, eject SD card safely**

---

## 🎯 PART 2: First Boot

### Step 2.1: Hardware Setup

1. **Insert SD card** into Raspberry Pi
2. **Connect ethernet cable** (or use WiFi configured above)
3. **Connect USB thermal printer** to any USB port
4. **Power on** Raspberry Pi
5. **Wait 2-3 minutes** for first boot

### Step 2.2: Find Raspberry Pi IP Address

**Option A: Use hostname (easiest)**
```
printstation.local
```

**Option B: Check your router**
- Log into your router admin panel
- Look for device named "printstation"
- Note the IP address (e.g., 192.168.1.150)

**Option C: Use network scanner**
- Windows: Download "Advanced IP Scanner"
- Mac: Use "LanScan" app
- Look for "Raspberry Pi" device

---

## 🎯 PART 3: Connect via SSH

### Step 3.1: Open Terminal/PowerShell

**Windows:**
- Press `Win + X`
- Select "Windows PowerShell" or "Terminal"

**Mac:**
- Press `Cmd + Space`
- Type "Terminal" and press Enter

### Step 3.2: Connect

```bash
ssh pi@printstation.local
```

Or if hostname doesn't work:
```bash
ssh pi@192.168.1.XXX
```
(Replace XXX with your Pi's IP address)

**First time connecting:**
- You'll see: "Are you sure you want to continue connecting?"
- Type: `yes` and press Enter
- Enter the password you set in Step 1.2

**You're now connected to your Raspberry Pi!** 🎉

---

## 🎯 PART 4: Install Required Software

Copy and paste these commands one by one into SSH terminal:

### Step 4.1: Update System

```bash
sudo apt update && sudo apt upgrade -y
```
⏱️ Takes 5-10 minutes

### Step 4.2: Install Node.js 18

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

**Verify installation:**
```bash
node --version
```
Should show: `v18.x.x`

### Step 4.3: Install Printing System (CUPS)

```bash
sudo apt install -y cups cups-client printer-driver-escpos printer-driver-all
```

**Configure CUPS:**
```bash
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo cupsctl --share-printers
sudo systemctl enable cups
sudo systemctl start cups
```

### Step 4.4: Optimize for 8GB SD Card

```bash
# Disable swap (saves space, extends SD card life)
sudo dphys-swapfile swapoff
sudo dphys-swapfile uninstall
sudo systemctl disable dphys-swapfile

# Reduce GPU memory (headless system)
echo "gpu_mem=16" | sudo tee -a /boot/firmware/config.txt

# Disable unnecessary services
sudo systemctl disable bluetooth
sudo systemctl disable hciuart

# Clean up
sudo apt autoremove -y
sudo apt clean
```

### Step 4.5: Check Available Space

```bash
df -h /
```
You should have at least 2-3 GB free

---

## 🎯 PART 5: Configure Printer

### Step 5.1: Check if Printer is Detected

```bash
lsusb
```
You should see your printer listed (e.g., "EPSON" or "Printer")

```bash
ls -la /dev/usb/lp*
```
Should show: `/dev/usb/lp0` (this is your printer device)

### Step 5.2: Add Printer via CUPS Web Interface

**On your computer (not SSH):**

1. Open browser
2. Go to: `http://printstation.local:631`
   - Or: `http://192.168.1.XXX:631` (use your Pi's IP)

3. Click **"Administration"** → **"Add Printer"**

4. **Login:**
   - Username: `pi`
   - Password: [your password]

5. **Select your USB printer** from the list → Click **"Continue"**

6. **Printer settings:**
   - Name: `receipt-printer`
   - Description: `Thermal Receipt Printer`
   - ☑ Share This Printer
   - Click **"Continue"**

7. **Select driver:**
   - Choose: **"Generic"** → **"Generic ESC/POS Printer"**
   - Or search for your printer model
   - Click **"Add Printer"**

8. **Set default options** → Click **"Set Default Options"**

### Step 5.3: Test Printer

**Back in SSH terminal:**

```bash
echo "Test Print from Raspberry Pi" | lpr -P receipt-printer
```

**Did it print?**
- ✅ YES → Continue to next step
- ❌ NO → Check:
  - Printer has paper
  - Printer is powered on
  - USB cable is connected
  - Run: `lpstat -t` to check printer status

---

## 🎯 PART 6: Install Print Station Software

### Step 6.1: Create Directory

```bash
mkdir -p ~/print-station/logs
mkdir -p ~/print-station/data
cd ~/print-station
```

### Step 6.2: Transfer Files from Your Computer

**On your Windows computer, open PowerShell:**

```powershell
# Navigate to your backend folder
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"

# Transfer files (one by one)
scp print-station.js pi@printstation.local:~/print-station/
scp print-station-package.json pi@printstation.local:~/print-station/package.json
scp print-station.env.example pi@printstation.local:~/print-station/.env
scp print-station.service pi@printstation.local:~/print-station/
```

**Enter your password when prompted for each file**

### Step 6.3: Install Dependencies

**Back in SSH terminal:**

```bash
cd ~/print-station
npm install
```
⏱️ Takes 2-3 minutes

---

## 🎯 PART 7: Configure Print Station

### Step 7.1: Edit Configuration

```bash
nano ~/print-station/.env
```

### Step 7.2: Update These Values

```bash
# API Configuration
API_URL=https://arteva-maison-backend.onrender.com
API_KEY=your_actual_admin_api_key_here

# Socket.io Configuration
SOCKET_URL=https://arteva-maison-backend.onrender.com

# Printer Configuration
PRINTER_INTERFACE=/dev/usb/lp0
PRINTER_TYPE=EPSON

# Print Options
PRINT_RECEIPT=true
PRINT_LABEL=true
PRINT_PACKING=true

# Print Station Identity
PRINT_STATION_ID=ps-kitchen
```

**Important:**
- Replace `your_actual_admin_api_key_here` with your real API key
- If your printer is not EPSON, change PRINTER_TYPE to: STAR, TANCA, DARUMA, or BEMATECH

**Save and exit:**
- Press `Ctrl + X`
- Press `Y`
- Press `Enter`

---

## 🎯 PART 8: Test Print Station

### Step 8.1: Run Test Mode

```bash
cd ~/print-station
TEST_MODE=true node print-station.js
```

**What should happen:**
- You'll see logs in terminal
- Printer should print a test receipt
- If successful, you'll see: "✓ Successfully processed order"

**Did it work?**
- ✅ YES → Continue to next step
- ❌ NO → Check:
  - API_KEY is correct in .env
  - Printer is ready: `lpstat -t`
  - Check logs for errors

---

## 🎯 PART 9: Enable Auto-Start (Survives Power Outages)

### Step 9.1: Install Systemd Service

```bash
sudo cp ~/print-station/print-station.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### Step 9.2: Enable and Start Service

```bash
# Enable auto-start on boot
sudo systemctl enable print-station

# Start service now
sudo systemctl start print-station

# Check status
sudo systemctl status print-station
```

**You should see:**
```
● print-station.service - Arteva Maison Print Station
   Loaded: loaded
   Active: active (running)
```

Press `Q` to exit status view

### Step 9.3: View Live Logs

```bash
sudo journalctl -u print-station -f
```

**You should see:**
```
✓ Printer initialized successfully
🔌 Connecting to backend
✓ Connected to backend
✓ Joined admin room
✓ Print station running
✓ Listening for new orders...
```

Press `Ctrl + C` to stop viewing logs (service keeps running)

---

## 🎯 PART 10: Set Static IP (Optional but Recommended)

### Step 10.1: Edit Network Configuration

```bash
sudo nano /etc/dhcpcd.conf
```

### Step 10.2: Add at the End

```bash
# Static IP for Print Station
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=192.168.1.1 8.8.8.8

# For WiFi, use:
# interface wlan0
# static ip_address=192.168.1.100/24
# static routers=192.168.1.1
# static domain_name_servers=192.168.1.1 8.8.8.8
```

**Adjust these values for your network:**
- `192.168.1.100` → Choose an unused IP in your network
- `192.168.1.1` → Your router's IP (usually this)

**Save:** `Ctrl + X`, `Y`, `Enter`

### Step 10.3: Reboot

```bash
sudo reboot
```

**Wait 1 minute, then reconnect:**
```bash
ssh pi@192.168.1.100
```
(Use your static IP)

---

## ✅ VERIFICATION CHECKLIST

Run these commands to verify everything:

```bash
# 1. Check service is running
sudo systemctl status print-station

# 2. Check printer is ready
lpstat -t

# 3. Check network connection
ping -c 3 arteva-maison-backend.onrender.com

# 4. View recent logs
sudo journalctl -u print-station -n 50

# 5. Check disk space
df -h /
```

**All should show OK/Success!**

---

## 🎉 YOU'RE DONE!

Your print station is now:
- ✅ Running 24/7 automatically
- ✅ Connected to your backend via WebSocket
- ✅ Will print receipts instantly when orders arrive
- ✅ Will auto-start after power outages
- ✅ Matches your backend receipt format exactly
- ✅ Requires ZERO manual intervention

---

## 📱 Daily Operations

### What You Need to Do:
1. **Keep printer loaded with paper**
2. **That's it!**

### What Happens Automatically:
1. Customer places order
2. Backend sends notification
3. Print station receives it (< 1 second)
4. Prints receipt automatically
5. Prints shipping label automatically
6. Prints packing slip automatically
7. Ready for next order

**NO confirmations, NO button clicks, NO manual actions!**

---

## 🔧 Useful Commands

### View Live Activity
```bash
ssh pi@printstation.local
sudo journalctl -u print-station -f
```

### Check Status
```bash
sudo systemctl status print-station
```

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

### Test Printer
```bash
echo "Test" | lpr -P receipt-printer
```

### Check Printer Queue
```bash
lpstat -t
```

### Clear Print Queue
```bash
cancel -a
```

---

## 🆘 Troubleshooting

### Can't SSH into Raspberry Pi
```bash
# Try IP address instead
ssh pi@192.168.1.XXX

# Check if Pi is on network
ping printstation.local
```

### Printer Not Working
```bash
# Check if detected
lsusb

# Check printer status
lpstat -t

# Restart CUPS
sudo systemctl restart cups

# Check device
ls -la /dev/usb/lp*
```

### Service Won't Start
```bash
# Check logs
sudo journalctl -u print-station -n 100

# Test manually
cd ~/print-station
node print-station.js

# Check configuration
cat ~/print-station/.env
```

### No Orders Printing
```bash
# Check if connected
sudo journalctl -u print-station -n 50 | grep "Connected"

# Check API key
cat ~/print-station/.env | grep API_KEY

# Test with test mode
cd ~/print-station
TEST_MODE=true node print-station.js
```

### Out of Space
```bash
# Check space
df -h

# Clean logs
sudo journalctl --vacuum-time=7d

# Clean npm cache
npm cache clean --force
```

---

## 🔄 Update Print Station

When you have new code:

```powershell
# On your computer
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"
scp print-station.js pi@printstation.local:~/print-station/
```

```bash
# On Raspberry Pi
ssh pi@printstation.local
sudo systemctl restart print-station
```

---

## 💾 Backup Configuration

Save your configuration:

```powershell
# On your computer
scp pi@printstation.local:~/print-station/.env ./print-station-backup.env
```

---

## 🎯 Success Indicators

You'll know it's working when:

1. ✅ Service status shows "active (running)"
2. ✅ Logs show "✓ Connected to backend"
3. ✅ Logs show "✓ Listening for new orders..."
4. ✅ Test print works
5. ✅ Real orders print automatically
6. ✅ Survives reboot (auto-starts)

---

## 📞 Support

If stuck:
1. Check logs: `sudo journalctl -u print-station -n 100`
2. Test printer: `echo "test" | lpr`
3. Verify network: `ping arteva-maison-backend.onrender.com`
4. Check service: `sudo systemctl status print-station`
5. Review this guide from the beginning

---

## 🚀 Final Notes

- **Power outages**: Pi will auto-restart and resume printing
- **Network issues**: Will auto-reconnect when network returns
- **Printer errors**: Logged but won't crash the service
- **Missed orders**: Impossible - fallback polling ensures delivery
- **Maintenance**: Just keep paper loaded!

**Your print station is now a production-ready, enterprise-grade printing daemon!** 🎉
