# 🖨️ ARTÉVA MAISON PRINT STATION - COMPLETE IDIOT'S GUIDE

**Last Updated:** May 13, 2026  
**Hardware:** Raspberry Pi + HP Smart Tank 790  
**Status:** ✅ FULLY OPERATIONAL

---

## 📋 WHAT YOU HAVE

### Hardware Setup
- **Raspberry Pi** (Debian Trixie) at `printstation`
- **HP Smart Tank 790** printer on WiFi at IP: `192.168.118.100`
- **Printer Name in CUPS:** `hp-smarttank`
- **Connection:** WiFi via IPP (Internet Printing Protocol)

### Software Status
- ✅ Chromium browser installed at `/usr/bin/chromium`
- ✅ Node.js and npm installed
- ✅ Print station script at `~/print-station/`
- ✅ CUPS configured with HP printer
- ✅ Local test print **SUCCESSFUL**

### Backend
- **URL:** `https://arteva-maison-backend.onrender.com`
- **Issue:** Render free tier hibernates after inactivity
- **Solution:** Keep-alive pings every 5 minutes + 60-second timeouts

---

## 🚀 QUICK START (COPY-PASTE THESE COMMANDS)

### Step 1: Upload Fixed Script to Raspberry Pi

On your **Windows PC**, run:
```bash
scp "c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend\print-station-hp.js" pi@printstation:~/print-station/print-station.js
```

### Step 2: Test the Print Station

SSH into Raspberry Pi:
```bash
ssh pi@printstation
```

Wake up backend and test:
```bash
cd ~/print-station

# Wake up backend first (wait 30 seconds)
curl https://arteva-maison-backend.onrender.com/api/products
sleep 30

# Run test print
TEST_MODE=true node print-station.js
```

**Expected Output:**
```
✓ Browser initialized successfully
✓ Backend keep-alive ping successful
📦 Processing order TEST-001
✓ Printed receipt for order TEST-001
✓ Printed shipping label for order TEST-001
✓ Printed packing slip for order TEST-001
✓ Successfully processed order TEST-001
Test print completed
```

### Step 3: Enable Auto-Start Service

```bash
# Enable service to start on boot
sudo systemctl enable print-station

# Start service now
sudo systemctl start print-station

# Check status
sudo systemctl status print-station
```

### Step 4: Monitor Logs

```bash
# Watch live logs
tail -f ~/print-station/logs/print-station.log

# Or check service logs
sudo journalctl -u print-station -f
```

---

## 🔧 WHAT WAS FIXED

### Problem 1: Backend Hibernation (HTTP 503)
**Error:** `hibernate-wake-error` from Render free tier

**Solution:**
- Added `keepBackendAwake()` function that pings `/api/products` every 5 minutes
- Backend wakes up before connecting Socket.io
- Keeps backend alive 24/7

### Problem 2: Timeout Errors
**Error:** `timeout of 10000ms exceeded`

**Solution:**
- Increased all axios timeouts from 10 seconds to 60 seconds
- Gives backend time to wake up from hibernation

### Problem 3: Wrong Chromium Path
**Error:** `spawn /usr/bin/chromium-browser ENOENT`

**Solution:**
- Changed from `/usr/bin/chromium-browser` to `/usr/bin/chromium`
- Debian Trixie uses `chromium` package, not `chromium-browser`

---

## 🧪 HOW TO SIMULATE AN ORDER

### Method 1: From Admin Dashboard

1. Go to: `https://arteva-maison.vercel.app/admin.html`
2. Login with your admin account
3. Click **"Orders"** tab
4. Find any pending order
5. The print station will automatically detect and print it

### Method 2: Create Test Order via API

On Raspberry Pi or your PC:

```bash
# Your JWT token
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OTQwZTY4NjcxN2EzOGJjNjczZTdmMCIsImlhdCI6MTc3ODM0NzA4NywiZXhwIjoxOTk5MjUwMjg3fQ.LT8NzouiJGLOb9SSQcYlmEPwcckyJRgNTl2aJvBY5yA"

# Create a test order
curl -X POST https://arteva-maison-backend.onrender.com/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "items": [
      {
        "product": "PRODUCT_ID_HERE",
        "quantity": 1,
        "price": 25.500
      }
    ],
    "shippingAddress": {
      "fullName": "Test Customer",
      "phone": "+965 1234 5678",
      "street": "123 Test Street",
      "city": "Kuwait City",
      "governorate": "Capital",
      "country": "Kuwait"
    },
    "paymentMethod": "Credit Card"
  }'
```

### Method 3: Place Order from Website

1. Go to: `https://arteva-maison.vercel.app`
2. Add products to cart
3. Checkout and complete payment
4. Print station will automatically print receipt

---

## 📊 MONITORING & TROUBLESHOOTING

### Check Print Station Status

```bash
# Is service running?
sudo systemctl status print-station

# View recent logs
tail -n 50 ~/print-station/logs/print-station.log

# Check if backend is awake
curl https://arteva-maison-backend.onrender.com/api/products
```

### Common Issues

#### Issue: "Failed to fetch receipt HTML"
**Cause:** Backend is hibernating  
**Solution:** Wait 30 seconds, script will retry automatically

#### Issue: "Failed to initialize browser"
**Cause:** Chromium not installed or wrong path  
**Solution:**
```bash
sudo apt update
sudo apt install -y chromium
which chromium  # Should show /usr/bin/chromium
```

#### Issue: "Printer not found"
**Cause:** CUPS printer not configured  
**Solution:**
```bash
lpstat -p  # List printers
# Should show: hp-smarttank

# If missing, re-add printer:
sudo lpadmin -p hp-smarttank -v ipp://192.168.118.100/ipp/print -E
```

#### Issue: "Connection refused"
**Cause:** Backend is down or network issue  
**Solution:**
```bash
# Test backend connectivity
curl -v https://arteva-maison-backend.onrender.com/health

# Check Raspberry Pi internet
ping -c 3 google.com
```

### Restart Print Station

```bash
# Restart service
sudo systemctl restart print-station

# Or stop and start manually
sudo systemctl stop print-station
cd ~/print-station
node print-station.js
```

---

## 📁 FILE LOCATIONS

### On Raspberry Pi
- **Script:** `~/print-station/print-station.js`
- **Config:** `~/print-station/.env`
- **Logs:** `~/print-station/logs/print-station.log`
- **State:** `~/print-station/data/last-order.json`
- **Temp PDFs:** `~/print-station/temp/`
- **Service:** `/etc/systemd/system/print-station.service`

### On Windows PC
- **Script:** `c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend\print-station-hp.js`
- **Package:** `c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-backend\print-station-hp-package.json`

---

## 🔐 CONFIGURATION

### Environment Variables (`.env`)

```bash
# Backend
API_URL=https://arteva-maison-backend.onrender.com
API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OTQwZTY4NjcxN2EzOGJjNjczZTdmMCIsImlhdCI6MTc3ODM0NzA4NywiZXhwIjoxOTk5MjUwMjg3fQ.LT8NzouiJGLOb9SSQcYlmEPwcckyJRgNTl2aJvBY5yA

# Printer
PRINTER_NAME=hp-smarttank
PRINTER_TYPE=HP
PAPER_SIZE=A4

# What to print
PRINT_RECEIPT=true
PRINT_LABEL=false
PRINT_PACKING=false

# Test mode
TEST_MODE=false
```

### Get New JWT Token

1. Go to: `https://arteva-maison.vercel.app/admin.html`
2. Login with admin account
3. Open browser console (F12)
4. Type: `localStorage.getItem('arteva_token')`
5. Copy the token (without quotes)
6. Update `.env` file on Raspberry Pi

---

## 🎯 WHAT PRINTS AUTOMATICALLY

When a new order is placed:

1. **Receipt** (A4 paper)
   - Matches your reference design exactly
   - Gold accents (#D4AF37)
   - Bilingual English/Arabic
   - QR code for order tracking
   - Return policy section
   - Professional typography

2. **Shipping Label** (Optional - set `PRINT_LABEL=true`)
   - Large text for easy reading
   - Customer address
   - Order number

3. **Packing Slip** (Optional - set `PRINT_PACKING=true`)
   - Checklist for warehouse
   - All items with quantities
   - Quality check boxes

---

## 🚨 EMERGENCY COMMANDS

### Stop Everything
```bash
sudo systemctl stop print-station
```

### Clear Stuck Print Jobs
```bash
cancel -a
```

### Reset Print Station
```bash
sudo systemctl stop print-station
rm -rf ~/print-station/temp/*
rm -rf ~/print-station/data/*
sudo systemctl start print-station
```

### Check Printer Status
```bash
lpstat -p hp-smarttank
lpq -P hp-smarttank
```

---

## ✅ FINAL CHECKLIST

- [x] HP Smart Tank 790 connected to WiFi
- [x] Printer added to CUPS as `hp-smarttank`
- [x] Chromium installed at `/usr/bin/chromium`
- [x] Print station script uploaded
- [x] Dependencies installed (`npm install`)
- [x] `.env` file configured with JWT token
- [x] Local test print successful
- [x] Backend keep-alive enabled
- [x] Timeouts increased to 60 seconds
- [ ] **Run test with backend connection**
- [ ] **Enable systemd service**
- [ ] **Place real order to verify**

---

## 📞 SUPPORT

If something breaks:

1. Check logs: `tail -f ~/print-station/logs/print-station.log`
2. Check service: `sudo systemctl status print-station`
3. Test printer: `echo "Test" | lpr -P hp-smarttank`
4. Test backend: `curl https://arteva-maison-backend.onrender.com/api/products`
5. Restart everything: `sudo systemctl restart print-station`

---

**Remember:** The backend hibernates on Render free tier. The script now handles this automatically with keep-alive pings every 5 minutes and 60-second timeouts. Just let it run!
