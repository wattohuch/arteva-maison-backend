#!/bin/bash

# Arteva Maison Print Station - Automated Setup Script
# For Raspberry Pi 4/5 - Headless 8GB Setup
# Run this script after first SSH connection

set -e

echo "=========================================="
echo "Arteva Maison Print Station Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    echo -e "${RED}Error: This script must be run on a Raspberry Pi${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Detected Raspberry Pi${NC}"
echo ""

# Update system
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y
echo -e "${GREEN}✓ System updated${NC}"
echo ""

# Install Node.js
echo "Installing Node.js 18.x..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
    echo -e "${GREEN}✓ Node.js installed: $(node --version)${NC}"
else
    echo -e "${GREEN}✓ Node.js already installed: $(node --version)${NC}"
fi
echo ""

# Install CUPS
echo "Installing printing system (CUPS)..."
sudo apt install -y cups cups-client printer-driver-escpos printer-driver-all
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any
sudo cupsctl --share-printers
sudo systemctl enable cups
sudo systemctl start cups
echo -e "${GREEN}✓ CUPS installed and configured${NC}"
echo ""

# Install additional tools
echo "Installing additional tools..."
sudo apt install -y git curl vim
echo -e "${GREEN}✓ Additional tools installed${NC}"
echo ""

# Create print station directory
echo "Setting up print station directory..."
mkdir -p ~/print-station/logs
mkdir -p ~/print-station/data
cd ~/print-station
echo -e "${GREEN}✓ Directory structure created${NC}"
echo ""

# Check for printer
echo "Checking for connected printer..."
if lsusb | grep -i "printer\|epson\|star\|bixolon" > /dev/null; then
    echo -e "${GREEN}✓ Printer detected${NC}"
    lsusb | grep -i "printer\|epson\|star\|bixolon"
else
    echo -e "${YELLOW}⚠ No printer detected. Please connect USB printer.${NC}"
fi
echo ""

# Optimize for 8GB SD card
echo "Optimizing system for 8GB SD card..."

# Disable swap
sudo dphys-swapfile swapoff 2>/dev/null || true
sudo dphys-swapfile uninstall 2>/dev/null || true
sudo systemctl disable dphys-swapfile 2>/dev/null || true

# Reduce GPU memory
if ! grep -q "gpu_mem=16" /boot/firmware/config.txt 2>/dev/null; then
    echo "gpu_mem=16" | sudo tee -a /boot/firmware/config.txt > /dev/null
fi

# Disable unnecessary services
sudo systemctl disable bluetooth 2>/dev/null || true
sudo systemctl disable hciuart 2>/dev/null || true

# Clean up
sudo apt autoremove -y
sudo apt clean

echo -e "${GREEN}✓ System optimized${NC}"
echo ""

# Setup firewall
echo "Configuring firewall..."
sudo apt install -y ufw
sudo ufw --force enable
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 631/tcp  # CUPS
echo -e "${GREEN}✓ Firewall configured${NC}"
echo ""

# Display space usage
echo "Disk space usage:"
df -h / | tail -n 1
echo ""

# Instructions for next steps
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Transfer print station files:"
echo "   From your computer, run:"
echo "   scp print-station.js pi@printstation.local:~/print-station/"
echo "   scp print-station-package.json pi@printstation.local:~/print-station/package.json"
echo "   scp print-station.env.example pi@printstation.local:~/print-station/.env"
echo ""
echo "2. Install dependencies:"
echo "   cd ~/print-station"
echo "   npm install"
echo ""
echo "3. Configure printer:"
echo "   Open browser: http://$(hostname -I | awk '{print $1}'):631"
echo "   Add your USB printer"
echo ""
echo "4. Edit configuration:"
echo "   nano ~/print-station/.env"
echo "   (Set API_URL and API_KEY)"
echo ""
echo "5. Test print station:"
echo "   TEST_MODE=true node print-station.js"
echo ""
echo "6. Enable auto-start:"
echo "   sudo cp ~/print-station/print-station.service /etc/systemd/system/"
echo "   sudo systemctl enable print-station"
echo "   sudo systemctl start print-station"
echo ""
echo "=========================================="
echo "CUPS Web Interface: http://$(hostname -I | awk '{print $1}'):631"
echo "SSH Access: ssh pi@$(hostname -I | awk '{print $1}')"
echo "=========================================="
