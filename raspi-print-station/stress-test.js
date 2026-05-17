#!/usr/bin/env node

/**
 * ARTÉVA Print Station — Stress Test
 * Simulates many concurrent orders to verify stability.
 * 
 * Usage:
 *   node stress-test.js              # 10 orders (default)
 *   node stress-test.js 50           # 50 orders
 *   node stress-test.js 10 long      # 10 orders with many items (long receipt)
 */

require('dotenv').config();
const http = require('http');
const axios = require('axios');

const API_URL = (process.env.API_URL || 'https://arteva-maison-backend-gy1x.onrender.com').replace(/\/+$/, '');
const PRINT_KEY = process.env.PRINT_KEY || 'arteva-print-2026';
const COUNT = parseInt(process.argv[2]) || 10;
const LONG_RECEIPT = process.argv[3] === 'long';

function generateOrder(index) {
  const items = LONG_RECEIPT
    ? Array.from({ length: 20 }, (_, i) => ({
        name: `Product ${i + 1} — Luxury Crystal Edition`,
        nameAr: `منتج ${i + 1} — طبعة كريستال فاخرة`,
        price: (Math.random() * 50 + 5).toFixed(3),
        quantity: Math.floor(Math.random() * 3) + 1,
        sku: `SKU-${String(i + 1).padStart(3, '0')}`
      }))
    : [
        { name: 'Crystal Burner', nameAr: 'مبخر كريستال', price: 45.500, quantity: 1, sku: 'CB-001' },
        { name: 'Tray Set', nameAr: 'طقم صواني', price: 89.900, quantity: 1, sku: 'TS-002' },
      ];

  return {
    _id: `stress-${Date.now()}-${index}`,
    orderNumber: `STRESS-${String(index + 1).padStart(3, '0')}`,
    createdAt: new Date().toISOString(),
    orderStatus: 'confirmed',
    paymentStatus: 'paid',
    paymentMethod: 'myfatoorah',
    user: { name: 'Stress Test', email: 'test@test.com', phone: '+965 1234 5678' },
    shippingAddress: { fullName: 'Stress Test', phone: '+965 1234 5678', street: '123 Test St', area: 'Salmiya', block: '5', city: 'Hawally', country: 'Kuwait' },
    items,
    subtotal: items.reduce((s, i) => s + (i.price * i.quantity), 0),
    shippingCost: 2.000,
    total: items.reduce((s, i) => s + (i.price * i.quantity), 0) + 2.000,
  };
}

async function checkHealth() {
  try {
    const res = await axios.get('http://localhost:3100/health', { timeout: 3000 });
    return res.data;
  } catch {
    return null;
  }
}

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║  STRESS TEST — Print Station v4      ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  Orders: ${COUNT}`);
  console.log(`  Type:   ${LONG_RECEIPT ? 'LONG (20 items each)' : 'Normal (2 items each)'}`);
  console.log('');

  // Check health first
  const health = await checkHealth();
  if (!health) {
    console.error('❌ Print station not running! Start it first: npm start');
    process.exit(1);
  }
  console.log(`✅ Print station v${health.version} running (printer: ${health.printer})`);
  console.log(`   Memory: heap=${health.memory?.processHeapMB}MB, free=${health.memory?.systemFreeMB}MB`);
  console.log('');

  // Generate and queue orders via local files (simulates the queue)
  const fs = require('fs');
  const path = require('path');
  const PENDING_DIR = path.join(__dirname, 'queue', 'pending');

  console.log(`📦 Queuing ${COUNT} orders...`);
  const startMs = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const order = generateOrder(i);
    const job = {
      id: order._id,
      orderNumber: order.orderNumber,
      timestamp: new Date().toISOString(),
      order,
      retries: 0,
      lastError: null,
    };
    const filename = `${Date.now()}_${order.orderNumber}.json`;
    fs.writeFileSync(path.join(PENDING_DIR, filename), JSON.stringify(job, null, 2));
    console.log(`  ✓ Queued ${order.orderNumber}`);
    // Small stagger
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('');
  console.log(`✅ All ${COUNT} orders queued in ${Date.now() - startMs}ms`);
  console.log('');
  console.log('📊 Monitoring progress... (Ctrl+C to stop)');
  console.log('');

  // Monitor health every 5s
  const interval = setInterval(async () => {
    const h = await checkHealth();
    if (!h) {
      console.log('❌ PRINT STATION DOWN!');
      return;
    }
    const elapsed = Math.floor((Date.now() - startMs) / 1000);
    console.log(`[${elapsed}s] pending=${h.pendingJobs} completed=${h.completedJobs} failed=${h.failedJobs} printed=${h.printedThisSession} heap=${h.memory?.processHeapMB}MB free=${h.memory?.systemFreeMB}MB`);

    if (h.pendingJobs === 0) {
      console.log('');
      console.log('  ╔══════════════════════════════════════╗');
      console.log(`  ║  ✅ ALL DONE in ${elapsed}s                ║`);
      console.log(`  ║  Printed: ${h.printedThisSession}  Failed: ${h.failedJobs}          ║`);
      console.log('  ╚══════════════════════════════════════╝');
      clearInterval(interval);
      process.exit(0);
    }
  }, 5000);
}

main().catch(console.error);
