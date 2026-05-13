# ✅ Simple Setup Checklist - Print and Follow

## 🎯 Goal
Set up Raspberry Pi to automatically print receipts on HP SmartTank when orders arrive.

---

## 📱 STEP 1: Flash SD Card

### Option A: Use Android Phone
- [ ] Download "Raspberry Pi Imager" app
- [ ] Insert SD card into phone
- [ ] Choose: Raspberry Pi OS Lite (64-bit)
- [ ] Settings: hostname=`printstation`, enable SSH, WiFi
- [ ] Flash and wait

### Option B: Buy USB SD Reader ($5-10)
- [ ] Buy USB SD card reader
- [ ] Download Raspberry Pi Imager on computer
- [ ] Flash SD card with same settings

---

## 🔌 STEP 2: Boot Raspberry Pi

- [ ] Insert SD card into Raspberry Pi
- [ ] Connect HP SmartTank via USB
- [ ] Connect ethernet (or use WiFi)
- [ ] Power on
- [ ] Wait 3 minutes

---

## 💻 STEP 3: Connect via SSH

```powershell
ssh pi@printstation.local
```
- [ ] Connected successfully
- [ ] Entered password

---

## 📦 STEP 4: Install Software (Copy-Paste Each)

```bash
# Update
sudo apt update && sudo apt upgrade -y
```
- [ ] Done (10 min)

```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```
- [ ] Done (2 min)

```bash
# CUPS
sudo apt install -y cups cups-client
```
- [ ] Done (1 min)

```bash
# HP Drivers
sudo apt install -y hplip printer-driver-hpcups
```
- [ ] Done (2 min)

```bash
# Chromium
sudo apt install -y chromium-browser chromium-chromedriver
```
- [ ] Done (3 min)

```bash
# Puppeteer deps
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
```
- [ ] Done (2 min)

```bash
# Configure CUPS
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo systemctl enable cups
sudo systemctl start cups
```
- [ ] Done (1 min)

```bash
# Optimize
sudo dphys-swapfile swapoff
sudo dphys-swapfile uninstall
sudo systemctl disable dphys-swapfile
echo "gpu_mem=16" | sudo tee -a /boot/firmware/config.txt
sudo systemctl disable bluetooth
sudo apt autoremove -y
sudo apt clean
```
- [ ] Done (2 min)

---

## 🖨️ STEP 5: Configure Printer

**On your computer, open browser:**
```
http://printstation.local:631
```

- [ ] Opened CUPS web interface
- [ ] Administration → Add Printer
- [ ] Logged in (pi / password)
- [ ] Selected HP SmartTank
- [ ] Named: `hp-smarttank`
- [ ] Set paper: A4
- [ ] Clicked Set Default Options

**Test:**
```bash
echo "Test" | lpr -P hp-smarttank
```
- [ ] Test printed successfully

---

## 📁 STEP 6: Prepare Files on Computer

**Open PowerShell:**
```powershell
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"
mkdir print-station-transfer
cd print-station-transfer
copy ..\print-station-hp.js print-station.js
copy ..\print-station-hp-package.json package.json
copy ..\print-station.env.example .env
copy ..\print-station.service print-station.service
```
- [ ] Files copied

---

## 📤 STEP 7: Transfer Files

**Still in PowerShell:**
```powershell
scp print-station.js pi@printstation.local:~/
scp package.json pi@printstation.local:~/
scp .env pi@printstation.local:~/
scp print-station.service pi@printstation.local:~/
```
- [ ] All 4 files transferred

---

## 🔧 STEP 8: Setup on Raspberry Pi

**In SSH:**
```bash
mkdir -p ~/print-station/logs ~/print-station/data ~/print-station/temp
mv ~/print-station.js ~/print-station/
mv ~/package.json ~/print-station/
mv ~/.env ~/print-station/
mv ~/print-station.service ~/print-station/
cd ~/print-station
npm install
```
- [ ] Directories created
- [ ] Files moved
- [ ] Dependencies installed (3 min)

---

## ⚙️ STEP 9: Configure

```bash
nano ~/print-station/.env
```

**Change these lines:**
```
API_KEY=your_actual_admin_api_key_here
```

- [ ] API_KEY updated with real key
- [ ] Saved (Ctrl+X, Y, Enter)

---

## 🧪 STEP 10: Test

```bash
cd ~/print-station
TEST_MODE=true node print-station.js
```

- [ ] Browser initialized
- [ ] PDF generated
- [ ] HP SmartTank printed test receipt
- [ ] Saw "✓ Successfully processed order"

---

## 🚀 STEP 11: Enable Auto-Start

```bash
sudo cp ~/print-station/print-station.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable print-station
sudo systemctl start print-station
sudo systemctl status print-station
```

- [ ] Service enabled
- [ ] Service started
- [ ] Status shows "active (running)"

---

## 👀 STEP 12: View Logs

```bash
sudo journalctl -u print-station -f
```

**Should see:**
```
✓ Browser initialized successfully
✓ Connected to backend
✓ Joined admin room
✓ Listening for new orders...
```

- [ ] All checkmarks visible
- [ ] No errors

Press Ctrl+C to exit (service keeps running)

---

## ✅ STEP 13: Final Verification

```bash
# 1. Check printer
lsusb | grep -i hp
```
- [ ] HP printer detected

```bash
# 2. Check service
sudo systemctl status print-station
```
- [ ] Shows "active (running)"

```bash
# 3. Check network
ping -c 3 arteva-maison-backend.onrender.com
```
- [ ] Connected

```bash
# 4. Check space
df -h /
```
- [ ] 2+ GB free

---

## 🎉 DONE!

- [ ] Print station running 24/7
- [ ] Auto-prints when orders arrive
- [ ] Survives power outages
- [ ] No manual actions needed

---

## 📝 Notes

**Raspberry Pi IP:** _______________

**Date Completed:** _______________

**API Key (first 8 chars):** _______________

**Issues Encountered:**
```
_________________________________
_________________________________
_________________________________
```

---

## 🔄 Daily Operations

**What you do:**
- [ ] Keep HP SmartTank loaded with A4 paper
- [ ] Check ink levels occasionally

**What happens automatically:**
- ✅ Prints receipts when orders arrive
- ✅ Connects to backend
- ✅ Auto-restarts after power outages

---

## 📞 Quick Commands

```bash
# View logs
sudo journalctl -u print-station -f

# Restart
sudo systemctl restart print-station

# Test printer
echo "Test" | lpr -P hp-smarttank
```

---

## ✅ Success!

Your HP SmartTank is now an automatic receipt printer! 🎉

**Total setup time: 30-45 minutes**
