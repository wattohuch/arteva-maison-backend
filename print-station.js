#!/usr/bin/env node

/**
 * Arteva Maison Print Station - Smart Real-time Edition
 * Automated order printing system for Raspberry Pi
 * 
 * Features:
 * - Real-time Socket.io connection to backend
 * - Instant printing when new orders arrive
 * - Auto-reconnection on network issues
 * - Fallback polling mode if Socket.io fails
 * - Prints: receipts, shipping labels, packing slips
 */

require('dotenv').config();
const axios = require('axios');
const io = require('socket.io-client');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const QRCode = require('qrcode');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  apiUrl: process.env.API_URL || 'https://arteva-maison-backend.onrender.com',
  apiKey: process.env.API_KEY || '',
  socketUrl: process.env.SOCKET_URL || process.env.API_URL || 'https://arteva-maison-backend.onrender.com',
  reconnectAttempts: parseInt(process.env.RECONNECT_ATTEMPTS) || 10,
  reconnectDelay: parseInt(process.env.RECONNECT_DELAY) || 5000,
  fallbackPollInterval: parseInt(process.env.FALLBACK_POLL_INTERVAL) || 60000, // 1 minute fallback
  printerInterface: process.env.PRINTER_INTERFACE || '/dev/usb/lp0',
  printerType: process.env.PRINTER_TYPE || 'EPSON',
  printReceipt: process.env.PRINT_RECEIPT !== 'false',
  printLabel: process.env.PRINT_LABEL === 'true',
  printPacking: process.env.PRINT_PACKING === 'true',
  logFile: process.env.LOG_FILE || './logs/print-station.log',
  stateFile: process.env.STATE_FILE || './data/last-order.json',
  testMode: process.env.TEST_MODE === 'true',
  printStationId: process.env.PRINT_STATION_ID || `ps-${require('os').hostname()}`,
};

// State
let printer;
let socket;
let isConnected = false;
let reconnectAttempt = 0;
let fallbackInterval = null;
let processedOrders = new Set(); // Track processed orders to avoid duplicates

// Initialize printer
function initPrinter() {
  try {
    printer = new ThermalPrinter({
      type: PrinterTypes[CONFIG.printerType],
      interface: CONFIG.printerInterface,
      characterSet: 'PC437_USA',
      removeSpecialCharacters: false,
      lineCharacter: '-',
      options: {
        timeout: 5000,
      },
    });

    log('✓ Printer initialized successfully');
    return true;
  } catch (error) {
    log(`✗ Failed to initialize printer: ${error.message}`, 'error');
    return false;
  }
}

// Logging
async function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  
  console.log(logMessage.trim());
  
  try {
    const logDir = path.dirname(CONFIG.logFile);
    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(CONFIG.logFile, logMessage);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
}

// State management
async function getLastProcessedOrder() {
  try {
    const data = await fs.readFile(CONFIG.stateFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { orderId: null, timestamp: null };
  }
}

async function saveLastProcessedOrder(orderId) {
  try {
    const stateDir = path.dirname(CONFIG.stateFile);
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      CONFIG.stateFile,
      JSON.stringify({ orderId, timestamp: new Date().toISOString() })
    );
  } catch (error) {
    log(`Failed to save state: ${error.message}`, 'error');
  }
}

// API calls
async function fetchOrderById(orderId) {
  try {
    const response = await axios.get(`${CONFIG.apiUrl}/api/admin/orders/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${CONFIG.apiKey}`,
      },
      timeout: 10000,
    });

    return response.data.order;
  } catch (error) {
    log(`Failed to fetch order ${orderId}: ${error.message}`, 'error');
    return null;
  }
}

async function fetchNewOrders() {
  try {
    const lastOrder = await getLastProcessedOrder();
    const params = {
      status: 'pending',
      limit: 10,
      sort: '-createdAt',
    };

    if (lastOrder.orderId) {
      params.after = lastOrder.orderId;
    }

    const response = await axios.get(`${CONFIG.apiUrl}/api/admin/orders`, {
      params,
      headers: {
        'Authorization': `Bearer ${CONFIG.apiKey}`,
      },
      timeout: 10000,
    });

    return response.data.orders || [];
  } catch (error) {
    log(`Failed to fetch orders: ${error.message}`, 'error');
    return [];
  }
}

async function markOrderAsPrinted(orderId) {
  try {
    await axios.patch(
      `${CONFIG.apiUrl}/api/admin/orders/${orderId}`,
      { printed: true, printedAt: new Date().toISOString() },
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.apiKey}`,
        },
      }
    );
    log(`Marked order ${orderId} as printed`);
  } catch (error) {
    log(`Failed to mark order as printed: ${error.message}`, 'error');
  }
}

// Printing functions - Matches backend receipt format exactly
async function printReceipt(order) {
  try {
    printer.clear();
    
    // Header - Matches backend exactly
    printer.alignCenter();
    printer.setTextSize(1, 1);
    printer.bold(true);
    printer.println('ARTEVA MAISON');
    printer.bold(false);
    printer.setTextNormal();
    printer.setTextSize(0, 0);
    printer.println('Order Receipt');
    printer.println('');
    printer.drawLine();
    
    // Order metadata - Matches backend format
    printer.alignLeft();
    printer.setTextSize(0, 0);
    printer.println(`Order Number: ${order.orderNumber}`);
    printer.println(`Order Date: ${new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`);
    printer.println(`Payment: ${order.paymentMethod}`);
    printer.bold(true);
    printer.println(`Status: PAID`);
    printer.bold(false);
    printer.drawLine();
    
    // Customer info - Matches backend format
    printer.setTextSize(0, 0);
    printer.bold(true);
    printer.println('CUSTOMER');
    printer.bold(false);
    printer.println(`${order.user?.name || order.shippingAddress?.fullName || 'Guest'}`);
    printer.println(`${order.user?.email || ''}`);
    printer.println(`${order.user?.phone || order.shippingAddress?.phone || ''}`);
    printer.println('');
    
    // Shipping address - Matches backend format
    printer.bold(true);
    printer.println('SHIPPING ADDRESS');
    printer.bold(false);
    const addr = order.shippingAddress;
    printer.println(`${addr.street || addr.address}, ${addr.city}`);
    if (addr.state) printer.println(`${addr.state}`);
    printer.println(`${addr.country}`);
    printer.drawLine();
    
    // Items table header - Matches backend format
    printer.bold(true);
    printer.println('ITEMS');
    printer.bold(false);
    printer.println('SKU  Product         Qty Price  Total');
    printer.drawLine();
    
    // Items - Matches backend format
    for (const item of order.items) {
      const sku = (item.sku || '---').substring(0, 4);
      const name = item.name.substring(0, 15).padEnd(15);
      const qty = String(item.quantity).padStart(3);
      const price = item.price.toFixed(3);
      const total = (item.price * item.quantity).toFixed(3);
      
      printer.println(`${sku} ${name} ${qty} ${price}`);
      printer.alignRight();
      printer.println(`${total} ${order.currency}`);
      printer.alignLeft();
    }
    
    printer.drawLine();
    
    // Totals - Matches backend format exactly
    printer.alignRight();
    printer.println(`Subtotal: ${order.subtotal.toFixed(3)} ${order.currency}`);
    printer.println(`Delivery: ${order.shippingCost.toFixed(3)} ${order.currency}`);
    printer.drawLine();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(`TOTAL PAID: ${order.total.toFixed(3)} ${order.currency}`);
    printer.setTextNormal();
    printer.bold(false);
    printer.println('');
    
    printer.alignLeft();
    
    // Return policy - Matches backend format
    const daysSinceOrder = Math.floor((Date.now() - new Date(order.createdAt)) / (1000 * 60 * 60 * 24));
    const canReturn = daysSinceOrder <= 14;
    printer.bold(true);
    printer.println('RETURN POLICY:');
    printer.bold(false);
    if (canReturn) {
      printer.println(`14-day return on unopened items`);
      printer.println(`(${daysSinceOrder} days since order)`);
    } else {
      printer.println(`Return period expired`);
      printer.println(`(${daysSinceOrder} days)`);
    }
    printer.println('');
    
    // QR Code for order tracking
    printer.alignCenter();
    const qrData = `https://www.artevamaisonkw.com/receipt.html?order=${order.orderNumber}`;
    const qrImage = await QRCode.toBuffer(qrData, { width: 200 });
    await printer.printImage(qrImage);
    printer.println('Scan for receipt');
    printer.println('');
    
    // Footer - Matches backend format
    printer.drawLine();
    printer.bold(true);
    printer.println('Thank you for shopping with us!');
    printer.bold(false);
    printer.println('WhatsApp: +96550683207');
    printer.println('www.artevamaisonkw.com');
    printer.println('');
    printer.cut();
    
    await printer.execute();
    log(`✓ Printed receipt for order ${order.orderNumber}`);
    return true;
  } catch (error) {
    log(`✗ Failed to print receipt: ${error.message}`, 'error');
    return false;
  }
}

async function printShippingLabel(order) {
  try {
    printer.clear();
    
    // Large shipping label format
    printer.alignCenter();
    printer.setTextSize(2, 2);
    printer.bold(true);
    printer.println('SHIPPING LABEL');
    printer.setTextNormal();
    printer.bold(false);
    printer.println('');
    
    // Order number
    printer.setTextSize(1, 1);
    printer.bold(true);
    printer.println(`Order: ${order.orderNumber || order._id.slice(-8)}`);
    printer.bold(false);
    printer.setTextNormal();
    printer.println('');
    
    // From address
    printer.alignLeft();
    printer.bold(true);
    printer.println('FROM:');
    printer.bold(false);
    printer.println('Arteva Maison');
    printer.println('Kuwait'); // Add your warehouse address
    printer.println('');
    
    // To address (large text)
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println('DELIVER TO:');
    printer.setTextNormal();
    printer.bold(false);
    printer.println('');
    
    printer.setTextSize(1, 1);
    printer.println(order.shippingAddress.fullName);
    printer.println(order.shippingAddress.phone);
    printer.println('');
    printer.println(order.shippingAddress.address);
    if (order.shippingAddress.apartment) {
      printer.println(`Apt: ${order.shippingAddress.apartment}`);
    }
    printer.println(`${order.shippingAddress.city}`);
    printer.println(`${order.shippingAddress.governorate}`);
    printer.println(`${order.shippingAddress.country}`);
    printer.setTextNormal();
    printer.println('');
    
    // Barcode/QR for scanning
    printer.alignCenter();
    const qrData = order._id;
    const qrImage = await QRCode.toBuffer(qrData, { width: 300 });
    await printer.printImage(qrImage);
    printer.println(order._id);
    
    printer.println('');
    printer.cut();
    
    await printer.execute();
    log(`Printed shipping label for order ${order._id}`);
    return true;
  } catch (error) {
    log(`Failed to print shipping label: ${error.message}`, 'error');
    return false;
  }
}

async function printPackingSlip(order) {
  try {
    printer.clear();
    
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println('PACKING SLIP');
    printer.setTextNormal();
    printer.bold(false);
    printer.drawLine();
    
    printer.alignLeft();
    printer.println(`Order: ${order.orderNumber || order._id.slice(-8)}`);
    printer.println(`Date: ${new Date(order.createdAt).toLocaleDateString()}`);
    printer.drawLine();
    
    printer.bold(true);
    printer.println('ITEMS TO PACK:');
    printer.bold(false);
    printer.println('');
    
    for (const item of order.items) {
      printer.println(`[ ] ${item.quantity}x ${item.name}`);
      if (item.selectedVariant) {
        printer.println(`    Variant: ${item.selectedVariant}`);
      }
      printer.println(`    SKU: ${item.sku || 'N/A'}`);
      printer.println('');
    }
    
    printer.drawLine();
    printer.println(`Total Items: ${order.items.reduce((sum, item) => sum + item.quantity, 0)}`);
    printer.println('');
    
    printer.println('QUALITY CHECK:');
    printer.println('[ ] All items present');
    printer.println('[ ] Items undamaged');
    printer.println('[ ] Correct variants');
    printer.println('[ ] Securely packaged');
    printer.println('');
    
    printer.println('Packed by: _______________');
    printer.println('Date: _______________');
    printer.println('');
    
    printer.cut();
    await printer.execute();
    log(`Printed packing slip for order ${order._id}`);
    return true;
  } catch (error) {
    log(`Failed to print packing slip: ${error.message}`, 'error');
    return false;
  }
}

// Main processing
async function processOrder(order) {
  // Check if already processed
  if (processedOrders.has(order._id)) {
    log(`Order ${order._id} already processed, skipping`);
    return true;
  }

  log(`📦 Processing order ${order.orderNumber || order._id}`);
  
  let success = true;
  
  if (CONFIG.printReceipt) {
    success = await printReceipt(order) && success;
    // Small delay between prints
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  if (CONFIG.printLabel) {
    success = await printShippingLabel(order) && success;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  if (CONFIG.printPacking) {
    success = await printPackingSlip(order) && success;
  }
  
  if (success) {
    await markOrderAsPrinted(order._id);
    await saveLastProcessedOrder(order._id);
    processedOrders.add(order._id);
    log(`✓ Successfully processed order ${order.orderNumber || order._id}`, 'info');
  } else {
    log(`✗ Failed to process order ${order._id}`, 'error');
  }
  
  return success;
}

// Socket.io Connection
function connectSocket() {
  const socketUrl = CONFIG.socketUrl.replace('/api', ''); // Remove /api if present
  
  log(`🔌 Connecting to backend: ${socketUrl}`);
  
  socket = io(socketUrl, {
    auth: {
      token: CONFIG.apiKey,
      printStationId: CONFIG.printStationId,
    },
    reconnection: true,
    reconnectionAttempts: CONFIG.reconnectAttempts,
    reconnectionDelay: CONFIG.reconnectDelay,
    timeout: 20000,
    transports: ['websocket', 'polling'],
  });

  // Connection successful
  socket.on('connect', () => {
    isConnected = true;
    reconnectAttempt = 0;
    log(`✓ Connected to backend (Socket ID: ${socket.id})`);
    
    // Join admin room to receive new order notifications
    socket.emit('join_admin_room');
    log('✓ Joined admin room for order notifications');
    
    // Stop fallback polling if running
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
      log('✓ Stopped fallback polling (Socket.io active)');
    }
  });

  // New order received via Socket.io
  socket.on('new_order', async (data) => {
    log(`🆕 New order notification received: ${data.orderNumber}`);
    log(`   Customer: ${data.customer}, Total: ${data.total} KWD`);
    
    // Fetch full order details
    try {
      // Extract order ID from orderNumber or use provided ID
      // The backend sends: { orderNumber, total, customer, timestamp }
      // We need to fetch the full order details
      const orders = await fetchNewOrders();
      const order = orders.find(o => o.orderNumber === data.orderNumber);
      
      if (order) {
        await processOrder(order);
      } else {
        log(`⚠ Could not find order details for ${data.orderNumber}`, 'warn');
      }
    } catch (error) {
      log(`✗ Error processing new order: ${error.message}`, 'error');
    }
  });

  // Connection error
  socket.on('connect_error', (error) => {
    isConnected = false;
    reconnectAttempt++;
    log(`✗ Connection error (attempt ${reconnectAttempt}): ${error.message}`, 'error');
    
    // Start fallback polling if not already running
    if (!fallbackInterval && reconnectAttempt >= 3) {
      startFallbackPolling();
    }
  });

  // Disconnected
  socket.on('disconnect', (reason) => {
    isConnected = false;
    log(`⚠ Disconnected from backend: ${reason}`, 'warn');
    
    // Start fallback polling
    if (!fallbackInterval) {
      startFallbackPolling();
    }
  });

  // Reconnecting
  socket.on('reconnect_attempt', (attemptNumber) => {
    log(`🔄 Reconnection attempt ${attemptNumber}...`);
  });

  // Reconnected
  socket.on('reconnect', (attemptNumber) => {
    log(`✓ Reconnected after ${attemptNumber} attempts`);
  });

  // Max reconnection attempts reached
  socket.on('reconnect_failed', () => {
    log('✗ Failed to reconnect after maximum attempts', 'error');
    log('⚠ Continuing with fallback polling mode');
  });
}

// Fallback polling (when Socket.io is unavailable)
function startFallbackPolling() {
  if (fallbackInterval) return; // Already running
  
  log('⚠ Starting fallback polling mode (checking every 60 seconds)');
  
  fallbackInterval = setInterval(async () => {
    if (isConnected) {
      // Socket.io reconnected, stop polling
      clearInterval(fallbackInterval);
      fallbackInterval = null;
      log('✓ Socket.io reconnected, stopping fallback polling');
      return;
    }
    
    try {
      const orders = await fetchNewOrders();
      
      if (orders.length > 0) {
        log(`📦 Fallback polling found ${orders.length} new order(s)`);
        
        for (const order of orders) {
          await processOrder(order);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    } catch (error) {
      log(`✗ Fallback polling error: ${error.message}`, 'error');
    }
  }, CONFIG.fallbackPollInterval);
}

// Main loop
async function mainLoop() {
  log('');
  log('========================================');
  log('🖨️  Arteva Maison Print Station');
  log('========================================');
  log(`Station ID: ${CONFIG.printStationId}`);
  log(`Backend: ${CONFIG.apiUrl}`);
  log(`Mode: Real-time Socket.io + Fallback Polling`);
  log('========================================');
  log('');
  
  if (!initPrinter()) {
    log('✗ Failed to initialize printer. Retrying in 30 seconds...', 'error');
    setTimeout(mainLoop, 30000);
    return;
  }
  
  // Connect to backend via Socket.io
  connectSocket();
  
  log('✓ Print station running');
  log('✓ Listening for new orders...');
  log('');
  
  // Keep process alive
  process.stdin.resume();
}

// Test mode
async function testPrint() {
  log('Running in TEST MODE');
  
  if (!initPrinter()) {
    log('Failed to initialize printer', 'error');
    process.exit(1);
  }
  
  const testOrder = {
    _id: 'test123456789',
    orderNumber: 'TEST-001',
    createdAt: new Date(),
    status: 'pending',
    paymentMethod: 'Credit Card',
    paymentStatus: 'paid',
    shippingAddress: {
      fullName: 'Test Customer',
      phone: '+965 1234 5678',
      email: 'test@example.com',
      address: '123 Test Street',
      apartment: 'Apt 4B',
      city: 'Kuwait City',
      governorate: 'Capital',
      country: 'Kuwait',
    },
    items: [
      {
        name: 'Luxury Vase',
        quantity: 2,
        price: 45.500,
        selectedVariant: 'Gold',
        sku: 'LV-001-G',
      },
      {
        name: 'Decorative Mirror',
        quantity: 1,
        price: 89.900,
        sku: 'DM-002',
      },
    ],
    subtotal: 180.900,
    shippingCost: 5.000,
    discount: 0,
    total: 185.900,
  };
  
  await processOrder(testOrder);
  log('Test print completed');
  process.exit(0);
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('');
  log('⚠ Shutting down print station...');
  if (socket) {
    socket.disconnect();
  }
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
  }
  log('✓ Print station stopped');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('');
  log('⚠ Shutting down print station...');
  if (socket) {
    socket.disconnect();
  }
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
  }
  log('✓ Print station stopped');
  process.exit(0);
});

// Start
if (CONFIG.testMode) {
  testPrint();
} else {
  mainLoop();
}
