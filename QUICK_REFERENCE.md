# 🚀 Print Station Quick Reference Card

## 📋 Setup Summary (30 Minutes)

```
1. Flash SD Card (Raspberry Pi OS Lite 64-bit)
   ├─ Enable SSH
   ├─ Set hostname: printstation
   └─ Configure WiFi (if needed)

2. Boot & Connect
   └─ ssh pi@printstation.local

3. Install Software
   ├─ Node.js 18
   ├─ CUPS (printing system)
   └─ Optimize for 8GB

4. Configure Printer
   └─ http://printstation.local:631

5. Transfer Files
   ├─ print-station.js
   ├─ package.json
   ├─ .env
   └─ print-station.service

6. Install & Configure
   ├─ npm install
   └─ Edit .env (add API_KEY)

7. Test
   └─ TEST_MODE=true node print-station.js

8. Enable Auto-Start
   └─ sudo systemctl enable print-station
```

---

## ⚡ Essential Commands

### Service Control
```bash
# Start
sudo systemctl start print-station

# Stop
sudo systemctl stop print-station

# Restart
sudo systemctl restart print-station

# Status
sudo systemctl status print-station

# Enable auto-start
sudo systemctl enable print-station

# Disable auto-start
sudo systemctl disable print-station
```

### View Logs
```bash
# Live logs
sudo journalctl -u print-station -f

# Last 50 lines
sudo journalctl -u print-station -n 50

# Last 100 lines
sudo journalctl -u print-station -n 100

# Today's logs
sudo journalctl -u print-station --since today
```

### Printer Commands
```bash
# Test print
echo "Test Print" | lpr -P receipt-printer

# Check printer status
lpstat -t

# Check printer queue
lpq

# Clear print queue
cancel -a

# List printers
lpstat -p -d

# Check USB devices
lsusb
```

### System Commands
```bash
# Check disk space
df -h

# Check memory
free -h

# Check network
ping arteva-maison-backend.onrender.com

# Reboot
sudo reboot

# Shutdown
sudo shutdown -h now

# Check IP address
hostname -I
```

---

## 🔧 Configuration Files

### .env Location
```bash
~/print-station/.env
```

### Edit Configuration
```bash
nano ~/print-station/.env
```

### View Configuration
```bash
cat ~/print-station/.env
```

### Service File Location
```bash
/etc/systemd/system/print-station.service
```

---

## 📊 Monitoring

### Check if Running
```bash
ps aux | grep print-station
```

### Check Connection
```bash
sudo journalctl -u print-station -n 50 | grep "Connected"
```

### Check Last Order
```bash
cat ~/print-station/data/last-order.json
```

### Check Logs
```bash
tail -f ~/print-station/logs/print-station.log
```

---

## 🆘 Quick Fixes

### Service Won't Start
```bash
# Check logs
sudo journalctl -u print-station -n 50

# Test manually
cd ~/print-station
node print-station.js

# Check permissions
ls -la ~/print-station
```

### Printer Not Working
```bash
# Check if detected
lsusb

# Restart CUPS
sudo systemctl restart cups

# Check device
ls -la /dev/usb/lp*

# Test printer
echo "test" | lpr -P receipt-printer
```

### Can't Connect via SSH
```bash
# Try IP address
ssh pi@192.168.1.XXX

# Check if Pi is online
ping printstation.local
```

### Out of Space
```bash
# Check space
df -h

# Clean logs
sudo journalctl --vacuum-time=7d

# Clean npm cache
npm cache clean --force

# Remove old logs
rm -f ~/print-station/logs/*.log.old
```

---

## 🔄 Update Process

### Update Print Station Code
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

### Update System
```bash
sudo apt update && sudo apt upgrade -y
sudo reboot
```

---

## 📱 Remote Access

### SSH from Computer
```bash
ssh pi@printstation.local
# or
ssh pi@192.168.1.100
```

### CUPS Web Interface
```
http://printstation.local:631
# or
http://192.168.1.100:631
```

### View Logs Remotely
```bash
ssh pi@printstation.local "sudo journalctl -u print-station -n 50"
```

### Restart Remotely
```bash
ssh pi@printstation.local "sudo systemctl restart print-station"
```

---

## ✅ Health Check

Run this to verify everything:

```bash
echo "=== PRINT STATION HEALTH CHECK ==="
echo ""
echo "Service Status:"
sudo systemctl status print-station --no-pager | grep "Active:"
echo ""
echo "Printer Status:"
lpstat -t | grep "receipt-printer"
echo ""
echo "Network:"
ping -c 1 arteva-maison-backend.onrender.com > /dev/null && echo "✓ Connected" || echo "✗ No connection"
echo ""
echo "Disk Space:"
df -h / | tail -n 1
echo ""
echo "Last 5 Log Lines:"
sudo journalctl -u print-station -n 5 --no-pager
```

---

## 🎯 What Should Be Running

```bash
# Check these are active:
sudo systemctl status cups          # Printing system
sudo systemctl status print-station # Print station
```

---

## 📞 Emergency Commands

### Stop Everything
```bash
sudo systemctl stop print-station
sudo systemctl stop cups
```

### Start Everything
```bash
sudo systemctl start cups
sudo systemctl start print-station
```

### Nuclear Reset
```bash
sudo systemctl stop print-station
cd ~/print-station
rm -rf node_modules
npm install
sudo systemctl start print-station
```

---

## 💡 Tips

1. **Always check logs first**: `sudo journalctl -u print-station -f`
2. **Test printer separately**: `echo "test" | lpr`
3. **Verify network**: `ping arteva-maison-backend.onrender.com`
4. **Check disk space**: `df -h`
5. **Keep paper loaded**: Physical check!

---

## 🔐 Security

### Change Password
```bash
passwd
```

### Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Check Firewall
```bash
sudo ufw status
```

---

## 📊 Performance

### Check CPU/Memory
```bash
top
# Press 'q' to quit
```

### Check Temperature
```bash
vcgencmd measure_temp
```

### Check Uptime
```bash
uptime
```

---

## 🎉 Success Indicators

✅ Service shows "active (running)"  
✅ Logs show "✓ Connected to backend"  
✅ Logs show "✓ Listening for new orders..."  
✅ Test print works  
✅ Real orders print automatically  
✅ Survives reboot  

---

## 📞 Support Checklist

If something's wrong:

1. ☐ Check service status
2. ☐ Check logs (last 50 lines)
3. ☐ Test printer manually
4. ☐ Verify network connection
5. ☐ Check disk space
6. ☐ Verify .env configuration
7. ☐ Try restarting service
8. ☐ Try rebooting Pi

---

## 🚀 One-Liner Commands

```bash
# Full status check
sudo systemctl status print-station && lpstat -t && df -h / | tail -n 1

# Restart everything
sudo systemctl restart cups && sudo systemctl restart print-station

# View live logs with timestamp
sudo journalctl -u print-station -f --since "5 minutes ago"

# Check if orders are being processed
sudo journalctl -u print-station | grep "Processing order"

# Count printed orders today
sudo journalctl -u print-station --since today | grep "Successfully processed" | wc -l
```

---

**Keep this card handy for quick reference!** 📌
