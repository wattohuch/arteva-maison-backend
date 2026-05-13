# ✅ Print Station Setup Checklist

Print this and check off each step as you complete it!

---

## 📦 Pre-Setup

- [ ] Raspberry Pi 4 or 5 ready
- [ ] 8GB MicroSD card ready
- [ ] USB thermal printer ready
- [ ] Ethernet cable or WiFi credentials
- [ ] Power supply ready
- [ ] Computer for setup ready

---

## 💾 Part 1: SD Card Preparation

- [ ] Downloaded Raspberry Pi Imager
- [ ] Inserted SD card into computer
- [ ] Selected "Raspberry Pi OS Lite (64-bit)"
- [ ] Clicked Settings gear icon (⚙️)
- [ ] Set hostname: `printstation`
- [ ] Set username: `pi` and password
- [ ] Configured WiFi (if using WiFi)
- [ ] Enabled SSH
- [ ] Set timezone: Asia/Kuwait
- [ ] Clicked "Write" and waited for completion
- [ ] Ejected SD card safely

---

## 🔌 Part 2: Hardware Setup

- [ ] Inserted SD card into Raspberry Pi
- [ ] Connected ethernet cable (or using WiFi)
- [ ] Connected USB thermal printer
- [ ] Powered on Raspberry Pi
- [ ] Waited 2-3 minutes for boot
- [ ] Found Raspberry Pi IP address or using `printstation.local`

---

## 🖥️ Part 3: SSH Connection

- [ ] Opened PowerShell/Terminal on computer
- [ ] Connected: `ssh pi@printstation.local`
- [ ] Entered password successfully
- [ ] Confirmed connection (seeing command prompt)

---

## 📥 Part 4: System Installation

- [ ] Updated system: `sudo apt update && sudo apt upgrade -y`
- [ ] Installed Node.js 18
- [ ] Verified Node.js: `node --version` shows v18.x.x
- [ ] Installed CUPS printing system
- [ ] Added pi user to lpadmin group
- [ ] Enabled CUPS remote access
- [ ] Started CUPS service
- [ ] Disabled swap
- [ ] Reduced GPU memory
- [ ] Disabled Bluetooth
- [ ] Cleaned up packages
- [ ] Checked disk space: `df -h /`

---

## 🖨️ Part 5: Printer Configuration

- [ ] Checked printer detected: `lsusb`
- [ ] Verified printer device: `ls -la /dev/usb/lp*`
- [ ] Opened CUPS web interface: `http://printstation.local:631`
- [ ] Logged in with pi credentials
- [ ] Added printer via Administration → Add Printer
- [ ] Named printer: `receipt-printer`
- [ ] Selected Generic ESC/POS driver
- [ ] Set default options
- [ ] Test printed successfully: `echo "Test" | lpr -P receipt-printer`

---

## 📂 Part 6: Print Station Files

- [ ] Created directories: `mkdir -p ~/print-station/logs ~/print-station/data`
- [ ] Transferred `print-station.js` from computer
- [ ] Transferred `print-station-package.json` as `package.json`
- [ ] Transferred `print-station.env.example` as `.env`
- [ ] Transferred `print-station.service`
- [ ] Installed dependencies: `npm install`
- [ ] Verified node_modules folder created

---

## ⚙️ Part 7: Configuration

- [ ] Edited .env file: `nano ~/print-station/.env`
- [ ] Set `API_URL` to backend URL
- [ ] Set `API_KEY` to actual admin API key
- [ ] Set `SOCKET_URL` to backend URL
- [ ] Set `PRINTER_INTERFACE` to `/dev/usb/lp0`
- [ ] Set `PRINTER_TYPE` to correct type (EPSON/STAR/etc)
- [ ] Set `PRINT_RECEIPT=true`
- [ ] Set `PRINT_LABEL=true`
- [ ] Set `PRINT_PACKING=true`
- [ ] Saved file (Ctrl+X, Y, Enter)

---

## 🧪 Part 8: Testing

- [ ] Ran test mode: `TEST_MODE=true node print-station.js`
- [ ] Test receipt printed successfully
- [ ] Saw "✓ Successfully processed order" in logs
- [ ] No errors in output

---

## 🚀 Part 9: Auto-Start Setup

- [ ] Copied service file: `sudo cp ~/print-station/print-station.service /etc/systemd/system/`
- [ ] Reloaded systemd: `sudo systemctl daemon-reload`
- [ ] Enabled service: `sudo systemctl enable print-station`
- [ ] Started service: `sudo systemctl start print-station`
- [ ] Checked status: `sudo systemctl status print-station`
- [ ] Status shows "active (running)"
- [ ] Viewed live logs: `sudo journalctl -u print-station -f`
- [ ] Logs show "✓ Connected to backend"
- [ ] Logs show "✓ Listening for new orders..."

---

## 🌐 Part 10: Static IP (Optional)

- [ ] Edited dhcpcd.conf: `sudo nano /etc/dhcpcd.conf`
- [ ] Added static IP configuration
- [ ] Adjusted IP address for network
- [ ] Saved file
- [ ] Rebooted: `sudo reboot`
- [ ] Reconnected with static IP
- [ ] Verified connection works

---

## ✅ Final Verification

- [ ] Service running: `sudo systemctl status print-station`
- [ ] Printer ready: `lpstat -t`
- [ ] Network connected: `ping arteva-maison-backend.onrender.com`
- [ ] Logs look good: `sudo journalctl -u print-station -n 50`
- [ ] Disk space OK: `df -h /`
- [ ] Test print works: `echo "test" | lpr`
- [ ] Rebooted Pi to test auto-start: `sudo reboot`
- [ ] After reboot, service auto-started
- [ ] After reboot, connected to backend automatically

---

## 🎉 Success Criteria

- [ ] ✅ Service shows "active (running)"
- [ ] ✅ Logs show "✓ Connected to backend"
- [ ] ✅ Logs show "✓ Listening for new orders..."
- [ ] ✅ Test print successful
- [ ] ✅ Test order printed automatically
- [ ] ✅ Survives reboot (auto-starts)
- [ ] ✅ Receipt format matches backend
- [ ] ✅ No errors in logs

---

## 📝 Post-Setup Notes

**Date Completed:** _______________

**Raspberry Pi IP:** _______________

**Printer Model:** _______________

**API Key Used:** (first 8 chars) _______________

**Issues Encountered:**
```
_________________________________________________
_________________________________________________
_________________________________________________
```

**Solutions Applied:**
```
_________________________________________________
_________________________________________________
_________________________________________________
```

---

## 🔄 Maintenance Schedule

- [ ] **Daily:** Check printer has paper
- [ ] **Weekly:** Check logs for errors
- [ ] **Monthly:** Update system: `sudo apt update && sudo apt upgrade -y`
- [ ] **Quarterly:** Backup configuration
- [ ] **Yearly:** Replace SD card (preventive)

---

## 📞 Emergency Contacts

**SSH Command:**
```
ssh pi@printstation.local
```

**CUPS Web Interface:**
```
http://printstation.local:631
```

**View Logs:**
```
sudo journalctl -u print-station -f
```

**Restart Service:**
```
sudo systemctl restart print-station
```

---

## 🎯 Quick Test

Run this after setup to verify everything:

```bash
# 1. Check service
sudo systemctl status print-station

# 2. Check printer
lpstat -t

# 3. Check network
ping -c 3 arteva-maison-backend.onrender.com

# 4. View logs
sudo journalctl -u print-station -n 20

# 5. Test print
echo "Setup Complete!" | lpr -P receipt-printer
```

**All should pass!** ✅

---

## 🚀 You're Done!

Your print station is now:
- ✅ Running 24/7 automatically
- ✅ Connected to backend via WebSocket
- ✅ Printing receipts instantly when orders arrive
- ✅ Auto-starting after power outages
- ✅ Matching backend receipt format exactly
- ✅ Requiring ZERO manual intervention

**Congratulations!** 🎉

---

**Keep this checklist for future reference or when setting up additional print stations.**
