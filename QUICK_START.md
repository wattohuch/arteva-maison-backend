# ⚡ QUICK START - Raspberry Pi Print Station

## 🎯 Goal
Automatic receipt printing when customers order.

## 📦 What You Need
- Raspberry Pi 4/5 + 8GB SD card (you have)
- HP SmartTank printer (you have)
- **USB SD card reader** ($5-10) ← BUY THIS

## 🚀 Setup (1-2 hours)

### 1. Flash SD Card (15 min)
1. Download: https://www.raspberrypi.com/software/
2. Insert SD card in USB reader
3. Open Raspberry Pi Imager
4. Choose: Raspberry Pi 4 → OS Lite 64-bit → Your SD card
5. Click ⚙️ Settings:
   - Hostname: `printstation`
   - Username: `pi`
   - Password: [make one up]
   - WiFi: [your WiFi]
   - ☑️ Enable SSH
6. Write and wait 10 minutes

### 2. Boot Raspberry Pi (5 min)
1. Insert SD card
2. Connect HP SmartTank (USB)
3. Connect ethernet/WiFi
4. Plug in power
5. Wait 3 minutes

### 3. Connect via SSH (2 min)
```powershell
ssh pi@printstation.local
```
Enter your password.

### 4. Install Software (30 min)
Copy-paste these commands one by one:

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs cups cups-client hplip printer-driver-hpcups chromium-browser chromium-chromedriver libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo systemctl enable cups
sudo systemctl start cups
```

### 5. Setup Printer (10 min)
1. Open browser: http://printstation.local:631
2. Administration → Add Printer
3. Login: pi / [your password]
4. Select HP Smart Tank
5. Name: `hp-smarttank`
6. Driver: HP Smart Tank
7. Paper: A4

Test:
```bash
echo "Test" | lpr -P hp-smarttank
```

### 6. Transfer Files (5 min)
On your computer:
```powershell
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"
scp print-station-hp.js pi@printstation.local:~/
scp print-station-hp-package.json pi@printstation.local:~/package.json
scp print-station.env.example pi@printstation.local:~/.env
scp print-station.service pi@printstation.local:~/
```

### 7. Setup Print Station (10 min)
```bash
mkdir -p ~/print-station/{logs,data,temp}
mv ~/print-station-hp.js ~/print-station/
mv ~/package.json ~/print-station/
mv ~/.env ~/print-station/
mv ~/print-station.service ~/print-station/
cd ~/print-station
npm install
```

### 8. Get API Key (2 min)
1. Open: https://www.artevamaisonkw.com
2. Login to admin
3. Press F12 → Console
4. Type: `localStorage.getItem('token')`
5. Copy the token

### 9. Configure (3 min)
```bash
nano ~/print-station/.env
```
Replace `your_actual_admin_api_key_here` with your token.
Save: Ctrl+X, Y, Enter

### 10. Test (2 min)
```bash
cd ~/print-station
TEST_MODE=true node print-station-hp.js
```
Should print test receipt!

### 11. Enable Auto-Start (2 min)
```bash
sudo cp ~/print-station/print-station.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable print-station
sudo systemctl start print-station
sudo systemctl status print-station
```
Should show: `active (running)` ✅

### 12. Test Real Order (2 min)
Place order on website → Receipt prints automatically!

## ✅ Done!

**Customer orders → Receipt prints automatically!**

## 🔧 Useful Commands

```bash
# Connect
ssh pi@printstation.local

# Check status
sudo systemctl status print-station

# View logs
sudo journalctl -u print-station -f

# Restart
sudo systemctl restart print-station
```

## 🆘 Problems?

**Can't connect?** Try: `ssh pi@192.168.1.XXX`

**Not printing?** Check logs: `sudo journalctl -u print-station -n 50`

**Wrong API key?** Edit: `nano ~/print-station/.env` then restart

## 📚 Full Guide

See: `SETUP_GUIDE_2024.md` for detailed step-by-step instructions.

---

**🎉 Enjoy automatic receipt printing!** ✨
