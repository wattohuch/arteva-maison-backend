# 🧾 ARTÉVA MAISON Receipt System

## Overview

Professional, pixel-perfect A4 receipt generation system for automatic printing via Raspberry Pi print station.

---

## 📁 Files

### Core Implementation
- **`src/utils/receiptTemplate.js`** - Main receipt HTML template generator
- **`src/controllers/adminController.js`** - Receipt endpoint controller
- **`src/routes/admin.js`** - Receipt API route

### Print Station
- **`print-station-hp.js`** - Raspberry Pi print automation (no changes needed)

### Documentation
- **`RECEIPT_REDESIGN_COMPLETE.md`** - Complete implementation guide
- **`RECEIPT_IMPLEMENTATION_CHECKLIST.md`** - 150+ point verification checklist
- **`RECEIPT_BEFORE_AFTER.md`** - Visual comparison and improvements
- **`DEPLOY_NEW_RECEIPT.md`** - Deployment instructions
- **`README_RECEIPT_SYSTEM.md`** - This file

---

## 🎨 Design Specifications

### Paper & Print
- **Size**: A4 Portrait (210mm × 297mm)
- **Margins**: 10mm all sides
- **Quality**: 300 DPI ready
- **Colors**: Full color with exact preservation

### Typography
- **Display**: Cormorant Garamond (serif) - Brand name, titles
- **Body**: Montserrat (sans-serif) - All content
- **Arabic**: Noto Sans Arabic - RTL text
- **Sizes**: 11px-32px (optimized for print)

### Colors
- **Primary Text**: #2c241b (dark brown)
- **Secondary Text**: #6b7280 (gray)
- **Gold Accent**: #D4AF37 (brand color)
- **Backgrounds**: #fafaf8 (beige), #fffbeb (yellow)
- **Borders**: #e6e1d6 (light brown)

---

## 📋 Receipt Sections

1. **Header**
   - Brand name (ARTÉVA MAISON)
   - Receipt title (English + Arabic)
   - Gold divider line

2. **Summary Row**
   - Order number
   - Date
   - Order status badge

3. **Customer Details**
   - Name, email, phone
   - Bilingual labels

4. **Shipping Address**
   - Multi-line formatted address
   - Bilingual labels

5. **Payment Info**
   - Payment method
   - Payment status badge

6. **Products Table**
   - SKU, Item, Unit Price, Qty, Total
   - Bilingual headers
   - Arabic product names

7. **Totals**
   - Subtotal
   - Delivery
   - Total Paid (bold, gold border)

8. **QR Code**
   - Links to digital receipt
   - Gold-bordered box
   - Bilingual labels

9. **Return Policy**
   - 14-day policy details
   - English + Arabic
   - WhatsApp contact

10. **Footer**
    - Thank you message
    - Contact information

---

## 🔌 API Endpoint

### Generate Receipt
```
GET /api/admin/receipt/:orderId
```

**Authentication**: Requires superuser token

**Parameters**:
- `orderId` - MongoDB ObjectId of the order

**Response**: HTML document (text/html)

**Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://arteva-maison-backend.onrender.com/api/admin/receipt/ORDER_ID
```

---

## 🖨️ Print Flow

```
Order Placed → Payment Confirmed → Socket.io Notification
                                          ↓
                                   Print Station
                                          ↓
                              Fetch Receipt HTML from API
                                          ↓
                              Puppeteer Renders to PDF
                                          ↓
                              PDF Sent to HP SmartTank
                                          ↓
                              Receipt Printed on A4
```

---

## 💻 Usage

### In Code (Backend)
```javascript
const { generateReceiptHTML } = require('../utils/receiptTemplate');

// Generate receipt HTML
const html = generateReceiptHTML(order);

// Send as response
res.setHeader('Content-Type', 'text/html; charset=utf-8');
res.send(html);
```

### Via Print Station
The print station automatically:
1. Receives new order notification
2. Fetches receipt HTML from backend
3. Converts to PDF using Puppeteer
4. Sends to printer via `lpr` command

**No manual intervention required!**

---

## 🧪 Testing

### Test Receipt Generation
```bash
# Via API
curl -H "Authorization: Bearer TOKEN" \
  https://arteva-maison-backend.onrender.com/api/admin/receipt/ORDER_ID \
  > test-receipt.html

# Open in browser
open test-receipt.html
```

### Test Print Station
```bash
# SSH into Raspberry Pi
ssh pi@raspberry-pi-ip

# Run test mode
cd /home/pi/arteva-print-station
TEST_MODE=true node print-station-hp.js
```

---

## 🚀 Deployment

### Backend
```bash
git add src/utils/receiptTemplate.js
git add src/controllers/adminController.js
git commit -m "feat: pixel-perfect receipt redesign"
git push origin main
```

Backend auto-deploys on Render.

### Print Station
**No changes needed!** Automatically uses new design once backend is deployed.

---

## 🔧 Customization

### Change Colors
Edit `src/utils/receiptTemplate.js`:
```javascript
// Find color definitions in CSS
.brand-name { color: #2c241b; }  // Change brand color
border-bottom: 1.5px solid #D4AF37;  // Change gold accent
```

### Change Fonts
Edit Google Fonts link:
```html
<link href="https://fonts.googleapis.com/css2?family=YOUR_FONT&display=swap" rel="stylesheet">
```

### Change Layout
Modify grid layouts:
```css
.info-section {
  grid-template-columns: 1fr 1fr;  // Change to 1fr for single column
  gap: 16px;  // Adjust spacing
}
```

### Change Content
Edit text in `generateReceiptHTML()` function:
```javascript
<div class="receipt-title">YOUR CUSTOM TITLE</div>
```

---

## 📊 Features

### ✅ Implemented
- Pixel-perfect A4 layout
- Professional typography
- Full bilingual support (English + Arabic)
- Color-coded status badges
- QR code generation
- Return policy section
- Print optimization
- Modular code structure
- Google Fonts integration
- RTL text rendering
- Responsive grid layouts
- Professional spacing
- Brand color accents

### 🎯 Benefits
- Professional appearance
- Brand consistency
- Customer trust
- Clear information
- Easy to read
- Scannable QR code
- Complete order details
- Return policy visible
- Contact info accessible
- Print-ready format

---

## 🐛 Troubleshooting

### Receipt not generating
- Check order exists and is paid
- Verify superuser authentication
- Check backend logs on Render

### Print station not printing
- Check print station logs: `tail -f logs/print-station.log`
- Restart service: `sudo systemctl restart arteva-print-station`
- Verify printer connection: `lpstat -p`

### Arabic text not displaying
- Ensure Google Fonts are loading
- Check Noto Sans Arabic font
- Verify RTL direction applied

### Receipt doesn't fit on page
- Check @page margin (should be 10mm)
- Verify A4 paper size in printer
- Check PDF generation settings

---

## 📞 Support

### Logs
```bash
# Backend logs (Render dashboard)
https://dashboard.render.com → arteva-maison-backend → Logs

# Print station logs (Raspberry Pi)
tail -f /home/pi/arteva-print-station/logs/print-station.log
```

### Status Checks
```bash
# Print station service
sudo systemctl status arteva-print-station

# Printer status
lpstat -p hp-smarttank

# Test print
echo "Test" | lpr -P hp-smarttank
```

---

## 📚 Documentation

- **Implementation Guide**: `RECEIPT_REDESIGN_COMPLETE.md`
- **Checklist**: `RECEIPT_IMPLEMENTATION_CHECKLIST.md`
- **Comparison**: `RECEIPT_BEFORE_AFTER.md`
- **Deployment**: `DEPLOY_NEW_RECEIPT.md`

---

## ✨ Summary

A complete, production-ready receipt system that:

1. ✅ Matches reference design pixel-perfectly
2. ✅ Prints professionally on A4 paper
3. ✅ Supports English + Arabic bilingual content
4. ✅ Integrates seamlessly with print station
5. ✅ Requires no manual intervention
6. ✅ Is easy to maintain and customize
7. ✅ Provides excellent customer experience

**Status**: ✅ Complete and ready for production

**Last Updated**: May 13, 2026

**Version**: 2.0.0 (Pixel-Perfect Redesign)
