# 🚀 Complete Setup WITHOUT SD Card Reader

## Your Situation
- ❌ No SD card reader on computer
- ✅ Have smartphone (Android or iPhone)
- ✅ Have HP SmartTank printer
- ✅ Have Raspberry Pi 4 or 5
- ✅ Have 8GB MicroSD card

---

## 📱 PART 1: Flash SD Card Using Your Phone

### Option A: Android Phone (Recommended)

**Step 1: Download App**
1. Open Google Play Store
2. Search: **"Raspberry Pi Imager"** or **"Etcher"**
3. Install **"Raspberry Pi Imager"** (official app)

**Step 2: Insert SD Card**
1. Insert MicroSD card into phone (use adapter if needed)
2. Or use USB-C SD card reader for phone

**Step 3: Flash OS**
1. Open Raspberry Pi Imager app
2. Choose Device: **Raspberry Pi 4** or **5**
3. Choose OS: **Raspberry Pi OS Lite (64-bit)**
4. Choose Storage: Your SD card
5. Click Settings (⚙️):
   - Hostname: `printstation`
   - Username: `pi`
   - Password: [your password]
   - WiFi: [your network name and password]
   - Enable SSH: ✓
   - Timezone: Asia/Kuwait
6. Click Write
7. Wait 10-15 minutes

### Option B: iPhone (Alternative)

**iPhones can't flash SD cards directly. Use these alternatives:**

1. **Borrow a laptop/computer** for 15 minutes
2. **Use a friend's Android phone**
3. **Buy USB SD card reader** ($5-10) - works with your computer

### Option C: No Phone Option

**Buy a USB SD Card Reader:**
- Cost: $5-10
- Available at: Any electronics store
- Plug into your computer USB port
- Then use Raspberry Pi Imager on computer

---

## 💻 PART 2: Alternative - Use Computer with USB SD Reader

If you buy a USB SD card reader:

**Step 1: Buy USB SD Card Reader**
- Any USB SD card reader works
- Plug into your computer

**Step 2: Download Raspberry Pi Imager**
- Go to: https://www.raspberrypi.com/software/
- Download for Windows
- Install and run

**Step 3: Flash SD Card**
1. Insert SD card into USB reader
2. Plug USB reader into computer
3. Open Raspberry Pi Imager
4. Choose Device: Raspberry Pi 4 or 5
5. Choose OS: Raspberry Pi OS Lite (64-bit)
6. Choose Storage: Your SD card
7. Click Settings (⚙️):
   ```
   Hostname: printstation
   Username: pi
   Password: [choose strong password]
   WiFi SSID: [your WiFi name]
   WiFi Password: [your WiFi password]
   WiFi Country: KW
   Timezone: Asia/Kuwait
   Keyboard: us
   Enable SSH: ✓ Use password authentication
   ```
8. Click Save
9. Click Write
10. Wait 5-10 minutes
11. Eject SD card safely

---

## 🔌 PART 3: First Boot

**Step 1: Hardware Setup**
1. Remove SD card from phone/reader
2. Insert SD card into Raspberry Pi
3. Connect HP SmartTank printer via USB
4. Connect ethernet cable (or use WiFi)
5. Power on Raspberry Pi
6. Wait 3 minutes for first boot

**Step 2: Find Raspberry Pi**

**Option A: Use hostname**
```
printstation.local
```

**Option B: Check your router**
- Log into router admin
- Look for device "printstation"
- Note IP address (e.g., 192.168.1.150)

**Option C: Use phone app**
- Android: Install "Fing" app
- Scan network
- Look for "Raspberry Pi"

---

## 🖥️ PART 4: Connect via SSH

**From Windows Computer:**

1. Press `Win + X`
2. Select "Windows PowerShell" or "Terminal"
3. Type:
```powershell
ssh pi@printstation.local
```

4. If asked "Are you sure?", type: `yes`
5. Enter your password
6. You're now connected! ✅

**If hostname doesn't work:**
```powershell
ssh pi@192.168.1.XXX
```
(Replace XXX with IP from router)

---

## 📦 PART 5: Install All Required Software

**Copy and paste these commands ONE BY ONE:**

### Step 5.1: Update System
```bash
sudo apt update && sudo apt upgrade -y
```
⏱️ Takes 5-10 minutes

### Step 5.2: Install Node.js 18
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

**Verify:**
```bash
node --version
```
Should show: `v18.x.x`

### Step 5.3: Install CUPS (Printing System)
```bash
sudo apt install -y cups cups-client
```

### Step 5.4: Install HP SmartTank Drivers
```bash
sudo apt install -y hplip printer-driver-hpcups
```

### Step 5.5: Install Chromium for HTML Rendering
```bash
sudo apt install -y chromium-browser chromium-chromedriver
```

### Step 5.6: Install Puppeteer Dependencies
```bash
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
```

### Step 5.7: Configure CUPS
```bash
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo cupsctl --share-printers
sudo systemctl enable cups
sudo systemctl start cups
```

### Step 5.8: Optimize for 8GB SD Card
```bash
# Disable swap
sudo dphys-swapfile swapoff
sudo dphys-swapfile uninstall
sudo systemctl disable dphys-swapfile

# Reduce GPU memory
echo "gpu_mem=16" | sudo tee -a /boot/firmware/config.txt

# Disable unnecessary services
sudo systemctl disable bluetooth
sudo systemctl disable hciuart

# Clean up
sudo apt autoremove -y
sudo apt clean
```

### Step 5.9: Check Space
```bash
df -h /
```
Should have 2-3 GB free

---

## 🖨️ PART 6: Configure HP SmartTank Printer

### Step 6.1: Check if Printer Detected
```bash
lsusb | grep -i hp
```
Should show: "Hewlett-Packard" or "HP Smart Tank"

### Step 6.2: Add Printer via CUPS

**On your computer (not SSH), open browser:**
```
http://printstation.local:631
```

Or use IP:
```
http://192.168.1.XXX:631
```

**Steps:**
1. Click **"Administration"**
2. Click **"Add Printer"**
3. Login:
   - Username: `pi`
   - Password: [your password]
4. Select your **HP SmartTank** from list
5. Click **"Continue"**
6. Settings:
   - Name: `hp-smarttank`
   - Description: `HP SmartTank Printer`
   - ☑ Share This Printer
7. Click **"Continue"**
8. Driver: Select **"HP SmartTank"** or **"HP DeskJet"**
9. Click **"Add Printer"**
10. Set paper size: **A4** or **Letter**
11. Click **"Set Default Options"**

### Step 6.3: Test Printer

**Back in SSH:**
```bash
echo "Test Print from Raspberry Pi" | lpr -P hp-smarttank
```

**Did it print?**
- ✅ YES → Continue
- ❌ NO → Check printer is on, has paper, USB connected

---

## 📁 PART 7: Prepare Files on Your Computer

**On your Windows computer, open PowerShell:**

```powershell
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"
```

**Create a transfer directory:**
```powershell
mkdir print-station-transfer
cd print-station-transfer
```

**Copy the correct files:**
```powershell
# Copy HP SmartTank script
copy ..\print-station-hp.js print-station.js

# Copy HP package.json
copy ..\print-station-hp-package.json package.json

# Copy environment template
copy ..\print-station.env.example .env

# Copy service file
copy ..\print-station.service print-station.service
```

---

## 📤 PART 8: Transfer Files to Raspberry Pi

**Still in PowerShell on your computer:**

```powershell
# Transfer all files at once
scp print-station.js pi@printstation.local:~/
scp package.json pi@printstation.local:~/
scp .env pi@printstation.local:~/
scp print-station.service pi@printstation.local:~/
```

**Enter your password when prompted (4 times, once per file)**

---

## 🔧 PART 9: Setup Print Station on Raspberry Pi

**Back in SSH terminal:**

### Step 9.1: Create Directories
```bash
mkdir -p ~/print-station/logs
mkdir -p ~/print-station/data
mkdir -p ~/print-station/temp
```

### Step 9.2: Move Files
```bash
mv ~/print-station.js ~/print-station/
mv ~/package.json ~/print-station/
mv ~/.env ~/print-station/
mv ~/print-station.service ~/print-station/
```

### Step 9.3: Install Dependencies
```bash
cd ~/print-station
npm install
```
⏱️ Takes 2-3 minutes

---

## ⚙️ PART 10: Configure Print Station

### Step 10.1: Edit Configuration
```bash
nano ~/print-station/.env
```

### Step 10.2: Update These Lines

**Find and change:**
```bash
API_URL=https://arteva-maison-backend.onrender.com
API_KEY=your_actual_admin_api_key_here

SOCKET_URL=https://arteva-maison-backend.onrender.com

PRINTER_NAME=hp-smarttank
PRINTER_TYPE=HP
PAPER_SIZE=A4

PRINT_RECEIPT=true
PRINT_LABEL=true
PRINT_PACKING=true

PRINT_STATION_ID=ps-hp-smarttank
```

**IMPORTANT:** Replace `your_actual_admin_api_key_here` with your real API key!

**Save and exit:**
- Press `Ctrl + X`
- Press `Y`
- Press `Enter`

---

## 🧪 PART 11: Test Print Station

```bash
cd ~/print-station
TEST_MODE=true node print-station.js
```

**What should happen:**
1. You see logs in terminal
2. Browser initializes
3. PDF generates
4. HP SmartTank prints test receipt on A4 paper
5. You see: "✓ Successfully processed order"

**Did it work?**
- ✅ YES → Continue to next step
- ❌ NO → Check errors in output

**Common issues:**
```bash
# If printer error
lpstat -t

# If browser error
chromium-browser --version

# If API error
cat ~/print-station/.env | grep API_KEY
```

---

## 🚀 PART 12: Enable Auto-Start (Survives Power Outages)

### Step 12.1: Install Service
```bash
sudo cp ~/print-station/print-station.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### Step 12.2: Enable and Start
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

Press `Q` to exit

### Step 12.3: View Live Logs
```bash
sudo journalctl -u print-station -f
```

**You should see:**
```
✓ Browser initialized successfully
🔌 Connecting to backend
✓ Connected to backend
✓ Joined admin room
✓ Print station running
✓ Listening for new orders...
```

**Press `Ctrl + C` to stop viewing (service keeps running)**

---

## ✅ PART 13: Final Verification

Run these commands to verify everything:

```bash
# 1. Service running
sudo systemctl status print-station

# 2. Printer ready
lpstat -t

# 3. Network connected
ping -c 3 arteva-maison-backend.onrender.com

# 4. Recent logs
sudo journalctl -u print-station -n 20

# 5. Disk space
df -h /

# 6. Node version
node --version

# 7. Chromium installed
chromium-browser --version
```

**All should show OK!**

---

## 🎉 YOU'RE DONE!

Your print station is now:
- ✅ Running 24/7 automatically
- ✅ Connected to backend via WebSocket
- ✅ Will print receipts instantly when orders arrive
- ✅ Will auto-start after power outages
- ✅ Prints on HP SmartTank (A4 paper)
- ✅ Matches backend receipt format exactly

---

## 📋 Files You Transferred (Summary)

```
print-station.js          ← Main script (from print-station-hp.js)
package.json              ← Dependencies (from print-station-hp-package.json)
.env                      ← Configuration (from print-station.env.example)
print-station.service     ← Systemd service
```

---

## 🔄 Test with Real Order

1. Place a test order on your website
2. Watch the logs:
```bash
sudo journalctl -u print-station -f
```

3. You should see:
```
🆕 New order notification received: ORD-2026-XXX
📦 Processing order ORD-2026-XXX
Generating receipt for order ORD-2026-XXX
PDF generated: /home/pi/print-station/temp/receipt-ORD-2026-XXX.pdf
✓ Printed receipt for order ORD-2026-XXX
✓ Successfully processed order ORD-2026-XXX
```

4. HP SmartTank prints receipt automatically!

---

## 🆘 Troubleshooting

### Can't SSH into Raspberry Pi
```bash
# Try IP address
ssh pi@192.168.1.XXX

# Check if Pi is online
ping printstation.local
```

### Printer Not Working
```bash
# Check if detected
lsusb | grep -i hp

# Check printer status
lpstat -t

# Restart CUPS
sudo systemctl restart cups
```

### Service Won't Start
```bash
# Check logs
sudo journalctl -u print-station -n 50

# Test manually
cd ~/print-station
node print-station.js
```

### Browser/Puppeteer Error
```bash
# Check Chromium
chromium-browser --version

# Reinstall if needed
sudo apt install --reinstall chromium-browser
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

## 📞 Quick Commands Reference

```bash
# View logs
sudo journalctl -u print-station -f

# Restart service
sudo systemctl restart print-station

# Stop service
sudo systemctl stop print-station

# Start service
sudo systemctl start print-station

# Check status
sudo systemctl status print-station

# Test printer
echo "Test" | lpr -P hp-smarttank

# Check printer queue
lpstat -t
```

---

## 💾 Backup Your Configuration

**Save your .env file:**
```powershell
# On your computer
scp pi@printstation.local:~/print-station/.env ./print-station-backup.env
```

---

## 🔄 Update Print Station Later

When you have new code:

```powershell
# On your computer
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"
scp print-station-hp.js pi@printstation.local:~/print-station/print-station.js
```

```bash
# On Raspberry Pi
ssh pi@printstation.local
sudo systemctl restart print-station
```

---

## ✅ Success Checklist

- [ ] SD card flashed (using phone or USB reader)
- [ ] Raspberry Pi boots and connects to network
- [ ] Can SSH into Raspberry Pi
- [ ] All software installed (Node.js, CUPS, HPLIP, Chromium)
- [ ] HP SmartTank detected and configured in CUPS
- [ ] Test print works
- [ ] Files transferred to Raspberry Pi
- [ ] Dependencies installed (npm install)
- [ ] Configuration updated (.env with API_KEY)
- [ ] Test mode prints successfully
- [ ] Service enabled and running
- [ ] Logs show "Connected to backend"
- [ ] Logs show "Listening for new orders"
- [ ] Real order prints automatically
- [ ] Service survives reboot

---

## 🎯 What Happens Now

1. **Customer places order** on your website
2. **Backend receives order** and saves to database
3. **Backend emits Socket.io event** "new_order"
4. **Print station receives event** (< 1 second)
5. **Fetches receipt HTML** from backend
6. **Renders HTML to PDF** using Puppeteer
7. **Sends PDF to HP SmartTank**
8. **Prints on A4 paper** automatically
9. **Ready for next order**

**Total time: 5-10 seconds**

**NO manual actions needed!**

---

## 📱 SD Card Reader Options

If you need to buy one:

**USB SD Card Reader:**
- Cost: $5-10
- Works with any computer
- Plug and play

**USB-C SD Card Reader (for phone):**
- Cost: $10-15
- Works with Android phones
- Can flash SD cards on phone

**Where to buy:**
- Amazon
- Local electronics store
- Computer shop

---

**You're all set! Your HP SmartTank is now an automatic receipt printer!** 🎉
