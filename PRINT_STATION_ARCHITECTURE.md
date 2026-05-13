# 🏗️ Print Station Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CUSTOMER                                     │
│                            ↓                                         │
│                    Places Order Online                               │
│                            ↓                                         │
└─────────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    ARTEVA MAISON BACKEND                             │
│                  (Render.com / Cloud Server)                         │
│                                                                       │
│  1. Receives order via API                                           │
│  2. Saves to MongoDB                                                 │
│  3. Emits Socket.io event: "new_order"  ⚡                           │
│                            ↓                                         │
└─────────────────────────────────────────────────────────────────────┘
                             ↓
                    WebSocket Connection
                    (Always Open - Persistent)
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    RASPBERRY PI 4/5                                  │
│                   (Your Kitchen/Warehouse)                           │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              PRINT STATION DAEMON                              │  │
│  │              (Node.js Process)                                 │  │
│  │                                                                 │  │
│  │  • Runs 24/7 in background                                     │  │
│  │  • Listens on Socket.io "admin_room"                           │  │
│  │  • Receives "new_order" event                                  │  │
│  │  • Fetches full order details                                  │  │
│  │  • Sends to printer automatically                              │  │
│  │  • NO human interaction needed                                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                            ↓                                         │
│                    USB Connection                                    │
│                            ↓                                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              THERMAL PRINTER                                   │  │
│  │              (80mm Receipt Printer)                            │  │
│  │                                                                 │  │
│  │  Prints automatically:                                         │  │
│  │  1. Customer Receipt                                           │  │
│  │  2. Shipping Label                                             │  │
│  │  3. Packing Slip                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Connection Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                    PERSISTENT CONNECTION                              │
└──────────────────────────────────────────────────────────────────────┘

Backend Server                          Raspberry Pi Print Station
     │                                           │
     │  ◄─────── WebSocket Handshake ──────────►│
     │                                           │
     │  ◄────── join_admin_room event ──────────│
     │                                           │
     │         Connection Established ✓          │
     │  ═══════════════════════════════════════  │
     │         (Always Open - Persistent)        │
     │  ═══════════════════════════════════════  │
     │                                           │
     │                                           │
  [New Order]                                    │
     │                                           │
     │────── emit: "new_order" event ──────────►│
     │        { orderNumber, total, customer }   │
     │                                           │
     │                                      [Received!]
     │                                           │
     │◄────── HTTP GET: /api/admin/orders ──────│
     │                                           │
     │────── Response: Full Order Details ─────►│
     │                                           │
     │                                      [Print Receipt]
     │                                      [Print Label]
     │                                      [Print Packing]
     │                                           │
     │◄────── PATCH: /orders/:id/printed ───────│
     │                                           │
     │────── Response: 200 OK ─────────────────►│
     │                                           │
     │                                      [Done! ✓]
     │                                           │
     │         Waiting for next order...         │
     │  ═══════════════════════════════════════  │
     │         (Connection stays open)           │
     │  ═══════════════════════════════════════  │
```

## Auto-Reconnection Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                    NETWORK RESILIENCE                                 │
└──────────────────────────────────────────────────────────────────────┘

Normal Operation:
    Backend ═══════════ Raspberry Pi
            WebSocket

Internet Drops:
    Backend ╳╳╳╳╳╳╳╳╳╳╳ Raspberry Pi
            Disconnected
                        ↓
                   [Detected!]
                        ↓
                [Start Fallback Polling]
                [Check every 60 seconds]

Reconnection Attempts:
    Backend ─ ─ ─ ─ ─ ─ Raspberry Pi
            Attempt 1... Failed
            Wait 5 seconds
            Attempt 2... Failed
            Wait 5 seconds
            Attempt 3... Success! ✓

Internet Restored:
    Backend ═══════════ Raspberry Pi
            WebSocket Reconnected
                        ↓
                [Stop Fallback Polling]
                        ↓
                [Resume Real-time Mode]
```

## Systemd Service Lifecycle

```
┌──────────────────────────────────────────────────────────────────────┐
│                    ALWAYS RUNNING                                     │
└──────────────────────────────────────────────────────────────────────┘

Raspberry Pi Boots
        ↓
Systemd Starts
        ↓
Loads: print-station.service
        ↓
Executes: node print-station.js
        ↓
Print Station Starts
        ↓
Connects to Backend
        ↓
Joins Admin Room
        ↓
Ready for Orders ✓
        ↓
┌───────────────────┐
│  Running 24/7     │
│  Listening for    │
│  new orders...    │
└───────────────────┘
        ↓
If Crash Detected:
        ↓
Wait 10 seconds
        ↓
Auto-Restart
        ↓
Back to Running ✓
```

## Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                    ORDER TO PRINT FLOW                                │
└──────────────────────────────────────────────────────────────────────┘

1. Order Created
   ├─ Customer: Ahmed Ali
   ├─ Total: 125.500 KWD
   ├─ Items: 3 products
   └─ Status: pending

2. Socket.io Event Emitted
   ├─ Event: "new_order"
   ├─ Room: "admin_room"
   └─ Data: { orderNumber, total, customer, timestamp }

3. Print Station Receives Event (< 1 second)
   ├─ Logs: "🆕 New order notification received"
   └─ Triggers: processOrder()

4. Fetch Full Order Details
   ├─ API Call: GET /api/admin/orders
   ├─ Filter: orderNumber = received value
   └─ Response: Complete order object

5. Print Receipt
   ├─ Format: 80mm thermal receipt
   ├─ Content: Order details, customer info, items, total
   ├─ QR Code: Order tracking link
   └─ Status: ✓ Printed

6. Print Shipping Label
   ├─ Format: Large text for easy reading
   ├─ Content: Delivery address, order number
   ├─ QR Code: Order ID for scanning
   └─ Status: ✓ Printed

7. Print Packing Slip
   ├─ Format: Checklist style
   ├─ Content: Items to pack, quality checks
   └─ Status: ✓ Printed

8. Mark Order as Printed
   ├─ API Call: PATCH /api/admin/orders/:id
   ├─ Data: { printed: true, printedAt: timestamp }
   └─ Status: ✓ Updated

9. Save State
   ├─ File: data/last-order.json
   ├─ Content: { orderId, timestamp }
   └─ Purpose: Prevent duplicates after restart

10. Ready for Next Order
    └─ Total Time: 5-10 seconds
```

## Component Interaction

```
┌──────────────────────────────────────────────────────────────────────┐
│                    RASPBERRY PI COMPONENTS                            │
└──────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Operating System: Raspberry Pi OS Lite (64-bit)                    │
│  ├─ Minimal, no GUI                                                 │
│  ├─ Optimized for 8GB SD card                                       │
│  └─ Headless (no display needed)                                    │
└─────────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Systemd Service: print-station.service                             │
│  ├─ Auto-start on boot                                              │
│  ├─ Auto-restart on crash                                           │
│  └─ Runs as background daemon                                       │
└─────────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Node.js Runtime: v18.x                                             │
│  └─ Executes: print-station.js                                      │
└─────────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Print Station Script: print-station.js                             │
│  ├─ Socket.io Client: Connects to backend                           │
│  ├─ Axios: HTTP requests for order details                          │
│  ├─ node-thermal-printer: Printer control                           │
│  ├─ QRCode: Generate QR codes                                       │
│  └─ dotenv: Load configuration                                      │
└─────────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│  CUPS (Printing System)                                             │
│  ├─ Manages USB printer                                             │
│  ├─ Handles print queue                                             │
│  └─ ESC/POS driver for thermal printer                              │
└─────────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│  USB Thermal Printer                                                │
│  └─ Physical printing                                               │
└─────────────────────────────────────────────────────────────────────┘
```

## Network Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    NETWORK TOPOLOGY                                   │
└──────────────────────────────────────────────────────────────────────┘

Internet
    │
    ├─────────────────────────────────────────┐
    │                                         │
    ↓                                         ↓
┌─────────────────────┐           ┌─────────────────────┐
│  Backend Server     │           │  Your Router        │
│  (Render.com)       │           │  (Home/Office)      │
│                     │           │                     │
│  • Node.js API      │           │  • DHCP Server      │
│  • MongoDB          │           │  • NAT              │
│  • Socket.io Server │           │  • Firewall         │
└─────────────────────┘           └─────────────────────┘
                                            │
                                            ↓
                                  ┌─────────────────────┐
                                  │  Raspberry Pi       │
                                  │  (Print Station)    │
                                  │                     │
                                  │  IP: 192.168.1.100  │
                                  │  (Static)           │
                                  │                     │
                                  │  Ports:             │
                                  │  • 22: SSH          │
                                  │  • 631: CUPS        │
                                  └─────────────────────┘
                                            │
                                            ↓ USB
                                  ┌─────────────────────┐
                                  │  Thermal Printer    │
                                  └─────────────────────┘

Connection Details:
• Protocol: WebSocket (wss:// or ws://)
• Port: 443 (HTTPS) or 80 (HTTP)
• Transport: socket.io-client
• Fallback: Long polling if WebSocket fails
```

## Security Model

```
┌──────────────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                                    │
└──────────────────────────────────────────────────────────────────────┘

1. Authentication
   ├─ API Key in .env file
   ├─ Sent in Authorization header
   └─ Validated by backend

2. Network Security
   ├─ HTTPS/WSS encryption
   ├─ Firewall on Raspberry Pi (ufw)
   └─ Only necessary ports open

3. Access Control
   ├─ SSH key-based auth (recommended)
   ├─ Strong password
   └─ No root login

4. File Permissions
   ├─ .env file: 600 (owner read/write only)
   ├─ Scripts: 755 (owner execute)
   └─ Logs: 644 (owner write, all read)

5. Process Isolation
   ├─ Runs as 'pi' user (not root)
   ├─ Systemd sandboxing
   └─ Limited system access
```

## Monitoring & Logging

```
┌──────────────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY                                      │
└──────────────────────────────────────────────────────────────────────┘

Logs Location:
├─ Application: ~/print-station/logs/print-station.log
├─ Systemd: journalctl -u print-station
└─ CUPS: /var/log/cups/

Log Levels:
├─ INFO: Normal operations
├─ WARN: Non-critical issues
└─ ERROR: Critical failures

Monitoring Commands:
├─ Live logs: sudo journalctl -u print-station -f
├─ Service status: sudo systemctl status print-station
├─ Printer status: lpstat -t
└─ Network: ping arteva-maison-backend.onrender.com

Health Indicators:
├─ ✓ Socket connected
├─ ✓ Printer ready
├─ ✓ Network online
└─ ✓ Service running
```

---

## 🎯 Key Takeaways

1. **Persistent Connection**: WebSocket stays open 24/7
2. **Event-Driven**: Backend pushes notifications instantly
3. **Fully Automatic**: Zero human interaction required
4. **Self-Healing**: Auto-reconnects and restarts
5. **Reliable**: Fallback polling ensures no missed orders
6. **Secure**: API key authentication, encrypted connection
7. **Monitored**: Comprehensive logging for debugging
8. **Resilient**: Survives network issues and power outages

**It's a true daemon - set it and forget it!** 🚀
