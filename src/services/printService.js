/**
 * ARTEVA Maison - Auto-Print Service (IPP + JPEG)
 * 
 * Renders receipts as JPEG images using canvas,
 * then sends them to the HP Smart Tank 790 via IPP.
 * 
 * Works over the internet via port forwarding:
 *   Router forwards external:9631 → printer:631
 * 
 * No PC needed — just the printer on WiFi.
 */

const http = require('http');
const https = require('https');
const { createCanvas } = require('canvas');

// ═══════════════════════════════════════
// RECEIPT IMAGE RENDERER (Canvas → JPEG)
// ═══════════════════════════════════════

function renderReceiptToJpeg(order, customer) {
    const W = 595;  // A4 width at 72dpi
    const H = 842;  // A4 height at 72dpi
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    let y = 30;
    const LM = 30;  // left margin
    const RM = W - 30; // right edge
    const CW = RM - LM; // content width

    // ── HEADER ──
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ARTÉVA MAISON', W / 2, y + 20);
    y += 30;

    ctx.font = '10px Arial';
    ctx.fillStyle = '#888888';
    ctx.fillText('Order Receipt / إيصال الطلب', W / 2, y + 10);
    y += 20;

    // Gold line
    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(LM, y);
    ctx.lineTo(RM, y);
    ctx.stroke();
    y += 15;

    // ── ORDER META ──
    ctx.textAlign = 'left';
    ctx.font = '9px Arial';
    ctx.fillStyle = '#888888';

    const orderDate = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
    const payment = (order.paymentMethod || 'N/A').toUpperCase();

    // Meta row
    const metaCols = [
        { label: 'ORDER', value: order.orderNumber || 'N/A' },
        { label: 'DATE', value: orderDate },
        { label: 'PAYMENT', value: payment }
    ];
    const colW = CW / metaCols.length;
    metaCols.forEach((col, i) => {
        const x = LM + (i * colW);
        ctx.fillStyle = '#888888';
        ctx.font = '8px Arial';
        ctx.fillText(col.label, x, y);
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 11px Arial';
        ctx.fillText(col.value, x, y + 13);
    });
    y += 30;

    // ── CUSTOMER & SHIPPING ──
    const boxW = (CW - 10) / 2;
    const customerName = customer ? customer.name : 'Guest';
    const customerEmail = customer ? customer.email : '';
    const customerPhone = customer ? (customer.phone || '') : '';
    const addr = order.shippingAddress || {};
    const addressParts = [addr.street, addr.city, addr.state, addr.country].filter(Boolean).join(', ');

    // Customer box
    ctx.fillStyle = '#f9f7f4';
    ctx.fillRect(LM, y, boxW, 55);
    ctx.strokeStyle = '#e6e1d6';
    ctx.lineWidth = 1;
    ctx.strokeRect(LM, y, boxW, 55);

    ctx.fillStyle = '#888888';
    ctx.font = '8px Arial';
    ctx.fillText('CUSTOMER', LM + 6, y + 12);
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 11px Arial';
    ctx.fillText(customerName, LM + 6, y + 26);
    ctx.font = '10px Arial';
    ctx.fillStyle = '#555555';
    ctx.fillText(customerEmail, LM + 6, y + 38);
    ctx.fillText(customerPhone, LM + 6, y + 50);

    // Shipping box
    const shipX = LM + boxW + 10;
    ctx.fillStyle = '#f9f7f4';
    ctx.fillRect(shipX, y, boxW, 55);
    ctx.strokeStyle = '#e6e1d6';
    ctx.strokeRect(shipX, y, boxW, 55);

    ctx.fillStyle = '#888888';
    ctx.font = '8px Arial';
    ctx.fillText('SHIPPING', shipX + 6, y + 12);
    ctx.fillStyle = '#555555';
    ctx.font = '10px Arial';
    // Wrap address text
    const addrWords = (addressParts || 'N/A').split(' ');
    let addrLine = '';
    let addrY = y + 26;
    addrWords.forEach(word => {
        const test = addrLine + word + ' ';
        if (ctx.measureText(test).width > boxW - 12) {
            ctx.fillText(addrLine.trim(), shipX + 6, addrY);
            addrLine = word + ' ';
            addrY += 12;
        } else {
            addrLine = test;
        }
    });
    ctx.fillText(addrLine.trim(), shipX + 6, addrY);

    y += 70;

    // ── ITEMS TABLE ──
    const items = order.items || [];
    const cols = [
        { label: 'SKU', x: LM, w: 60 },
        { label: 'ITEM', x: LM + 65, w: 200 },
        { label: 'QTY', x: LM + 270, w: 40, align: 'center' },
        { label: 'PRICE', x: LM + 320, w: 80, align: 'right' },
        { label: 'TOTAL', x: LM + 420, w: 100, align: 'right' }
    ];

    // Header
    ctx.fillStyle = '#f5f2ec';
    ctx.fillRect(LM, y, CW, 18);
    ctx.fillStyle = '#888888';
    ctx.font = '8px Arial';
    cols.forEach(col => {
        ctx.textAlign = col.align || 'left';
        const tx = col.align === 'right' ? col.x + col.w : col.x;
        ctx.fillText(col.label, tx, y + 12);
    });
    y += 22;

    // Rows
    items.forEach(item => {
        const sku = item.sku || '—';
        const total = (item.price * item.quantity).toFixed(3);

        ctx.textAlign = 'left';

        // SKU
        ctx.fillStyle = '#888888';
        ctx.font = '9px Courier New';
        ctx.fillText(sku, cols[0].x, y + 4);

        // Name
        ctx.fillStyle = '#333333';
        ctx.font = '11px Arial';
        const name = item.name || 'Product';
        const displayName = ctx.measureText(name).width > cols[1].w ? name.substring(0, 25) + '...' : name;
        ctx.fillText(displayName, cols[1].x, y + 4);

        // Qty
        ctx.textAlign = 'center';
        ctx.fillText(String(item.quantity), cols[2].x + cols[2].w / 2, y + 4);

        // Price
        ctx.textAlign = 'right';
        ctx.fillText(item.price.toFixed(3), cols[3].x + cols[3].w, y + 4);

        // Total
        ctx.font = 'bold 11px Arial';
        ctx.fillText(total, cols[4].x + cols[4].w, y + 4);

        // Separator
        y += 6;
        ctx.strokeStyle = '#eeeeee';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LM, y + 4);
        ctx.lineTo(RM, y + 4);
        ctx.stroke();
        y += 12;
    });

    y += 5;

    // ── TOTALS ──
    ctx.textAlign = 'left';
    const totX = RM - 180;

    ctx.font = '11px Arial';
    ctx.fillStyle = '#555555';
    ctx.fillText('Subtotal', totX, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${(order.subtotal || 0).toFixed(3)} KWD`, RM, y);
    y += 16;

    ctx.textAlign = 'left';
    ctx.fillText('Delivery', totX, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${(order.shippingCost || 0).toFixed(3)} KWD`, RM, y);
    y += 8;

    // Gold line
    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(totX, y);
    ctx.lineTo(RM, y);
    ctx.stroke();
    y += 16;

    ctx.textAlign = 'left';
    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = '#333333';
    ctx.fillText('TOTAL', totX, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${(order.total || 0).toFixed(3)} KWD`, RM, y);
    y += 25;

    // ── RETURN POLICY ──
    ctx.fillStyle = '#fffbeb';
    ctx.fillRect(LM, y, CW, 28);
    ctx.strokeStyle = '#f0e6c0';
    ctx.lineWidth = 1;
    ctx.strokeRect(LM, y, CW, 28);

    ctx.textAlign = 'left';
    ctx.font = 'bold 8px Arial';
    ctx.fillStyle = '#666666';
    ctx.fillText('Return Policy: 14-day return on unopened items. WhatsApp: +965 5563 6321', LM + 6, y + 12);
    ctx.font = '8px Arial';
    ctx.fillText('سياسة الإرجاع: إرجاع خلال ١٤ يومًا للمنتجات غير المفتوحة', LM + 6, y + 23);
    y += 38;

    // ── FOOTER ──
    ctx.strokeStyle = '#e6e1d6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LM, y);
    ctx.lineTo(RM, y);
    ctx.stroke();
    y += 12;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#D4AF37';
    ctx.font = 'bold 10px Arial';
    ctx.fillText('Thank you for shopping with ARTÉVA Maison!', W / 2, y);
    y += 12;
    ctx.fillStyle = '#888888';
    ctx.font = '9px Arial';
    ctx.fillText('www.artevamaisonkw.com • artevamaison@gmail.com', W / 2, y);

    // Convert to JPEG buffer
    return canvas.toBuffer('image/jpeg', { quality: 0.92 });
}

// ═══════════════════════════════════════
// IPP PROTOCOL IMPLEMENTATION
// ═══════════════════════════════════════

function ippAttribute(tag, name, value) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const valueBuf = Buffer.from(value, 'utf-8');
    const buf = Buffer.alloc(1 + 2 + nameBuf.length + 2 + valueBuf.length);
    let offset = 0;
    buf.writeUInt8(tag, offset); offset += 1;
    buf.writeUInt16BE(nameBuf.length, offset); offset += 2;
    nameBuf.copy(buf, offset); offset += nameBuf.length;
    buf.writeUInt16BE(valueBuf.length, offset); offset += 2;
    valueBuf.copy(buf, offset);
    return buf;
}

function ippIntAttribute(tag, name, value) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const buf = Buffer.alloc(1 + 2 + nameBuf.length + 2 + 4);
    let offset = 0;
    buf.writeUInt8(tag, offset); offset += 1;
    buf.writeUInt16BE(nameBuf.length, offset); offset += 2;
    nameBuf.copy(buf, offset); offset += nameBuf.length;
    buf.writeUInt16BE(4, offset); offset += 2;
    buf.writeInt32BE(value, offset);
    return buf;
}

function buildIppPrintJob(jpegBuffer, jobName) {
    const attrs = [];
    attrs.push(Buffer.from([0x01])); // operation-attributes-tag
    attrs.push(ippAttribute(0x47, 'attributes-charset', 'utf-8'));
    attrs.push(ippAttribute(0x48, 'attributes-natural-language', 'en'));
    attrs.push(ippAttribute(0x45, 'printer-uri', 'ipp://localhost/ipp/print'));
    attrs.push(ippAttribute(0x49, 'document-format', 'image/jpeg'));
    attrs.push(ippAttribute(0x42, 'job-name', jobName || 'ARTEVA Receipt'));
    attrs.push(Buffer.from([0x02])); // job-attributes-tag
    attrs.push(ippIntAttribute(0x21, 'copies', 1));
    attrs.push(Buffer.from([0x03])); // end-of-attributes

    const header = Buffer.alloc(8);
    header.writeUInt8(2, 0);    // IPP 2.0
    header.writeUInt8(0, 1);
    header.writeUInt16BE(0x0002, 2); // Print-Job
    header.writeUInt32BE(Math.floor(Math.random() * 0xFFFF), 4);

    return Buffer.concat([header, Buffer.concat(attrs), jpegBuffer]);
}

function sendIppRequest(printerUrl, ippData) {
    return new Promise((resolve, reject) => {
        const url = new URL(printerUrl);
        const client = url.protocol === 'https:' ? https : http;

        const req = client.request({
            hostname: url.hostname,
            port: url.port || 631,
            path: url.pathname || '/ipp/print',
            method: 'POST',
            headers: {
                'Content-Type': 'application/ipp',
                'Content-Length': ippData.length
            },
            timeout: 30000
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const response = Buffer.concat(chunks);
                if (response.length >= 4) {
                    const statusCode = response.readUInt16BE(2);
                    resolve({
                        success: statusCode <= 0x00FF,
                        statusCode: `0x${statusCode.toString(16).padStart(4, '0')}`,
                        message: statusCode <= 0x00FF ? 'Print job accepted' : `IPP error: 0x${statusCode.toString(16)}`
                    });
                } else {
                    resolve({ success: true, message: 'Request sent' });
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('IPP timeout')); });
        req.write(ippData);
        req.end();
    });
}

// ═══════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════

async function autoPrintReceipt(order, customer) {
    const printerUrl = process.env.PRINTER_IPP_URL;
    if (!printerUrl) {
        console.log('[PRINT] PRINTER_IPP_URL not configured — skipping');
        return { success: false, reason: 'Not configured' };
    }

    try {
        console.log(`[PRINT] 🖨️ Rendering receipt for ${order.orderNumber}...`);
        const jpegBuffer = renderReceiptToJpeg(order, customer);
        console.log(`[PRINT] 📄 Receipt rendered: ${(jpegBuffer.length / 1024).toFixed(1)} KB`);

        const ippData = buildIppPrintJob(jpegBuffer, `Receipt-${order.orderNumber}`);
        console.log(`[PRINT] 📡 Sending to ${printerUrl}...`);

        const result = await sendIppRequest(printerUrl, ippData);

        if (result.success) {
            console.log(`[PRINT] ✅ Printed: ${order.orderNumber} (${result.statusCode})`);
        } else {
            console.error(`[PRINT] ❌ Failed: ${result.message}`);
        }
        return result;
    } catch (error) {
        console.error(`[PRINT] ❌ Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function printExistingOrderReceipt(orderId) {
    const Order = require('../models/Order');
    const order = await Order.findById(orderId).populate('user', 'name email phone').lean();
    if (!order) return { success: false, error: 'Order not found' };
    return autoPrintReceipt(order, order.user);
}

module.exports = { autoPrintReceipt, printExistingOrderReceipt, renderReceiptToJpeg };
