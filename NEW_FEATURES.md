# ARTÉVA Maison - New Features Implementation

## 🎯 Overview
This document outlines the new features implemented for the ARTÉVA Maison e-commerce platform.

---

## 1. 🔄 Order Cancellation (Manual Refund via WhatsApp)

### Features
- Customers can cancel orders directly from their order page
- Stock automatically restored when order is cancelled
- **Refunds handled manually via WhatsApp contact**
- Owner receives WhatsApp notification with customer contact details
- Email notification sent to customer

### How It Works
1. Customer cancels order via website
2. System restores product stock immediately
3. Order status changed to "cancelled"
4. **Owner receives WhatsApp notification with customer contact info**
5. **Owner contacts customer via WhatsApp to arrange refund**
6. Owner processes refund manually through MyFatoorah dashboard

### Why Manual Refunds?
- More control over refund process
- Can discuss with customer before refunding
- Avoid automatic refund complications
- Personal customer service via WhatsApp
- Flexibility in handling different situations

### API Endpoint
```
POST /api/orders/:id/cancel
Authorization: Bearer <token>

Body:
{
  "reason": "Customer changed mind"
}

Response:
{
  "success": true,
  "message": "Order cancelled successfully",
  "data": {
    "orderNumber": "ART-000123",
    "orderStatus": "cancelled",
    "paymentStatus": "paid",
    "notes": "[REFUND REQUIRED] Customer cancelled order. Contact customer for refund: +965XXXXXXXX"
  }
}
```

### Business Rules
- Cannot cancel delivered orders
- Cannot cancel already cancelled orders
- Stock is restored immediately upon cancellation
- **No automatic refund - owner must contact customer via WhatsApp**
- Owner receives WhatsApp notification with customer contact details

### Owner Workflow
1. Receive WhatsApp notification about cancellation
2. Contact customer via WhatsApp to confirm refund
3. Login to MyFatoorah dashboard: https://portal.myfatoorah.com
4. Manually process refund for the customer
5. Confirm with customer that refund is processed

### Database Changes
- No new fields required
- Uses existing `orderStatus` and `paymentStatus` fields
- Cancellation reason stored in `notes` field

### WhatsApp Notification to Owner
When order is cancelled, owner receives:
```
❌ ORDER CANCELLED

📦 Order: ART-000123
👤 Customer: John Doe
📞 Phone: +965XXXXXXXX
📧 Email: customer@email.com

💰 Amount: 65.000 KWD
💳 Payment Status: PAID

📝 Reason: Customer changed mind

⚠️ REFUND REQUIRED
Customer paid 65.000 KWD
Contact customer to arrange refund:
📞 +965XXXXXXXX
📧 customer@email.com

🌐 View in admin: https://www.artevamaisonkw.com/admin/orders
```

---

## 2. 👑 Superuser Revenue Access with OTP Authentication

### Features
- New `superuser` role with exclusive revenue access
- Separate revenue password (different from account password)
- OTP-based authentication for forgotten revenue password
- Revenue tile blurred for non-superusers
- OTP sent via email and SMS

### User Model Changes
```javascript
role: {
  type: String,
  enum: ['user', 'admin', 'driver', 'owner', 'superuser'],
  default: 'user'
},
revenuePassword: {
  type: String,
  select: false
},
revenueOTP: String,
revenueOTPExpiry: Date
```

### API Endpoints

#### Check Superuser Status
```
GET /api/admin/check-superuser
Authorization: Bearer <token>

Response:
{
  "success": true,
  "isSuperuser": true
}
```

#### Authenticate Revenue Access
```
POST /api/admin/revenue-auth
Authorization: Bearer <token>

Body:
{
  "revenuePassword": "revenue_password_here"
}

Response:
{
  "success": true,
  "message": "Revenue access authenticated"
}
```

#### Request Revenue OTP
```
POST /api/admin/revenue-otp/request
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "OTP sent to registered email and phone number"
}
```

OTP will be sent to:
- Email: mohammadalawaji2@gmail.com
- Phone: +96550683207

#### Verify Revenue OTP
```
POST /api/admin/revenue-otp/verify
Authorization: Bearer <token>

Body:
{
  "otp": "123456"
}

Response:
{
  "success": true,
  "message": "OTP verified successfully"
}
```

### Frontend Implementation Guide
1. Check if user is superuser on dashboard load
2. Show revenue tile blurred for non-superusers
3. For superusers, prompt for revenue password
4. If password forgotten, show "Forgot Revenue Password?" link
5. Request OTP and show verification form
6. After successful authentication, show revenue data

---

## 3. 🏷️ Multi-Category Product Support

### Features
- Products can belong to multiple categories
- Primary category + additional categories
- Products appear in all assigned category pages
- Category selection UI shows existing categories with highlighting

### Product Model Changes
```javascript
category: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Category',
  required: true  // Primary category
},
additionalCategories: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Category'
}]
```

### API Changes

#### Create Product
```
POST /api/admin/products

Body (FormData):
{
  "name": "Luxury Bowl Set",
  "category": "64abc123...",  // Primary category ID
  "additionalCategories": ["64def456...", "64ghi789..."],  // Array of category IDs
  ...
}
```

#### Update Product
```
PUT /api/admin/products/:id

Body (FormData):
{
  "additionalCategories": ["64def456...", "64ghi789..."],
  ...
}
```

#### Get Products by Category
```
GET /api/products?category=64abc123...

Returns products where:
- category === 64abc123... OR
- additionalCategories contains 64abc123...
```

### Frontend Implementation Guide
1. When editing product, fetch all categories
2. Display primary category dropdown
3. Display additional categories as checkboxes/multi-select
4. Highlight selected categories
5. Show message: "This product will appear in [X] categories"
6. On category page, show all products from that category (primary + additional)

---

## 4. 📱 WhatsApp Notifications (Owner Only)

### Features
- Automatic WhatsApp notifications sent to OWNER for all order events
- Owner receives instant alerts for new orders
- Owner gets notified about order cancellations
- Owner receives updates when order status changes
- Owner gets notified when payments are received
- Supports WhatsApp Business API

### Configuration
Add to `.env`:
```env
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_OWNER_PHONE=+96550683207
```

### Notification Types

#### New Order Notification (to Owner)
Sent when customer places an order
```
🔔 NEW ORDER RECEIVED

📦 Order: ART-000123
👤 Customer: John Doe
📞 Phone: +965XXXXXXXX
📧 Email: customer@email.com

💰 Total: 65.000 KWD
💳 Payment: KNET
📊 Status: CONFIRMED

Items (2):
• Luxury Bowl x1 - 30.000 KWD
• Crystal Vase x1 - 35.000 KWD

📍 Delivery Address:
Street 15, Block 3
Kuwait City, Kuwait
📞 +965XXXXXXXX

🌐 View in admin: https://www.artevamaisonkw.com/admin/orders
```

#### Payment Received Notification (to Owner)
Sent when payment is confirmed
```
💰 PAYMENT RECEIVED

📦 Order: ART-000123
👤 Customer: John Doe

💳 Amount: 65.000 KWD
💳 Method: KNET
✅ Status: PAID

🌐 View in admin: https://www.artevamaisonkw.com/admin/orders
```

#### Order Cancellation Notification (to Owner)
Sent when customer cancels order
```
❌ ORDER CANCELLED

📦 Order: ART-000123
👤 Customer: John Doe
📞 Phone: +965XXXXXXXX

💰 Amount: 65.000 KWD
💳 Payment Status: REFUND_PENDING

📝 Reason: Customer changed mind

💳 Refund Status: Processing

🌐 View in admin: https://www.artevamaisonkw.com/admin/orders
```

#### Order Status Change Notification (to Owner)
Sent when admin updates order status
```
🛵 ORDER STATUS UPDATED

📦 Order: ART-000123
👤 Customer: John Doe

📊 Status Changed:
CONFIRMED → OUT_FOR_DELIVERY

💰 Total: 65.000 KWD

🌐 View in admin: https://www.artevamaisonkw.com/admin/orders
```

### Setup Guide

#### Option 1: WhatsApp Business API (Recommended)
1. Create Facebook Business Account
2. Set up WhatsApp Business API
3. Get Phone Number ID and Access Token
4. Add credentials to `.env`

#### Option 2: Third-Party Services
- Twilio WhatsApp API
- MessageBird
- Vonage (Nexmo)

### Testing
```javascript
// Test WhatsApp notification
const whatsapp = require('./services/whatsappService');

await whatsapp.sendMessage('+965XXXXXXXX', 'Test message from ARTÉVA Maison');
```

---

## 5. 📍 Track Order Button

### Features
- Track order button on order list and order details pages
- Real-time order status tracking
- Delivery location tracking (if available)
- Status history timeline

### Frontend Implementation

#### Order List Page
```html
<div class="order-card">
  <h3>Order #ART-000123</h3>
  <p>Status: Out for Delivery</p>
  <button onclick="trackOrder('ART-000123')">Track Order</button>
</div>
```

#### Track Order Function
```javascript
async function trackOrder(orderNumber) {
  const response = await fetch(`/api/orders/by-number/${orderNumber}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const { data: order } = await response.json();
  
  // Show tracking modal with:
  // - Current status
  // - Status history timeline
  // - Delivery location on map (if available)
  // - Estimated delivery time
  
  showTrackingModal(order);
}
```

#### Tracking Modal UI
```html
<div class="tracking-modal">
  <h2>Track Order #ART-000123</h2>
  
  <div class="current-status">
    <span class="status-icon">🛵</span>
    <h3>Out for Delivery</h3>
    <p>Your order will arrive soon</p>
  </div>
  
  <div class="status-timeline">
    <div class="status-item completed">
      <span class="icon">✅</span>
      <div>
        <h4>Order Confirmed</h4>
        <p>May 4, 2026 10:30 AM</p>
      </div>
    </div>
    <div class="status-item completed">
      <span class="icon">📦</span>
      <div>
        <h4>Order Packed</h4>
        <p>May 4, 2026 2:15 PM</p>
      </div>
    </div>
    <div class="status-item active">
      <span class="icon">🛵</span>
      <div>
        <h4>Out for Delivery</h4>
        <p>May 4, 2026 4:00 PM</p>
      </div>
    </div>
    <div class="status-item pending">
      <span class="icon">🏠</span>
      <div>
        <h4>Delivered</h4>
        <p>Pending</p>
      </div>
    </div>
  </div>
  
  <div id="delivery-map"></div>
</div>
```

---

## 🚀 Deployment Checklist

### Environment Variables
Add to production `.env`:
```env
# WhatsApp Configuration
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_BUSINESS_PHONE=+96550683207
```

### Database Migration
No migration needed - new fields are optional and will be added automatically.

### Testing Checklist
- [ ] Test order cancellation flow
- [ ] Test refund initiation
- [ ] Test superuser revenue access
- [ ] Test OTP generation and verification
- [ ] Test multi-category product creation
- [ ] Test multi-category product filtering
- [ ] Test WhatsApp notifications
- [ ] Test track order functionality

### Frontend Updates Required
1. Add cancel order button to order details page
2. Implement revenue authentication modal for superusers
3. Update product form to support multiple categories
4. Add track order button to order list
5. Create order tracking modal/page
6. Update order status display with icons

---

## 📝 Notes

### Security Considerations
- Revenue password should be hashed separately from account password
- OTP expires after 10 minutes
- Only superuser can access revenue endpoints
- Refunds require payment gateway authentication

### Performance
- WhatsApp notifications are non-blocking (fire and forget)
- Multi-category queries use indexed fields
- Order cancellation restores stock atomically

### Future Enhancements
- SMS notifications as backup for WhatsApp
- Push notifications for mobile app
- Advanced revenue analytics dashboard
- Bulk product category assignment
- Customer refund status tracking page

---

## 🆘 Support

For issues or questions:
- Email: mohammadalawaji2@gmail.com
- Phone: +96550683207

---

**Last Updated:** May 4, 2026
**Version:** 2.0.0
