# 🖨️ Print Station Setup for HP SmartTank Printer

## Overview

This guide is specifically for **HP SmartTank** inkjet printers (regular A4/Letter paper), not thermal receipt printers. The setup uses HTML-to-PDF printing to match your backend receipt format exactly.

## Key Differences

| Thermal Printer | HP SmartTank |
|----------------|--------------|
| 80mm receipt paper | A4/Letter paper |
| ESC/POS commands | HTML/PDF printing |
| Text-only formatting | Full HTML/CSS support |
| Continuous roll | Individual sheets |

## 🎯 What You'll Get

- ✅ Prints receipts on A4/Letter paper
- ✅ Exact match to backend receipt format (HTML)
- ✅ Auto-prints when orders arrive
- ✅ Survives power outages
- ✅ Zero manual intervention

---

## 📦 Hardware Requirements

- ✅ Raspberry Pi 4 or 5
- ✅ 8GB MicroSD card
- ✅ **HP SmartTank printer** (USB or Network)
- ✅ Power supply
- ✅ Ethernet or WiFi
- ❌ No display needed

---

## 🚀 Complete Setup Guide

### PART 1: Prepare SD Card (Same as Before)

Follow **COMPLETE_SETUP_GUIDE.md** Part 1 (Steps 1.1 - 1.2)

### PART 2: First Boot (Same as Before)

Follow **COMPLETE_SETUP_GUIDE.md** Part 2 (Steps 2.1 - 2.2)

### PART 3: Connect via SSH (Same as Before)

```bash
ssh pi@printstation.local
```

### PART 4: Install Required Software

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install CUPS
sudo apt install -y cups cups-client

# Install HP printer drivers (IMPORTANT!)
sudo apt install -y hplip printer-driver-hpcups

# Install Chromium for HTML rendering
sudo apt install -y chromium-browser chromium-chromedriver

# Install Puppeteer dependencies
sudo apt install -y \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2

# Configure CUPS
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo cupsctl --share-printers
sudo systemctl enable cups
sudo systemctl start cups

# Optimize for 8GB
sudo dphys-swapfile swapoff
sudo dphys-swapfile uninstall
sudo systemctl disable dphys-swapfile
echo "gpu_mem=16" | sudo tee -a /boot/firmware/config.txt
sudo systemctl disable bluetooth
sudo systemctl disable hciuart
sudo apt autoremove -y
sudo apt clean
```

### PART 5: Configure HP SmartTank Printer

#### Option A: USB Connection

```bash
# Check if printer is detected
lsusb | grep -i hp

# Should show something like: "Hewlett-Packard HP Smart Tank"
```

**Add printer via CUPS:**

1. Open browser: `http://printstation.local:631`
2. Administration → Add Printer
3. Login: username `pi`, your password
4. Select your **HP SmartTank** from USB devices
5. Click Continue
6. Name: `hp-smarttank`
7. ☑ Share This Printer
8. Click Continue
9. Driver: Select **HP SmartTank** model (or HP DeskJet if not listed)
10. Click Add Printer
11. Set paper size to **A4** or **Letter**
12. Click Set Default Options

#### Option B: Network Connection (WiFi/Ethernet)

```bash
# Find printer IP address (check printer display or router)
# Let's say it's: 192.168.1.50
```

**Add network printer:**

1. Open browser: `http://printstation.local:631`
2. Administration → Add Printer
3. Login: username `pi`, your password
4. Select **"Internet Printing Protocol (ipp)"** or **"HP Jetdirect"**
5. Connection: `ipp://192.168.1.50/ipp/print` (use your printer's IP)
6. Click Continue
7. Name: `hp-smarttank`
8. ☑ Share This Printer
9. Click Continue
10. Driver: Select **HP SmartTank** model
11. Click Add Printer
12. Set paper size to **A4** or **Letter**
13. Click Set Default Options

#### Test Printer

```bash
# Test print
echo "Test Print from Raspberry Pi" | lpr -P hp-smarttank

# Check status
lpstat -t
```

### PART 6: Install Print Station Software

```bash
# Create directory
mkdir -p ~/print-station/logs
mkdir -p ~/print-station/data
mkdir -p ~/print-station/temp
cd ~/print-station
```

**Transfer files from your computer:**

```powershell
# On your Windows computer
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"

scp print-station-hp.js pi@printstation.local:~/print-station/print-station.js
scp print-station-hp-package.json pi@printstation.local:~/print-station/package.json
scp print-station.env.example pi@printstation.local:~/print-station/.env
scp print-station.service pi@printstation.local:~/print-station/
```

**Install dependencies:**

```bash
cd ~/print-station
npm install
```

### PART 7: Configure Print Station

```bash
nano ~/print-station/.env
```

**Update configuration:**

```bash
# API Configuration
API_URL=https://arteva-maison-backend.onrender.com
API_KEY=your_actual_admin_api_key_here

# Socket.io Configuration
SOCKET_URL=https://arteva-maison-backend.onrender.com

# Printer Configuration
PRINTER_NAME=hp-smarttank
PRINTER_TYPE=HP
PAPER_SIZE=A4

# Print Options
PRINT_RECEIPT=true
PRINT_LABEL=true
PRINT_PACKING=true

# Print Station Identity
PRINT_STATION_ID=ps-hp-smarttank

# File Paths
LOG_FILE=./logs/print-station.log
STATE_FILE=./data/last-order.json
TEMP_DIR=./temp
```

Save: `Ctrl+X`, `Y`, `Enter`

### PART 8: Test Print Station

```bash
cd ~/print-station
TEST_MODE=true node print-station.js
```

**Should print a test receipt on A4 paper!**

### PART 9: Enable Auto-Start

```bash
sudo cp ~/print-station/print-station.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable print-station
sudo systemctl start print-station
sudo systemctl status print-station
```

**View logs:**

```bash
sudo journalctl -u print-station -f
```

---

## 📄 Receipt Format

The HP SmartTank will print:
- **Full HTML receipts** (matches backend exactly)
- **A4/Letter paper** (one receipt per page)
- **Professional formatting** with colors and styling
- **QR codes** for order tracking

---

## 🔧 Troubleshooting

### HP Printer Not Detected

```bash
# Check USB connection
lsusb | grep -i hp

# Check HPLIP
hp-check

# Install missing dependencies
sudo apt install -y hplip-gui

# Run HP setup
sudo hp-setup -i
```

### Network Printer Not Working

```bash
# Test connection
ping 192.168.1.50  # Your printer IP

# Check if printer is online
lpstat -t

# Restart CUPS
sudo systemctl restart cups
```

### Chromium Issues

```bash
# Check Chromium
chromium-browser --version

# Test Puppeteer
cd ~/print-station
node -e "const puppeteer = require('puppeteer'); puppeteer.launch({headless: true}).then(b => b.close());"
```

### Print Quality Issues

1. Open CUPS: `http://printstation.local:631`
2. Printers → hp-smarttank → Maintenance
3. Run "Clean Print Heads"
4. Run "Print Test Page"

---

## 💡 Tips for HP SmartTank

1. **Keep ink levels high** - Check regularly
2. **Use quality paper** - Better print quality
3. **Regular maintenance** - Clean print heads monthly
4. **Network printing** - More reliable than USB
5. **Paper tray** - Keep loaded with A4/Letter paper

---

## 📊 Comparison

### Thermal Printer
- ✅ Fast printing
- ✅ No ink needed
- ✅ Continuous roll
- ❌ Text-only
- ❌ No colors

### HP SmartTank
- ✅ Full HTML/CSS
- ✅ Colors and images
- ✅ Professional quality
- ❌ Needs ink
- ❌ Individual sheets

---

## 🎯 What's Different

The HP SmartTank version:
- Uses **Puppeteer** to render HTML
- Generates **PDF** from backend receipt HTML
- Prints via **CUPS** to HP printer
- Supports **full styling** and colors
- Matches backend receipt **exactly**

---

## 📞 Support

For HP SmartTank specific issues:
- Check ink levels on printer
- Verify network connection (if network printer)
- Run HP diagnostics: `hp-check`
- Check CUPS status: `lpstat -t`

---

## ✅ Success Indicators

- ✅ HP printer detected: `lsusb | grep -i hp`
- ✅ Printer in CUPS: `lpstat -p hp-smarttank`
- ✅ Test print works
- ✅ Service running: `sudo systemctl status print-station`
- ✅ Receipts print automatically
- ✅ Format matches backend exactly

---

**Your HP SmartTank is now a professional receipt printer!** 🎉
