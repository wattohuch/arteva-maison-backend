# Quick Setup Guide - New Features

## 🚀 Getting Started

### 1. Setup Superuser (Revenue Access)

Run the setup script to configure superuser with revenue password:

```bash
npm run setup-superuser
```

This will:
- Upgrade your account to `superuser` role
- Set a separate revenue password
- Configure phone number for OTP

**Important:** Save your revenue password securely!

---

### 2. Configure WhatsApp Notifications (Optional)

Add to your `.env` file:

```env
# WhatsApp Business API Configuration (Owner Notifications Only)
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_ACCESS_TOKEN=your_access_token_here
WHATSAPP_OWNER_PHONE=+965656115663
```

**Important:** WhatsApp notifications are sent to the OWNER only (+965656115663), not to customers. You'll receive instant alerts about:
- New orders placed
- Payments received
- Order cancellations
- Order status changes

The system works without WhatsApp configuration, but you won't receive instant mobile notifications.

#### How to Get WhatsApp Credentials:

**Option 1: Facebook Business (Free)**
1. Go to https://business.facebook.com
2. Create a Business Account
3. Set up WhatsApp Business API
4. Get Phone Number ID and Access Token from Meta Business Suite

**Option 2: Third-Party Services**
- Twilio: https://www.twilio.com/whatsapp
- MessageBird: https://messagebird.com
- Vonage: https://www.vonage.com

---

### 3. Test the Features

#### Test Order Cancellation
```bash
# Login as customer
# Place an order
# Cancel the order via API:

curl -X POST http://localhost:5000/api/orders/{orderId}/cancel \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Changed my mind"}'
```

**What happens:**
1. Order status changed to "cancelled"
2. Stock restored automatically
3. Owner receives WhatsApp notification with customer contact details
4. Owner contacts customer via WhatsApp to arrange refund
5. Owner manually processes refund in MyFatoorah dashboard

#### Test Revenue Access
```bash
# Check if user is superuser
curl http://localhost:5000/api/admin/check-superuser \
  -H "Authorization: Bearer YOUR_TOKEN"

# Authenticate with revenue password
curl -X POST http://localhost:5000/api/admin/revenue-auth \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"revenuePassword": "your_revenue_password"}'

# Request OTP (if password forgotten)
curl -X POST http://localhost:5000/api/admin/revenue-otp/request \
  -H "Authorization: Bearer YOUR_TOKEN"

# Verify OTP
curl -X POST http://localhost:5000/api/admin/revenue-otp/verify \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"otp": "123456"}'
```

#### Test Multi-Category Products
```bash
# Create product with multiple categories
curl -X POST http://localhost:5000/api/admin/products \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "name=Luxury Bowl Set" \
  -F "category=64abc123..." \
  -F "additionalCategories=[\"64def456...\",\"64ghi789...\"]" \
  -F "price=65" \
  -F "stock=10"
```

---

## 📱 Frontend Integration

### 1. Order Cancellation Button

Add to order details page:

```html
<button 
  onclick="cancelOrder('ORDER_ID')" 
  class="btn-cancel"
  v-if="order.orderStatus !== 'delivered' && order.orderStatus !== 'cancelled'">
  Cancel Order
</button>

<script>
async function cancelOrder(orderId) {
  if (!confirm('Are you sure you want to cancel this order?')) return;
  
  const reason = prompt('Please provide a reason for cancellation:');
  
  const response = await fetch(`/api/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reason })
  });
  
  const data = await response.json();
  
  if (data.success) {
    alert('Order cancelled successfully. Refund will be processed within 5-7 business days.');
    location.reload();
  } else {
    alert('Failed to cancel order: ' + data.message);
  }
}
</script>
```

---

### 2. Revenue Access Modal (Superuser Only)

Add to admin dashboard:

```html
<!-- Revenue Tile -->
<div class="revenue-tile" :class="{ blurred: !isSuperuser || !revenueUnlocked }">
  <h3>Total Revenue</h3>
  <p class="amount">{{ totalRevenue }} KWD</p>
  
  <button v-if="isSuperuser && !revenueUnlocked" @click="showRevenueAuth = true">
    🔒 Unlock Revenue Data
  </button>
  
  <p v-if="!isSuperuser" class="access-denied">
    Access restricted to superuser only
  </p>
</div>

<!-- Revenue Authentication Modal -->
<div v-if="showRevenueAuth" class="modal">
  <div class="modal-content">
    <h2>Revenue Access Authentication</h2>
    
    <div v-if="!showOTPForm">
      <input 
        type="password" 
        v-model="revenuePassword" 
        placeholder="Enter revenue password"
      />
      <button @click="authenticateRevenue">Unlock</button>
      <a href="#" @click="requestOTP">Forgot revenue password?</a>
    </div>
    
    <div v-else>
      <p>OTP sent to your email and phone</p>
      <input 
        type="text" 
        v-model="otp" 
        placeholder="Enter 6-digit OTP"
        maxlength="6"
      />
      <button @click="verifyOTP">Verify OTP</button>
    </div>
  </div>
</div>

<script>
export default {
  data() {
    return {
      isSuperuser: false,
      revenueUnlocked: false,
      showRevenueAuth: false,
      showOTPForm: false,
      revenuePassword: '',
      otp: '',
      totalRevenue: 0
    }
  },
  
  async mounted() {
    await this.checkSuperuser();
    if (this.isSuperuser) {
      // Revenue data will be loaded after authentication
    }
  },
  
  methods: {
    async checkSuperuser() {
      const response = await fetch('/api/admin/check-superuser', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await response.json();
      this.isSuperuser = data.isSuperuser;
    },
    
    async authenticateRevenue() {
      const response = await fetch('/api/admin/revenue-auth', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ revenuePassword: this.revenuePassword })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.revenueUnlocked = true;
        this.showRevenueAuth = false;
        await this.loadRevenueData();
      } else {
        alert('Invalid revenue password');
      }
    },
    
    async requestOTP() {
      const response = await fetch('/api/admin/revenue-otp/request', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.showOTPForm = true;
        alert('OTP sent to your email and phone');
      }
    },
    
    async verifyOTP() {
      const response = await fetch('/api/admin/revenue-otp/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ otp: this.otp })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.revenueUnlocked = true;
        this.showRevenueAuth = false;
        await this.loadRevenueData();
      } else {
        alert('Invalid OTP');
      }
    },
    
    async loadRevenueData() {
      const response = await fetch('/api/admin/revenue-history', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await response.json();
      this.totalRevenue = data.data.summary.allTime.revenue;
    }
  }
}
</script>

<style>
.revenue-tile.blurred {
  filter: blur(8px);
  pointer-events: none;
  user-select: none;
}

.revenue-tile.blurred button {
  filter: none;
  pointer-events: all;
}
</style>
```

---

### 3. Multi-Category Product Form

Update product edit form:

```html
<div class="form-group">
  <label>Primary Category *</label>
  <select v-model="product.category" required>
    <option v-for="cat in categories" :key="cat._id" :value="cat._id">
      {{ cat.name }}
    </option>
  </select>
</div>

<div class="form-group">
  <label>Additional Categories</label>
  <p class="hint">Select categories where this product should also appear</p>
  
  <div class="category-checkboxes">
    <label v-for="cat in categories" :key="cat._id" class="checkbox-label">
      <input 
        type="checkbox" 
        :value="cat._id"
        v-model="product.additionalCategories"
        :disabled="cat._id === product.category"
      />
      <span :class="{ highlighted: isSelected(cat._id) }">
        {{ cat.name }}
      </span>
    </label>
  </div>
  
  <p v-if="selectedCategoriesCount > 1" class="info">
    ℹ️ This product will appear in {{ selectedCategoriesCount }} categories
  </p>
</div>

<script>
export default {
  computed: {
    selectedCategoriesCount() {
      return 1 + (this.product.additionalCategories?.length || 0);
    }
  },
  
  methods: {
    isSelected(catId) {
      return catId === this.product.category || 
             this.product.additionalCategories?.includes(catId);
    }
  }
}
</script>

<style>
.checkbox-label span.highlighted {
  background-color: #8b7355;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
}
</style>
```

---

### 4. Track Order Button

Add to order list:

```html
<div class="order-card">
  <h3>Order #{{ order.orderNumber }}</h3>
  <p>Status: {{ order.orderStatus }}</p>
  <p>Total: {{ order.total }} KWD</p>
  
  <div class="order-actions">
    <button @click="viewOrder(order._id)">View Details</button>
    <button @click="trackOrder(order.orderNumber)" class="btn-track">
      📍 Track Order
    </button>
  </div>
</div>

<script>
async function trackOrder(orderNumber) {
  const response = await fetch(`/api/orders/by-number/${orderNumber}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const { data: order } = await response.json();
  
  // Show tracking modal
  showTrackingModal(order);
}

function showTrackingModal(order) {
  // Display modal with:
  // - Current status with icon
  // - Status history timeline
  // - Delivery location on map (if available)
  // - Estimated delivery time
}
</script>
```

---

## 🎨 UI/UX Recommendations

### Order Cancellation
- Show cancel button only for cancellable orders
- Require confirmation before cancelling
- Show refund information clearly
- Display estimated refund time (5-7 business days)

### Revenue Access
- Blur revenue tile for non-superusers
- Show lock icon with "Access Restricted" message
- For superusers, show unlock button
- Implement smooth transition when unlocking
- Cache authentication for session duration

### Multi-Category Products
- Highlight selected categories visually
- Show count of categories product appears in
- Disable primary category in additional categories list
- Show preview of category pages where product will appear

### Track Order
- Use icons for each status (✅ 📦 🚚 🛵 🏠)
- Show timeline with completed/active/pending states
- Display delivery location on map if available
- Auto-refresh status every 30 seconds
- Show estimated delivery time

---

## 🔧 Troubleshooting

### Issue: Revenue OTP not received
**Solution:** Check email service configuration in `.env`. OTP is sent to mohammadalawaji2@gmail.com

### Issue: WhatsApp notifications not working
**Solution:** Verify WhatsApp API credentials. System works without WhatsApp, it's optional.

### Issue: Order cancellation fails
**Solution:** Check if order is already delivered or cancelled. Only pending/processing orders can be cancelled.

### Issue: Customer asking about refund
**Solution:** 
1. Check WhatsApp for cancellation notification
2. Contact customer via WhatsApp
3. Manually process refund in MyFatoorah dashboard
4. Confirm with customer

### Issue: Multi-category not showing
**Solution:** Ensure `additionalCategories` is sent as array in API request.

---

## 📞 Support

For help:
- Email: mohammadalawaji2@gmail.com
- Phone: +965656115663

---

## ⚠️ CRITICAL: Daily Tasks

### Must Do Every Day:

1. **Check WhatsApp for notifications**
   - New orders
   - Order cancellations (contact customer for refund)
   - Status updates

2. **Process refunds when customers cancel**
   - Customer cancels order
   - You receive WhatsApp notification
   - Contact customer via WhatsApp
   - Manually process refund in MyFatoorah dashboard

### Why This Matters:
- Personal customer service via WhatsApp
- Control over refund process
- Better customer relationships
- Flexibility in handling situations

**Keep WhatsApp notifications enabled on your phone!** 📱

---

**Ready to go! 🚀**
