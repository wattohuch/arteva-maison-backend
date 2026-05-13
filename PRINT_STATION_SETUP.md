# Print Station Setup Guide - Raspberry Pi 4/5

## Overview
This guide helps you set up a Raspberry Pi as an automated print station for Arteva Maison orders. The system will monitor for new orders and automatically print receipts and shipping labels.

## Hardware Requirements

### Required Components
- **Raspberry Pi 4 (4GB+) or Raspberry Pi 5 (4GB+)**
- **MicroSD Card** (32GB minimum, Class 10 or better)
- **Power Supply** (Official Raspberry Pi power supply recommended)
- **Thermal Receipt Printer** (USB connection)
  - Recommended: EPSON TM-T20III or compatible ESC/POS printer
  - Alternative: Any 80mm thermal printer with USB interface
- **Touch Screen Display** (Optional but recommended)
  - Official Raspberry Pi 7" Touch Display
  - Or any HDMI monitor with USB touch overlay
- **Network Connection**
  - Ethernet cable (recommended for reliability)
  - Or WiFi (built-in on Pi 4/5)

### Optional Components
- **Label Printer** (for shipping labels)
  - DYMO LabelWriter 4XL or similar
- **Barcode Scanner** (USB) for order verification
- **Case with cooling** (recommended for 24/7 operation)

## Software Requirements

### Operating System
- Raspberry Pi OS (64-bit) - Latest version
- Or Raspberry Pi OS Lite (for headless operation)

### Required Packages
- Node.js 18+ (for running the print station script)
- CUPS (Common Unix Printing System)
- Printer drivers (ESC/POS for thermal printers)

## Installation Steps

### 1. Prepare Raspberry Pi

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 2. Install Printing System

```bash
# Install CUPS and printer utilities
sudo apt install -y cups cups-client printer-driver-escpos

# Add pi user to printer group
sudo usermod -a -G lpadmin pi

# Enable and start CUPS
sudo systemctl enable cups
sudo systemctl start cups

# For thermal printers, install additional drivers
sudo apt install -y printer-driver-all
```

### 3. Configure Printer

```bash
# Connect your USB printer and check if detected
lsusb

# List available printers
lpstat -p -d

# Add printer via CUPS web interface
# Open browser to: http://localhost:631
# Or from another computer: http://[raspberry-pi-ip]:631

# Allow remote access to CUPS (if needed)
sudo cupsctl --remote-any
sudo systemctl restart cups
```

### 4. Install Print Station Software

```bash
# Create print station directory
mkdir -p ~/print-station
cd ~/print-station

# Clone or copy the print station script
# (We'll create this in the next section)

# Install dependencies
npm install axios dotenv node-thermal-printer qrcode
```

## Screen Setup (Optional)

### For Official 7" Touch Display

```bash
# The display should work automatically with Raspberry Pi OS
# To rotate display if needed, edit config:
sudo nano /boot/config.txt

# Add one of these lines:
# display_rotate=0  # Normal
# display_rotate=1  # 90 degrees
# display_rotate=2  # 180 degrees
# display_rotate=3  # 270 degrees

# Reboot to apply
sudo reboot
```

### For HDMI Display

```bash
# Edit config for HDMI settings
sudo nano /boot/config.txt

# Uncomment and adjust these lines:
# hdmi_force_hotplug=1
# hdmi_group=2
# hdmi_mode=82  # 1920x1080 60Hz

# For touch overlay, install drivers as per manufacturer
```

### Install Kiosk Mode (for dedicated print station)

```bash
# Install minimal browser for status display
sudo apt install -y chromium-browser unclutter

# Create autostart script
mkdir -p ~/.config/autostart
nano ~/.config/autostart/print-station.desktop
```

Add this content:
```ini
[Desktop Entry]
Type=Application
Name=Print Station
Exec=/home/pi/print-station/start-kiosk.sh
```

Create kiosk startup script:
```bash
nano ~/print-station/start-kiosk.sh
```

```bash
#!/bin/bash
# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Hide cursor
unclutter -idle 0.1 &

# Start print station in background
cd /home/pi/print-station
node print-station.js &

# Start browser in kiosk mode showing status page
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble \
  http://localhost:3001/status
```

Make executable:
```bash
chmod +x ~/print-station/start-kiosk.sh
```

## Network Configuration

### Static IP (Recommended)

```bash
# Edit dhcpcd configuration
sudo nano /etc/dhcpcd.conf

# Add at the end (adjust for your network):
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=192.168.1.1 8.8.8.8
```

### WiFi Setup

```bash
# Configure WiFi
sudo raspi-config
# Navigate to: System Options > Wireless LAN
# Enter SSID and password
```

## Security Considerations

```bash
# Change default password
passwd

# Update hostname
sudo raspi-config
# Navigate to: System Options > Hostname

# Enable firewall
sudo apt install -y ufw
sudo ufw allow 22/tcp  # SSH
sudo ufw allow 631/tcp # CUPS (if remote access needed)
sudo ufw allow 3001/tcp # Print station status page
sudo ufw enable

# Disable unnecessary services
sudo systemctl disable bluetooth
sudo systemctl disable avahi-daemon
```

## Auto-Start Configuration

### Using systemd (Recommended)

```bash
# Create systemd service
sudo nano /etc/systemd/system/print-station.service
```

```ini
[Unit]
Description=Arteva Maison Print Station
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/print-station
ExecStart=/usr/bin/node /home/pi/print-station/print-station.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable print-station
sudo systemctl start print-station

# Check status
sudo systemctl status print-station

# View logs
sudo journalctl -u print-station -f
```

## Monitoring and Maintenance

### Check Printer Status

```bash
# Check printer queue
lpq

# Check printer status
lpstat -t

# Clear print queue if needed
cancel -a
```

### Monitor Print Station

```bash
# View logs
sudo journalctl -u print-station -f

# Check if running
ps aux | grep print-station

# Restart service
sudo systemctl restart print-station
```

### Automatic Updates

```bash
# Create update script
nano ~/print-station/update.sh
```

```bash
#!/bin/bash
cd /home/pi/print-station
git pull
npm install
sudo systemctl restart print-station
```

```bash
chmod +x ~/print-station/update.sh

# Add to crontab for weekly updates
crontab -e
# Add: 0 3 * * 0 /home/pi/print-station/update.sh
```

## Troubleshooting

### Printer Not Detected

```bash
# Check USB connection
lsusb
dmesg | grep -i usb

# Reinstall printer
sudo lpadmin -x [printer-name]
# Then add again via CUPS web interface
```

### Print Quality Issues

```bash
# Clean printer head (physical cleaning)
# Adjust print density in printer settings
# Check paper quality and alignment
```

### Network Issues

```bash
# Check connection
ping -c 4 google.com

# Check API connectivity
curl -I https://arteva-maison-backend.onrender.com/api/health

# Restart networking
sudo systemctl restart networking
```

### Service Won't Start

```bash
# Check logs
sudo journalctl -u print-station -n 50

# Check permissions
ls -la /home/pi/print-station

# Test manually
cd ~/print-station
node print-station.js
```

## Performance Optimization

### For 24/7 Operation

```bash
# Reduce GPU memory (headless)
sudo nano /boot/config.txt
# Set: gpu_mem=16

# Disable swap (extends SD card life)
sudo dphys-swapfile swapoff
sudo dphys-swapfile uninstall
sudo systemctl disable dphys-swapfile

# Use log rotation
sudo nano /etc/logrotate.d/print-station
```

```
/home/pi/print-station/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

## Next Steps

1. Create the print station script (see PRINT_STATION_SCRIPT.md)
2. Configure environment variables
3. Test printing functionality
4. Set up monitoring and alerts
5. Create backup procedures

## Support

For issues specific to:
- **Raspberry Pi**: https://www.raspberrypi.org/forums/
- **CUPS Printing**: https://www.cups.org/
- **Print Station Script**: Check logs and contact development team
