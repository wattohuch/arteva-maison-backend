# Headless Print Station Setup - 8GB SD Card

## Overview
Minimal headless setup for Raspberry Pi 4/5 with 8GB SD card and no display. Perfect for a dedicated print station that runs 24/7.

## What You Need

### Hardware
- **Raspberry Pi 4 or 5** (any RAM size)
- **8GB MicroSD Card** (Class 10 minimum)
- **USB Thermal Printer** (80mm receipt printer)
- **Ethernet Cable** (recommended) or WiFi
- **Power Supply** (official Raspberry Pi adapter)

### No Display Needed
- Setup via SSH from your computer
- Monitor via web interface or SSH
- Fully automated operation

## Step-by-Step Installation

### 1. Prepare SD Card (On Your Computer)

#### Download Raspberry Pi Imager
- Download from: https://www.raspberrypi.com/software/
- Install on your Windows/Mac/Linux computer

#### Flash Raspberry Pi OS Lite
1. Open Raspberry Pi Imager
2. Choose Device: **Raspberry Pi 4** or **Raspberry Pi 5**
3. Choose OS: **Raspberry Pi OS (other)** → **Raspberry Pi OS Lite (64-bit)**
   - This is minimal, no desktop, perfect for 8GB card
4. Choose Storage: Your 8GB SD card

#### Configure Settings (IMPORTANT!)
1. Click the **Settings** gear icon (⚙️)
2. Enable **Set hostname**: `printstation` (or your choice)
3. Enable **Set username and password**:
   - Username: `pi`
   - Password: (choose a secure password)
4. Enable **Configure wireless LAN** (if using WiFi):
   - SSID: Your WiFi name
   - Password: Your WiFi password
   - Country: Your country code (e.g., KW for Kuwait)
5. Enable **Set locale settings**:
   - Time zone: Asia/Kuwait
   - Keyboard layout: us
6. **Enable SSH**:
   - Select "Use password authentication"
7. Click **Save**
8. Click **Write** and wait for completion

### 2. First Boot

1. Insert SD card into Raspberry Pi
2. Connect ethernet cable (or use WiFi)
3. Connect USB printer
4. Power on the Raspberry Pi
5. Wait 2-3 minutes for first boot

### 3. Find Your Raspberry Pi IP Address

#### Option A: Check Your Router
- Log into your router admin panel
- Look for device named "printstation"

#### Option B: Use Network Scanner
- Windows: Download "Advanced IP Scanner"
- Mac: Use "LanScan" app
- Look for "Raspberry Pi" device

#### Option C: Use Command (if on same network)
```bash
# Windows PowerShell
ping printstation.local

# Mac/Linux
ping printstation.local
```

### 4. Connect via SSH

#### From Windows
```powershell
# Open PowerShell and connect
ssh pi@printstation.local
# Or use IP address: ssh pi@192.168.1.XXX

# Enter the password you set earlier
```

#### From Mac/Linux
```bash
ssh pi@printstation.local
# Enter your password
```

### 5. Initial System Setup

Once connected via SSH, run these commands:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y git curl

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x or higher
```

### 6. Install Printing System

```bash
# Install CUPS (printing system)
sudo apt install -y cups cups-client printer-driver-escpos

# Add pi user to printer group
sudo usermod -a -G lpadmin pi

# Enable CUPS for remote access
sudo cupsctl --remote-any
sudo cupsctl --share-printers

# Start CUPS
sudo systemctl enable cups
sudo systemctl start cups
```

### 7. Configure Printer

```bash
# Check if printer is detected
lsusb
# You should see your printer listed

# List available printers
lpstat -p -d

# Find printer device
ls -la /dev/usb/lp*
# Note the device path (usually /dev/usb/lp0)
```

#### Add Printer via CUPS Web Interface

From your computer's browser:
1. Go to: `http://printstation.local:631` (or use IP address)
2. Click **Administration** → **Add Printer**
3. Login with username: `pi` and your password
4. Select your USB printer
5. Click **Continue**
6. Name: `receipt-printer`
7. Check **Share This Printer**
8. Click **Continue**
9. Select driver: **Generic → Generic ESC/POS Printer**
10. Click **Add Printer**
11. Set default options and click **Set Default Options**

#### Test Printer
```bash
# Print test page
echo "Test Print from Raspberry Pi" | lpr -P receipt-printer

# Check printer status
lpstat -t
```

### 8. Install Print Station Software

```bash
# Create directory
mkdir -p ~/print-station
cd ~/print-station

# Download files (you'll need to transfer them)
# Option A: Use git (if you have a repository)
git clone https://github.com/yourusername/arteva-print-station.git .

# Option B: Transfer files via SCP from your computer
# On your Windows computer, open PowerShell in the backend folder:
# scp print-station.js pi@printstation.local:~/print-station/
# scp print-station-package.json pi@printstation.local:~/print-station/package.json
# scp print-station.env.example pi@printstation.local:~/print-station/.env
```

#### Manual File Transfer (Easiest Method)

On your Windows computer:
```powershell
# Navigate to your backend folder
cd "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend"

# Copy files to Raspberry Pi
scp print-station.js pi@printstation.local:~/print-station/
scp print-station-package.json pi@printstation.local:~/print-station/package.json
scp print-station.env.example pi@printstation.local:~/print-station/.env
```

Back on Raspberry Pi SSH:
```bash
cd ~/print-station

# Install dependencies
npm install

# Create necessary directories
mkdir -p logs data
```

### 9. Configure Print Station

```bash
# Edit configuration
nano .env
```

Update these values:
```bash
API_URL=https://arteva-maison-backend.onrender.com
API_KEY=your_admin_api_key_here

POLL_INTERVAL=30000

PRINTER_INTERFACE=/dev/usb/lp0
PRINTER_TYPE=EPSON

PRINT_RECEIPT=true
PRINT_LABEL=true
PRINT_PACKING=true

LOG_FILE=./logs/print-station.log
STATE_FILE=./data/last-order.json

TEST_MODE=false
```

Save: `Ctrl+X`, then `Y`, then `Enter`

### 10. Test Print Station

```bash
# Run test mode
TEST_MODE=true node print-station.js

# If successful, you should see a test receipt print
```

### 11. Set Up Auto-Start

```bash
# Create systemd service
sudo nano /etc/systemd/system/print-station.service
```

Paste this content:
```ini
[Unit]
Description=Arteva Maison Print Station
After=network.target cups.service
Wants=cups.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/print-station
ExecStart=/usr/bin/node /home/pi/print-station/print-station.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Save and enable:
```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable print-station

# Start service now
sudo systemctl start print-station

# Check status
sudo systemctl status print-station
```

### 12. Monitor Print Station

```bash
# View live logs
sudo journalctl -u print-station -f

# View last 50 lines
sudo journalctl -u print-station -n 50

# Check if running
ps aux | grep print-station

# Restart service
sudo systemctl restart print-station

# Stop service
sudo systemctl stop print-station
```

## Space Optimization for 8GB Card

```bash
# Remove unnecessary packages
sudo apt autoremove -y
sudo apt clean

# Disable swap (saves space and extends SD card life)
sudo dphys-swapfile swapoff
sudo dphys-swapfile uninstall
sudo systemctl disable dphys-swapfile

# Reduce GPU memory (headless system)
sudo nano /boot/firmware/config.txt
# Add at the end:
# gpu_mem=16

# Disable Bluetooth (if not needed)
sudo systemctl disable bluetooth
sudo systemctl disable hciuart

# Check available space
df -h
```

## Remote Management (No Display Needed)

### SSH Access
```bash
# From your computer
ssh pi@printstation.local

# Or use IP
ssh pi@192.168.1.XXX
```

### View Logs Remotely
```bash
ssh pi@printstation.local "sudo journalctl -u print-station -n 100"
```

### Restart Service Remotely
```bash
ssh pi@printstation.local "sudo systemctl restart print-station"
```

### Check Status Remotely
```bash
ssh pi@printstation.local "sudo systemctl status print-station"
```

## Set Static IP (Recommended)

```bash
# Edit network configuration
sudo nano /etc/dhcpcd.conf

# Add at the end (adjust for your network):
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=192.168.1.1 8.8.8.8

# For WiFi, use:
# interface wlan0
# static ip_address=192.168.1.100/24
# static routers=192.168.1.1
# static domain_name_servers=192.168.1.1 8.8.8.8

# Save and reboot
sudo reboot
```

## Troubleshooting

### Can't Connect via SSH
```bash
# Try IP address instead of hostname
ssh pi@192.168.1.XXX

# Check if SSH is enabled
# Re-flash SD card and ensure SSH is enabled in imager settings
```

### Printer Not Working
```bash
# Check USB connection
lsusb

# Check printer status
lpstat -t

# Restart CUPS
sudo systemctl restart cups

# Check printer device
ls -la /dev/usb/lp*
```

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

## Backup Configuration

```bash
# Backup your configuration
scp pi@printstation.local:~/print-station/.env ./print-station-backup.env

# Backup entire print station folder
scp -r pi@printstation.local:~/print-station ./print-station-backup
```

## Update Print Station

```bash
# SSH into Raspberry Pi
ssh pi@printstation.local

# Stop service
sudo systemctl stop print-station

# Update files (transfer new version)
cd ~/print-station
# Transfer updated files from your computer

# Install any new dependencies
npm install

# Restart service
sudo systemctl start print-station

# Check status
sudo systemctl status print-station
```

## Performance Tips

### Reduce Logging
```bash
# Edit .env
nano ~/print-station/.env

# Reduce log verbosity or disable detailed logs
```

### Log Rotation
```bash
# Create log rotation config
sudo nano /etc/logrotate.d/print-station
```

Add:
```
/home/pi/print-station/logs/*.log {
    daily
    rotate 3
    compress
    delaycompress
    missingok
    notifempty
    create 0644 pi pi
}
```

## Security Hardening

```bash
# Change default password (if not done during setup)
passwd

# Update system regularly
sudo apt update && sudo apt upgrade -y

# Enable firewall
sudo apt install -y ufw
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 631/tcp  # CUPS (only if needed remotely)
sudo ufw enable

# Disable root login via SSH
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart ssh
```

## Quick Reference Commands

```bash
# Start service
sudo systemctl start print-station

# Stop service
sudo systemctl stop print-station

# Restart service
sudo systemctl restart print-station

# View status
sudo systemctl status print-station

# View logs
sudo journalctl -u print-station -f

# Test print
cd ~/print-station && TEST_MODE=true node print-station.js

# Check printer
lpstat -t

# Reboot Pi
sudo reboot

# Shutdown Pi
sudo shutdown -h now
```

## Success Checklist

- [ ] Raspberry Pi boots and connects to network
- [ ] Can SSH into Raspberry Pi
- [ ] Printer detected and configured in CUPS
- [ ] Test print successful
- [ ] Print station service running
- [ ] Test order prints correctly
- [ ] Service auto-starts on reboot
- [ ] Can monitor logs remotely
- [ ] Static IP configured (optional)
- [ ] Backup of configuration saved

## Next Steps

1. Test with real orders from your backend
2. Monitor for 24 hours to ensure stability
3. Set up monitoring/alerts (optional)
4. Document your specific printer settings
5. Create backup SD card image

## Support

If you encounter issues:
1. Check logs: `sudo journalctl -u print-station -n 100`
2. Test printer: `echo "test" | lpr`
3. Verify network: `ping google.com`
4. Check service: `sudo systemctl status print-station`
