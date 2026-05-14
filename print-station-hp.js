#!/usr/bin/env node

/**
 * Arteva Maison Print Station - HP SmartTank Edition
 * Automated order printing system for Raspberry Pi with HP SmartTank printer
 * 
 * Features:
 * - Real-time Socket.io connection to backend
 * - HTML-to-PDF printing (matches backend receipt exactly)
 * - Prints on A4/Letter paper
 * - Auto-reconnection and fallback polling
 * - Survives power outages
 */

require('dotenv').config();
const axios = require('axios');
const io = require('socket.io-client');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Configuration
const CONFIG = {
  apiUrl: process.env.API_URL || 'https://arteva-maison-backend.onrender.com',
  apiKey: process.env.API_KEY || '',
  socketUrl: process.env.SOCKET_URL || process.env.API_URL || 'https://arteva-maison-backend.onrender.com',
  reconnectAttempts: parseInt(process.env.RECONNECT_ATTEMPTS) || 10,
  reconnectDelay: parseInt(process.env.RECONNECT_DELAY) || 5000,
  fallbackPollInterval: parseInt(process.env.FALLBACK_POLL_INTERVAL) || 60000,
  printerName: process.env.PRINTER_NAME || 'hp-smarttank',
  printerType: process.env.PRINTER_TYPE || 'HP',
  paperSize: process.env.PAPER_SIZE || 'A4',
  printReceipt: process.env.PRINT_RECEIPT !== 'false',
  printLabel: process.env.PRINT_LABEL === 'true',
  printPacking: process.env.PRINT_PACKING === 'true',
  logFile: process.env.LOG_FILE || './logs/print-station.log',
  stateFile: process.env.STATE_FILE || './data/last-order.json',
  tempDir: process.env.TEMP_DIR || './temp',
  testMode: process.env.TEST_MODE === 'true',
  printStationId: process.env.PRINT_STATION_ID || `ps-hp-${require('os').hostname()}`,
};

// State
let socket;
let browser;
let isConnected = false;
let reconnectAttempt = 0;
let fallbackInterval = null;
let keepAliveInterval = null;
let processedOrders = new Set();

// Initialize browser
async function initBrowser() {
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    log('✓ Browser initialized successfully');
    return true;
  } catch (error) {
    log(`✗ Failed to initialize browser: ${error.message}`, 'error');
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

// Keep-alive to prevent backend hibernation (Render free tier)
async function keepBackendAwake() {
  try {
    await axios.get(`${CONFIG.apiUrl}/api/products`, {
      timeout: 90000, // 90 seconds - allow time for MongoDB to wake up
    });
    log('✓ Backend keep-alive ping successful');
  } catch (error) {
    log(`⚠ Backend keep-alive ping failed: ${error.message}`, 'warn');
  }
}

// API calls
async function fetchOrderById(orderId) {
  try {
    const response = await axios.get(`${CONFIG.apiUrl}/api/admin/orders/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${CONFIG.apiKey}`,
      },
      timeout: 90000, // 90 seconds - allow time for MongoDB to wake up
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
      timeout: 90000, // 90 seconds - allow time for MongoDB to wake up
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

// Fetch receipt HTML from backend
async function fetchReceiptHTML(orderId) {
  try {
    const response = await axios.get(
      `${CONFIG.apiUrl}/api/admin/receipt/${orderId}`,
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.apiKey}`,
        },
        timeout: 90000, // 90 seconds - allow time for MongoDB to wake up
      }
    );

    return response.data;
  } catch (error) {
    log(`Failed to fetch receipt HTML: ${error.message}`, 'error');
    return null;
  }
}

// Print HTML to PDF and send to printer
async function printReceipt(order) {
  try {
    log(`Generating receipt for order ${order.orderNumber}`);
    
    // Fetch receipt HTML from backend (matches exactly)
    const receiptHTML = await fetchReceiptHTML(order._id);
    
    if (!receiptHTML) {
      log('Failed to fetch receipt HTML', 'error');
      return false;
    }

    // Create temp directory
    await fs.mkdir(CONFIG.tempDir, { recursive: true });
    
    // Save HTML to temp file
    const htmlPath = path.join(CONFIG.tempDir, `receipt-${order.orderNumber}.html`);
    await fs.writeFile(htmlPath, receiptHTML);
    
    // Generate PDF using Puppeteer
    const pdfPath = path.join(CONFIG.tempDir, `receipt-${order.orderNumber}.pdf`);
    const page = await browser.newPage();
    
    // Use absolute path for file:// URL
    const absoluteHtmlPath = path.resolve(htmlPath);
    await page.goto(`file://${absoluteHtmlPath}`, {
      waitUntil: 'networkidle0',
    });
    
    await page.pdf({
      path: pdfPath,
      format: CONFIG.paperSize,
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });
    
    await page.close();
    
    log(`PDF generated: ${pdfPath}`);
    
    // Print PDF using lpr
    const printCommand = `lpr -P ${CONFIG.printerName} "${pdfPath}"`;
    await execPromise(printCommand);
    
    log(`✓ Printed receipt for order ${order.orderNumber}`);
    
    // Clean up temp files after 1 minute
    setTimeout(async () => {
      try {
        await fs.unlink(htmlPath);
        await fs.unlink(pdfPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }, 60000);
    
    return true;
  } catch (error) {
    log(`✗ Failed to print receipt: ${error.message}`, 'error');
    return false;
  }
}

// Print shipping label (simplified for A4)
async function printShippingLabel(order) {
  try {
    log(`Generating shipping label for order ${order.orderNumber}`);
    
    const labelHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      padding: 20mm;
      font-size: 14pt;
    }
    .header { 
      text-align: center; 
      border-bottom: 3px solid #D4AF37;
      padding-bottom: 10mm;
      margin-bottom: 10mm;
    }
    .header h1 { font-size: 28pt; letter-spacing: 3px; }
    .section { margin-bottom: 10mm; }
    .label { 
      font-size: 10pt; 
      color: #888; 
      text-transform: uppercase; 
      margin-bottom: 2mm;
    }
    .value { font-size: 16pt; font-weight: 600; }
    .address { 
      border: 2px solid #D4AF37; 
      padding: 10mm; 
      margin: 10mm 0;
      background: #fafaf8;
    }
    .address .value { font-size: 18pt; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ARTÉVA MAISON</h1>
    <p style="font-size: 14pt; color: #888;">SHIPPING LABEL</p>
  </div>
  
  <div class="section">
    <div class="label">Order Number</div>
    <div class="value">${order.orderNumber}</div>
  </div>
  
  <div class="section">
    <div class="label">From</div>
    <div class="value">Artéva Maison<br>Kuwait</div>
  </div>
  
  <div class="address">
    <div class="label">Deliver To</div>
    <div class="value">
      ${order.shippingAddress.fullName || order.user?.name}<br>
      ${order.shippingAddress.phone || order.user?.phone}<br>
      <br>
      ${order.shippingAddress.street || order.shippingAddress.address}<br>
      ${order.shippingAddress.city}, ${order.shippingAddress.governorate || order.shippingAddress.state || ''}<br>
      ${order.shippingAddress.country}
    </div>
  </div>
  
  <div style="text-align: center; margin-top: 15mm;">
    <div style="font-size: 10pt; color: #888;">Order ID</div>
    <div style="font-family: monospace; font-size: 12pt;">${order._id}</div>
  </div>
</body>
</html>
    `;
    
    await fs.mkdir(CONFIG.tempDir, { recursive: true });
    
    const htmlPath = path.join(CONFIG.tempDir, `label-${order.orderNumber}.html`);
    await fs.writeFile(htmlPath, labelHTML);
    
    const pdfPath = path.join(CONFIG.tempDir, `label-${order.orderNumber}.pdf`);
    const page = await browser.newPage();
    
    // Use absolute path for file:// URL
    const absoluteHtmlPath = path.resolve(htmlPath);
    await page.goto(`file://${absoluteHtmlPath}`, {
      waitUntil: 'networkidle0',
    });
    
    await page.pdf({
      path: pdfPath,
      format: CONFIG.paperSize,
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });
    
    await page.close();
    
    const printCommand = `lpr -P ${CONFIG.printerName} "${pdfPath}"`;
    await execPromise(printCommand);
    
    log(`✓ Printed shipping label for order ${order.orderNumber}`);
    
    setTimeout(async () => {
      try {
        await fs.unlink(htmlPath);
        await fs.unlink(pdfPath);
      } catch (e) {}
    }, 60000);
    
    return true;
  } catch (error) {
    log(`✗ Failed to print shipping label: ${error.message}`, 'error');
    return false;
  }
}

// Print packing slip
async function printPackingSlip(order) {
  try {
    log(`Generating packing slip for order ${order.orderNumber}`);
    
    const itemsHTML = order.items.map(item => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">
          <input type="checkbox" style="width: 20px; height: 20px;">
        </td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-size: 10pt; color: #888;">${item.sku || 'N/A'}</td>
      </tr>
    `).join('');
    
    const packingHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      padding: 15mm;
      font-size: 12pt;
    }
    .header { 
      text-align: center; 
      border-bottom: 2px solid #D4AF37;
      padding-bottom: 8mm;
      margin-bottom: 8mm;
    }
    table { width: 100%; border-collapse: collapse; margin: 10mm 0; }
    th { background: #f5f2ec; padding: 8px; text-align: left; font-size: 10pt; }
    .checklist { margin: 10mm 0; }
    .checklist div { margin: 5mm 0; font-size: 12pt; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="font-size: 24pt;">PACKING SLIP</h1>
    <p style="font-size: 12pt; color: #888;">Order: ${order.orderNumber}</p>
  </div>
  
  <p style="margin-bottom: 8mm;">
    <strong>Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}<br>
    <strong>Customer:</strong> ${order.user?.name || order.shippingAddress?.fullName}
  </p>
  
  <table>
    <thead>
      <tr>
        <th style="width: 50px;">✓</th>
        <th style="width: 60px;">Qty</th>
        <th>Product</th>
        <th style="width: 120px;">SKU</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHTML}
    </tbody>
  </table>
  
  <p style="margin: 10mm 0; font-size: 14pt;">
    <strong>Total Items:</strong> ${order.items.reduce((sum, item) => sum + item.quantity, 0)}
  </p>
  
  <div class="checklist">
    <h3 style="margin-bottom: 5mm;">Quality Check:</h3>
    <div><input type="checkbox" style="width: 18px; height: 18px;"> All items present</div>
    <div><input type="checkbox" style="width: 18px; height: 18px;"> Items undamaged</div>
    <div><input type="checkbox" style="width: 18px; height: 18px;"> Correct variants</div>
    <div><input type="checkbox" style="width: 18px; height: 18px;"> Securely packaged</div>
  </div>
  
  <div style="margin-top: 15mm;">
    <p>Packed by: _______________________</p>
    <p style="margin-top: 5mm;">Date: _______________________</p>
  </div>
</body>
</html>
    `;
    
    await fs.mkdir(CONFIG.tempDir, { recursive: true });
    
    const htmlPath = path.join(CONFIG.tempDir, `packing-${order.orderNumber}.html`);
    await fs.writeFile(htmlPath, packingHTML);
    
    const pdfPath = path.join(CONFIG.tempDir, `packing-${order.orderNumber}.pdf`);
    const page = await browser.newPage();
    
    // Use absolute path for file:// URL
    const absoluteHtmlPath = path.resolve(htmlPath);
    await page.goto(`file://${absoluteHtmlPath}`, {
      waitUntil: 'networkidle0',
    });
    
    await page.pdf({
      path: pdfPath,
      format: CONFIG.paperSize,
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });
    
    await page.close();
    
    const printCommand = `lpr -P ${CONFIG.printerName} "${pdfPath}"`;
    await execPromise(printCommand);
    
    log(`✓ Printed packing slip for order ${order.orderNumber}`);
    
    setTimeout(async () => {
      try {
        await fs.unlink(htmlPath);
        await fs.unlink(pdfPath);
      } catch (e) {}
    }, 60000);
    
    return true;
  } catch (error) {
    log(`✗ Failed to print packing slip: ${error.message}`, 'error');
    return false;
  }
}

// Main processing
async function processOrder(order) {
  if (processedOrders.has(order._id)) {
    log(`Order ${order._id} already processed, skipping`);
    return true;
  }

  log(`📦 Processing order ${order.orderNumber || order._id}`);
  
  let success = true;
  
  if (CONFIG.printReceipt) {
    success = await printReceipt(order) && success;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  if (CONFIG.printLabel) {
    success = await printShippingLabel(order) && success;
    await new Promise(resolve => setTimeout(resolve, 3000));
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

// Socket.io Connection (same as thermal version)
function connectSocket() {
  const socketUrl = CONFIG.socketUrl.replace('/api', '');
  
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

  socket.on('connect', () => {
    isConnected = true;
    reconnectAttempt = 0;
    log(`✓ Connected to backend (Socket ID: ${socket.id})`);
    
    socket.emit('join_admin_room');
    log('✓ Joined admin room for order notifications');
    
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
      log('✓ Stopped fallback polling (Socket.io active)');
    }
  });

  socket.on('new_order', async (data) => {
    log(`🆕 New order notification received: ${data.orderNumber}`);
    log(`   Customer: ${data.customer}, Total: ${data.total} KWD`);
    
    try {
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

  socket.on('connect_error', (error) => {
    isConnected = false;
    reconnectAttempt++;
    log(`✗ Connection error (attempt ${reconnectAttempt}): ${error.message}`, 'error');
    
    if (!fallbackInterval && reconnectAttempt >= 3) {
      startFallbackPolling();
    }
  });

  socket.on('disconnect', (reason) => {
    isConnected = false;
    log(`⚠ Disconnected from backend: ${reason}`, 'warn');
    
    if (!fallbackInterval) {
      startFallbackPolling();
    }
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    log(`🔄 Reconnection attempt ${attemptNumber}...`);
  });

  socket.on('reconnect', (attemptNumber) => {
    log(`✓ Reconnected after ${attemptNumber} attempts`);
  });

  socket.on('reconnect_failed', () => {
    log('✗ Failed to reconnect after maximum attempts', 'error');
    log('⚠ Continuing with fallback polling mode');
  });
}

// Fallback polling
function startFallbackPolling() {
  if (fallbackInterval) return;
  
  log('⚠ Starting fallback polling mode (checking every 60 seconds)');
  
  fallbackInterval = setInterval(async () => {
    if (isConnected) {
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
          await new Promise(resolve => setTimeout(resolve, 5000));
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
  log('    HP SmartTank Edition');
  log('========================================');
  log(`Station ID: ${CONFIG.printStationId}`);
  log(`Backend: ${CONFIG.apiUrl}`);
  log(`Printer: ${CONFIG.printerName}`);
  log(`Paper: ${CONFIG.paperSize}`);
  log(`Mode: Real-time Socket.io + Fallback Polling`);
  log('========================================');
  log('');
  
  if (!await initBrowser()) {
    log('✗ Failed to initialize browser. Retrying in 30 seconds...', 'error');
    setTimeout(mainLoop, 30000);
    return;
  }
  
  // Wake up backend before connecting
  log('⏰ Waking up backend (Render free tier)...');
  await keepBackendAwake();
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  connectSocket();
  
  // Start keep-alive interval (every 5 minutes)
  keepAliveInterval = setInterval(keepBackendAwake, 5 * 60 * 1000);
  log('✓ Backend keep-alive enabled (every 5 minutes)');
  
  log('✓ Print station running');
  log('✓ Listening for new orders...');
  log('');
  
  process.stdin.resume();
}

// Test mode
async function testPrint() {
  log('Running in TEST MODE');
  
  if (!await initBrowser()) {
    log('Failed to initialize browser', 'error');
    process.exit(1);
  }
  
  const testOrder = {
    _id: 'test123456789',
    orderNumber: 'TEST-001',
    createdAt: new Date(),
    status: 'pending',
    paymentMethod: 'Credit Card',
    paymentStatus: 'paid',
    currency: 'KWD',
    user: {
      name: 'Test Customer',
      email: 'test@example.com',
      phone: '+965 1234 5678',
    },
    shippingAddress: {
      fullName: 'Test Customer',
      phone: '+965 1234 5678',
      street: '123 Test Street',
      city: 'Kuwait City',
      governorate: 'Capital',
      country: 'Kuwait',
    },
    items: [
      {
        name: 'Luxury Vase',
        quantity: 2,
        price: 45.500,
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
    total: 185.900,
  };
  
  await processOrder(testOrder);
  log('Test print completed');
  
  if (browser) {
    await browser.close();
  }
  
  process.exit(0);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  log('');
  log('⚠ Shutting down print station...');
  if (socket) {
    socket.disconnect();
  }
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
  }
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  if (browser) {
    await browser.close();
  }
  log('✓ Print station stopped');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('');
  log('⚠ Shutting down print station...');
  if (socket) {
    socket.disconnect();
  }
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
  }
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  if (browser) {
    await browser.close();
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
