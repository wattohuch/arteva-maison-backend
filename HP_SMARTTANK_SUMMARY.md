# 🖨️ HP SmartTank Print Station - Complete Summary

## What You Have

**HP SmartTank** = Regular inkjet printer (A4/Letter paper)  
**NOT** a thermal receipt printer

## What This Means

✅ **Prints full HTML receipts** (exact match to backend)  
✅ **Professional quality** with colors and styling  
✅ **A4/Letter paper** (one receipt per page)  
✅ **Uses Puppeteer** to render HTML to PDF  
✅ **Same auto-printing** functionality  

## Files You Need

```
print-station-hp.js              ← Main script for HP SmartTank
print-station-hp-package.json    ← Dependencies (rename to package.json)
print-station.env.example        ← Configuration (rename to .env)
print-station.service            ← Systemd service
```

## Quick Setup (30 Minutes)

### 1. Flash SD Card
- Raspberry Pi OS Lite (64-bit)
- Enable SSH, set hostname: `printstation`
- Configure WiFi if needed

### 2. Boot & Connect
```bash
ssh pi@printstation.local
```

### 3. Install Software
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install CUPS
sudo apt install -y cups cups-client

# Install HP drivers (IMPORTANT!)
sudo apt install -y hplip printer-driver-hpcups

# Install Chromium for HTML rendering
sudo apt install -y chromium-browser chromium-chromedriver

# Install Puppeteer dependencies
sudo apt install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2

# Configure CUPS
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo systemctl enable cups
sudo systemctl start cups

# Optimize for 8GB
sudo dphys-swapfile swapoff
sudo dphys-swapfile uninstall
sudo systemctl disable dphys-swapfile
echo "gpu_mem=16" | sudo tee -a /boot/firmware/config.txt
sudo systemctl disable bluetooth
sudo apt autoremove -y
sudo apt clean
```

### 4. Configure HP SmartTank

**Check if detected:**
```bash
lsusb | grep -i hp
```

**Add printer via CUPS:**
1. Open: `http://printstation.local:631`
2. Administration → Add Printer
3. Login: `pi` / your password
4. Select **HP SmartTank** (USB or Network)
5. Name: `hp-smarttank`
6. Driver: Select **HP SmartTank** model
7. Paper size: **A4** or **Letter**
8. Set Default Options

**Test:**
```bash
echo "Test Print" | lpr -P hp-smarttank
```

### 5. Transfer Files

**On your Windows computer:**
```powershell
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"

scp print-station-hp.js pi@printstation.local:~/print-station/print-station.js
scp print-station-hp-package.json pi@printstation.local:~/print-station/package.json
scp print-station.env.example pi@printstation.local:~/print-station/.env
scp print-station.service pi@printstation.local:~/print-station/
```

### 6. Install Dependencies

**On Raspberry Pi:**
```bash
mkdir -p ~/print-station/logs ~/print-station/data ~/print-station/temp
cd ~/print-station
npm install
```

### 7. Configure

```bash
nano ~/print-station/.env
```

**Update:**
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
```

Save: `Ctrl+X`, `Y`, `Enter`

### 8. Test

```bash
cd ~/print-station
TEST_MODE=true node print-station.js
```

**Should print test receipt on A4 paper!**

### 9. Enable Auto-Start

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

## What Gets Printed

### Receipt (A4 Paper)
- Full HTML receipt from backend
- Exact match to web version
- Professional formatting
- Colors and styling
- QR code for tracking

### Shipping Label (A4 Paper)
- Large text for easy reading
- Delivery address
- Order number
- From/To information

### Packing Slip (A4 Paper)
- Checklist format
- All items with checkboxes
- SKU numbers
- Quality check section

## Key Differences from Thermal Printer

| Feature | Thermal Printer | HP SmartTank |
|---------|----------------|--------------|
| Paper | 80mm roll | A4/Letter sheets |
| Format | Text-only | Full HTML/CSS |
| Colors | No | Yes |
| Images | Limited | Full support |
| Quality | Basic | Professional |
| Ink | No ink needed | Requires ink |
| Speed | Very fast | Moderate |
| Cost per print | Very low | Moderate |

## Advantages of HP SmartTank

✅ **Exact backend match** - Renders same HTML  
✅ **Professional quality** - Colors, fonts, styling  
✅ **Flexible** - Can print anything (receipts, labels, reports)  
✅ **Standard paper** - Easy to source  
✅ **Multi-purpose** - Can use for other printing needs  

## Maintenance

- **Daily:** Check ink levels, keep paper loaded
- **Weekly:** Check print quality
- **Monthly:** Clean print heads
- **As needed:** Refill ink tanks

## Troubleshooting

### HP Printer Not Detected
```bash
lsusb | grep -i hp
hp-check
sudo hp-setup -i
```

### Print Quality Issues
1. Open CUPS: `http://printstation.local:631`
2. Printers → hp-smarttank → Maintenance
3. Clean Print Heads
4. Print Test Page

### Chromium/Puppeteer Issues
```bash
chromium-browser --version
cd ~/print-station
node -e "const puppeteer = require('puppeteer'); puppeteer.launch({headless: true}).then(b => b.close());"
```

### Service Won't Start
```bash
sudo journalctl -u print-station -n 50
cd ~/print-station
node print-station.js
```

## Useful Commands

```bash
# Check printer status
lpstat -t

# Test print
echo "Test" | lpr -P hp-smarttank

# View logs
sudo journalctl -u print-station -f

# Restart service
sudo systemctl restart print-station

# Check ink levels (if supported)
hp-levels

# Clean print heads
hp-clean -d hp-smarttank
```

## Success Indicators

✅ HP printer detected: `lsusb | grep -i hp`  
✅ Printer in CUPS: `lpstat -p hp-smarttank`  
✅ Chromium installed: `chromium-browser --version`  
✅ Test print works  
✅ Service running: `sudo systemctl status print-station`  
✅ Receipts print automatically  
✅ Format matches backend exactly  

## What Happens When Order Arrives

```
1. Customer places order
2. Backend sends Socket.io notification
3. Print station receives (< 1 second)
4. Fetches receipt HTML from backend
5. Renders HTML to PDF using Puppeteer
6. Sends PDF to HP SmartTank
7. Prints on A4 paper
8. Ready for next order
```

**Total time: 5-10 seconds per order**

## Cost Considerations

- **Paper:** ~$0.01 per sheet (A4)
- **Ink:** ~$0.05-0.10 per page (color)
- **Total:** ~$0.06-0.11 per receipt

**Tip:** Use draft mode to save ink:
1. CUPS → hp-smarttank → Set Default Options
2. Print Quality: Draft
3. Color Mode: Grayscale (if acceptable)

## Network vs USB

### USB Connection
✅ Simple setup  
✅ No network issues  
❌ Pi must be near printer  

### Network Connection
✅ Pi can be anywhere  
✅ More flexible  
❌ Requires printer on network  
❌ Slightly more complex setup  

**Recommendation:** Use USB for reliability

## Final Notes

- HP SmartTank works great for this use case
- Prints professional-quality receipts
- Matches backend format exactly
- Same auto-printing functionality as thermal
- Just uses regular paper instead of receipt rolls

**Your HP SmartTank is now a professional receipt printer!** 🎉

---

## Quick Reference

**SSH:** `ssh pi@printstation.local`  
**CUPS:** `http://printstation.local:631`  
**Logs:** `sudo journalctl -u print-station -f`  
**Test:** `TEST_MODE=true node print-station.js`  
**Restart:** `sudo systemctl restart print-station`  

---

**For detailed setup, see:** [PRINT_STATION_HP_SMARTTANK.md](./PRINT_STATION_HP_SMARTTANK.md)
