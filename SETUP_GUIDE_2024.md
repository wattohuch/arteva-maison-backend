# 🎯 RASPBERRY PI PRINT STATION - COMPLETE SETUP GUIDE
## Automatic Receipt Printing with HP SmartTank (Updated May 2024)

**What This Does:** When a customer orders on your website, your HP SmartTank printer automatically prints a receipt. No buttons, no clicks, completely automatic.

**Time Required:** 1-2 hours (first time)

**Cost:** $5-10 (USB SD card reader only)

---

## 📦 WHAT YOU NEED

### You Already Have:
- ✅ Raspberry Pi 4 or 5
- ✅ 8GB microSD card
- ✅ HP SmartTank printer
- ✅ USB cable (for printer)
- ✅ Ethernet cable OR WiFi
- ✅ Power adapter for Raspberry Pi

### You Need to Buy:
- ❌ **USB SD Card Reader** - $5-10 from any electronics store

---

## 🚀 PART 1: PREPARE YOUR COMPUTER (10 minutes)

### Step 1: Download Raspberry Pi Imager

**On your Windows computer:**

1. Open browser
2. Go to: https://www.raspberrypi.com/software/
3. Click **"Download for Windows"**
4. Wait for download (takes 1-2 minutes)
5. Double-click the downloaded file
6. Click **"Install"**
7. Click **"Finish"**

✅ **Raspberry Pi Imager installed!**

---

### Step 2: Buy USB SD Card Reader

1. Go to any electronics store
2. Ask for: **"USB SD card reader"**
3. Cost: $5-10
4. Buy it and come back

✅ **USB SD card reader purchased!**

---

### Step 3: Flash SD Card

**Insert SD card into USB reader, plug into computer:**

1. Open **"Raspberry Pi Imager"** (from Start menu)
2. Click **"CHOOSE DEVICE"**
   - Select: **"Raspberry Pi 4"** (or **"Raspberry Pi 5"** if you have that)
3. Click **"CHOOSE OS"**
   - Click: **"Raspberry Pi OS (other)"**
   - Select: **"Raspberry Pi OS Lite (64-bit)"**
   - ⚠️ **IMPORTANT:** Must be **64-bit**, NOT 32-bit!
4. Click **"CHOOSE STORAGE"**
   - Select your SD card (usually 8GB)
5. Click **⚙️ Settings** (gear icon at bottom right)
6. Fill in these settings:

```
General Tab:
  Hostname: printstation
  Username: pi
  Password: [make up a password - WRITE IT DOWN!]
  
  ☑️ Configure wireless LAN
  SSID: [your WiFi name]
  Password: [your WiFi password]
  Wireless LAN country: KW
  
  Locale Settings:
  Time zone: Asia/Kuwait
  Keyboard layout: us

Services Tab:
  ☑️ Enable SSH
  ○ Use password authentication
```

7. Click **"SAVE"**
8. Click **"YES"** (to apply settings)
9. Click **"YES"** (to erase SD card)
10. Wait 10-15 minutes (it's writing to SD card)
11. When done, click **"CONTINUE"**
12. Remove SD card from USB reader

✅ **SD card ready!**

---

## 🔌 PART 2: SETUP HARDWARE (5 minutes)

1. **Insert SD card** into Raspberry Pi (bottom slot)
2. **Connect HP SmartTank** to Raspberry Pi with USB cable
3. **Connect ethernet cable** to Raspberry Pi (or use WiFi from Step 3)
4. **Plug in power** to Raspberry Pi
5. **Wait 3 minutes** (Raspberry Pi is booting)

✅ **Hardware connected!**

---

## 💻 PART 3: CONNECT TO RASPBERRY PI (5 minutes)

### Step 1: Open PowerShell

**On your Windows computer:**

1. Press **Windows key + X**
2. Click **"Windows PowerShell"** or **"Terminal"**
3. A black window opens

### Step 2: Connect via SSH

**Type this command and press Enter:**

```powershell
ssh pi@printstation.local
```

**What happens:**
- It might ask: `Are you sure you want to continue connecting?`
- Type: **yes** and press Enter
- It asks for password
- Type the password you created in Part 1, Step 3
- Press Enter

**You should see:**
```
pi@printstation:~ $
```

✅ **Connected to Raspberry Pi!**

---

## 📥 PART 4: INSTALL SOFTWARE (30 minutes)

**Copy-paste these commands ONE BY ONE into the SSH window.**

**Press Enter after each command and wait for it to finish.**

---

### Command 1: Update System (10 minutes)

```bash
sudo apt update && sudo apt upgrade -y
```

**Wait:** This takes 10 minutes. You'll see lots of text scrolling.

---

### Command 2: Install Node.js (3 minutes)

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

**Wait:** 2-3 minutes.

---

### Command 3: Verify Node.js

```bash
node --version
```

**Should show:** `v18.x.x` (any version starting with 18)

---

### Command 4: Install Printing System (3 minutes)

```bash
sudo apt install -y cups cups-client
```

**Wait:** 2-3 minutes.

---

### Command 5: Install HP Printer Drivers (3 minutes)

```bash
sudo apt install -y hplip printer-driver-hpcups
```

**Wait:** 2-3 minutes.

---

### Command 6: Install Chromium Browser (5 minutes)

```bash
sudo apt install -y chromium-browser chromium-chromedriver
```

**Wait:** 4-5 minutes.

---

### Command 7: Install Puppeteer Dependencies (3 minutes)

```bash
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
```

**Wait:** 2-3 minutes.

---

### Command 8: Configure CUPS (1 minute)

```bash
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo systemctl enable cups
sudo systemctl start cups
```

**Wait:** 30 seconds.

---

### Command 9: Optimize System (2 minutes)

```bash
sudo dphys-swapfile swapoff
sudo dphys-swapfile uninstall
sudo systemctl disable dphys-swapfile
echo "gpu_mem=16" | sudo tee -a /boot/firmware/config.txt
sudo systemctl disable bluetooth
sudo apt autoremove -y
sudo apt clean
```

**Wait:** 1-2 minutes.

✅ **All software installed!**

---

## 🖨️ PART 5: SETUP PRINTER (10 minutes)

### Step 1: Check Printer is Connected

**In SSH window, type:**

```bash
lsusb | grep -i hp
```

**Should show:** Something like `Hewlett-Packard HP Smart Tank`

**If nothing shows:**
- Check USB cable is connected
- Check printer is turned on
- Unplug and replug USB cable
- Try command again

---

### Step 2: Open CUPS Web Interface

**On your Windows computer (not SSH), open browser:**

Go to: **http://printstation.local:631**

**If page doesn't load:**
- Try: **http://192.168.1.XXX:631** (find IP with `hostname -I` in SSH)

---

### Step 3: Add Printer in CUPS

1. Click **"Administration"** tab
2. Click **"Add Printer"** button
3. Login popup appears:
   - Username: **pi**
   - Password: [your password from Part 1]
4. Select **"HP Smart Tank"** from the list
5. Click **"Continue"**
6. Settings page:
   - Name: **hp-smarttank** (exactly this, no spaces)
   - Description: HP SmartTank Printer
   - ☑️ Check **"Share This Printer"**
7. Click **"Continue"**
8. Select driver: **"HP Smart Tank"** or **"HP DeskJet"**
9. Click **"Add Printer"**
10. Set default options:
    - Media Size: **A4**
    - Print Quality: **Normal**
11. Click **"Set Default Options"**

✅ **Printer added!**

---

### Step 4: Test Printer

**Back in SSH window:**

```bash
echo "Test Print from Raspberry Pi" | lpr -P hp-smarttank
```

**Did your HP SmartTank print "Test Print from Raspberry Pi"?**

- ✅ **YES** → Continue to next part
- ❌ **NO** → Check:
  - Printer has paper
  - Printer has ink
  - Printer is turned on
  - USB cable connected
  - Try test print command again

---

## 📁 PART 6: COPY FILES TO RASPBERRY PI (10 minutes)

### Step 1: Prepare Files on Your Computer

**Open NEW PowerShell window (keep SSH window open):**

```powershell
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"
```

---

### Step 2: Transfer Files

**Copy-paste these commands ONE BY ONE:**

```powershell
scp print-station-hp.js pi@printstation.local:~/
```
Enter password, wait for upload.

```powershell
scp print-station-hp-package.json pi@printstation.local:~/package.json
```
Enter password, wait for upload.

```powershell
scp print-station.env.example pi@printstation.local:~/.env
```
Enter password, wait for upload.

```powershell
scp print-station.service pi@printstation.local:~/
```
Enter password, wait for upload.

✅ **Files transferred!**

---

## 🔧 PART 7: SETUP PRINT STATION (10 minutes)

**Back in SSH window:**

### Step 1: Create Folders

```bash
mkdir -p ~/print-station/logs
mkdir -p ~/print-station/data
mkdir -p ~/print-station/temp
```

---

### Step 2: Move Files

```bash
mv ~/print-station-hp.js ~/print-station/
mv ~/package.json ~/print-station/
mv ~/.env ~/print-station/
mv ~/print-station.service ~/print-station/
```

---

### Step 3: Install Dependencies (5 minutes)

```bash
cd ~/print-station
npm install
```

**Wait:** 4-5 minutes. You'll see packages being installed.

✅ **Print station installed!**

---

## 🔑 PART 8: GET API KEY (3 minutes)

### On Your Computer:

1. Open browser
2. Go to: **https://www.artevamaisonkw.com**
3. Login to **admin dashboard**
4. Press **F12** on keyboard (opens Developer Tools)
5. Click **"Console"** tab at the top
6. Type this command and press Enter:

```javascript
localStorage.getItem('token')
```

7. You'll see a long text like: `"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."`
8. **Copy this entire text** (without the quotes)
9. **Save it somewhere** (Notepad)

✅ **API key copied!**

---

## ⚙️ PART 9: CONFIGURE PRINT STATION (5 minutes)

**Back in SSH window:**

### Step 1: Edit Configuration

```bash
nano ~/print-station/.env
```

---

### Step 2: Update API Key

**You'll see a file with settings. Find this line:**

```
API_KEY=your_actual_admin_api_key_here
```

**Replace `your_actual_admin_api_key_here` with your API key from Part 8.**

**Use arrow keys to move cursor, Delete/Backspace to delete, then paste your API key.**

**Should look like:**
```
API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### Step 3: Verify Other Settings

**Make sure these are correct:**

```
API_URL=https://arteva-maison-backend.onrender.com
PRINTER_NAME=hp-smarttank
PAPER_SIZE=A4
PRINT_RECEIPT=true
```

---

### Step 4: Save and Exit

1. Press **Ctrl + X**
2. Press **Y** (yes, save)
3. Press **Enter**

✅ **Configuration saved!**

---

## 🧪 PART 10: TEST PRINT STATION (3 minutes)

**In SSH window:**

```bash
cd ~/print-station
TEST_MODE=true node print-station-hp.js
```

**What should happen:**

1. You see logs in terminal:
```
========================================
🖨️  Arteva Maison Print Station
    HP SmartTank Edition
========================================
✓ Browser initialized successfully
```

2. **HP SmartTank prints a test receipt!**

3. You see:
```
✓ Printed receipt for order TEST-001
✓ Successfully processed order TEST-001
```

**Did it print?**
- ✅ **YES** → Perfect! Press Ctrl+C to stop, continue to next part
- ❌ **NO** → Check errors in terminal, verify API_KEY, printer name

---

## 🚀 PART 11: ENABLE AUTO-START (3 minutes)

**This makes print station start automatically when Raspberry Pi boots!**

### Copy-paste these commands:

```bash
sudo cp ~/print-station/print-station.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable print-station
```

```bash
sudo systemctl start print-station
```

---

### Check Status:

```bash
sudo systemctl status print-station
```

**Should show:**
```
● print-station.service - Arteva Maison Print Station - HP SmartTank
   Loaded: loaded (/etc/systemd/system/print-station.service; enabled)
   Active: active (running) since ...
```

**Look for:**
- `enabled` ✅
- `active (running)` ✅

Press **Q** to exit.

---

### View Live Logs:

```bash
sudo journalctl -u print-station -f
```

**Should show:**
```
✓ Browser initialized successfully
✓ Connected to backend (Socket ID: ...)
✓ Joined admin room for order notifications
✓ Print station running
✓ Listening for new orders...
```

Press **Ctrl + C** to exit (service keeps running in background).

✅ **Auto-start enabled!**

---

## 🎉 PART 12: FINAL TEST (5 minutes)

### Test 1: Reboot Test

**In SSH:**

```bash
sudo reboot
```

**Raspberry Pi will restart. Wait 2 minutes.**

**Connect again:**

```powershell
ssh pi@printstation.local
```

**Check if service started automatically:**

```bash
sudo systemctl status print-station
```

**Should show:** `active (running)` ✅

---

### Test 2: Real Order Test

1. Go to your website: **https://www.artevamaisonkw.com**
2. **Place a test order** (use any product)
3. **Wait 5-10 seconds**
4. **HP SmartTank should print receipt automatically!**

**Check the printed receipt:**
- ✅ Order details correct
- ✅ Customer info correct
- ✅ Items listed correctly
- ✅ Totals correct
- ✅ **QR code at bottom** (scan it with phone!)
- ✅ Everything fits on **1 A4 page**

---

### Test 3: QR Code Test

1. Take out your phone
2. Open camera app
3. Point at QR code on printed receipt
4. Tap notification that appears
5. **Should open digital receipt in browser!**

✅ **Everything works!**

---

## 🎯 WHAT HAPPENS NOW

### Automatic Printing:
```
Customer orders → Backend notifies → Raspberry Pi receives → HP SmartTank prints
```

**Time:** 5-10 seconds from order to printed receipt

**No manual actions needed!**

---

### Auto-Start on Boot:
```
Power on → Raspberry Pi boots (30 sec) → Print station starts (10 sec) → Ready!
```

**Total:** 40 seconds from power on to ready

---

### Auto-Restart on Crash:
```
Service crashes → Waits 10 seconds → Restarts automatically → Ready!
```

**Self-healing system!**

---

## 📋 DAILY OPERATIONS

### What You Do:
- Keep HP SmartTank loaded with A4 paper
- Check ink levels occasionally
- That's it!

### What Happens Automatically:
- Prints receipts when orders arrive
- Runs 24/7
- Restarts after power outages
- Never misses an order
- Logs everything for debugging

---

## 🔧 USEFUL COMMANDS

### Connect to Raspberry Pi:
```bash
ssh pi@printstation.local
```

### Check if Print Station is Running:
```bash
sudo systemctl status print-station
```

### View Live Logs:
```bash
sudo journalctl -u print-station -f
```
(Press Ctrl+C to exit)

### Restart Print Station:
```bash
sudo systemctl restart print-station
```

### Stop Print Station:
```bash
sudo systemctl stop print-station
```

### Start Print Station:
```bash
sudo systemctl start print-station
```

### Test Printer:
```bash
echo "Test" | lpr -P hp-smarttank
```

---

## 🆘 TROUBLESHOOTING

### Can't Connect via SSH?

**Try:**
```powershell
ssh pi@192.168.1.XXX
```
(Find IP from your router)

---

### Print Station Not Running?

**Check logs:**
```bash
sudo journalctl -u print-station -n 50
```

**Try manual start:**
```bash
cd ~/print-station
node print-station-hp.js
```

---

### Printer Not Working?

**Check printer status:**
```bash
lpstat -p hp-smarttank
```

**Restart CUPS:**
```bash
sudo systemctl restart cups
```

**Check USB connection:**
```bash
lsusb | grep -i hp
```

---

### Backend Connection Failed?

**Test backend:**
```bash
curl https://arteva-maison-backend.onrender.com/health
```

**Should return:** `{"status":"ok"}`

---

### Wrong API Key?

**Edit configuration:**
```bash
nano ~/print-station/.env
```

**Update API_KEY, save (Ctrl+X, Y, Enter), restart:**
```bash
sudo systemctl restart print-station
```

---

## ✅ SUCCESS CHECKLIST

- [ ] USB SD card reader purchased
- [ ] SD card flashed with 64-bit Raspberry Pi OS
- [ ] Raspberry Pi boots successfully
- [ ] Can connect via SSH
- [ ] All software installed (Node.js, CUPS, Chromium)
- [ ] HP SmartTank configured in CUPS
- [ ] Test print works
- [ ] Files transferred to Raspberry Pi
- [ ] Dependencies installed (npm install)
- [ ] API key configured in .env
- [ ] Test mode prints successfully
- [ ] Auto-start enabled
- [ ] Service shows "active (running)"
- [ ] Reboot test passed
- [ ] Real order prints automatically
- [ ] QR code scans correctly
- [ ] Receipt fits on 1 A4 page

---

## 🎊 CONGRATULATIONS!

**You did it! Your automatic receipt printing system is complete!**

### What You Built:
- ✅ Automatic receipt printing
- ✅ QR code for digital receipts
- ✅ Single-page A4 receipts
- ✅ Auto-start on boot
- ✅ Self-healing system
- ✅ 24/7 operation

### Total Cost:
- **$5-10** (USB SD card reader only)

### Total Time:
- **1-2 hours** (first time setup)

### Result:
**Professional, automatic, reliable receipt printing!**

---

## 📞 NEED HELP?

### Check Logs:
```bash
ssh pi@printstation.local
sudo journalctl -u print-station -f
```

### Contact Support:
- WhatsApp: +96550683207
- Email: support@artevamaisonkw.com

---

**🎉 ENJOY YOUR AUTOMATIC RECEIPT PRINTING SYSTEM! 🎉**

**When customer orders → Receipt prints automatically → Customer scans QR code → Opens digital receipt!**

**No buttons, no clicks, just magic!** ✨
