/**
 * ARTEVA Maison - Auto-Print Service (IPP + High-Res JPEG)
 * 
 * Renders receipts as 300 DPI JPEG images using canvas,
 * then sends them to the HP Smart Tank 790 via IPP.
 * 
 * Features:
 * - 300 DPI print quality (2480×3508 px for A4)
 * - QR code with Arteva "A" logo
 * - Full bilingual receipt (EN/AR)
 * - SKU column
 * - Return policy
 */

const http = require('http');
const https = require('https');
const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');

// ═══════════════════════════════════════
// CONSTANTS - 300 DPI A4
// ═══════════════════════════════════════
const DPI = 300;
const W = Math.round(8.27 * DPI);   // 2481 px (A4 width)
const H = Math.round(11.69 * DPI);  // 3507 px (A4 height)
const SCALE = DPI / 72;             // ~4.17x scale from 72dpi

// Margins & spacing (in 300dpi pixels)
const M = Math.round(15 * SCALE);   // ~62px margin
const GOLD = '#D4AF37';
const DARK = '#222222';
const MID = '#555555';
const LIGHT = '#888888';
const VLIGHT = '#bbbbbb';

// Font sizes (scaled for 300dpi)
function fs(pt) { return Math.round(pt * SCALE); }

// ═══════════════════════════════════════
// QR CODE GENERATOR
// ═══════════════════════════════════════
async function generateQRWithLogo(url, size) {
    // Generate QR as canvas
    const qrCanvas = createCanvas(size, size);
    await QRCode.toCanvas(qrCanvas, url, {
        width: size,
        margin: 1,
        color: { dark: '#333333', light: '#ffffff' },
        errorCorrectionLevel: 'H' // High - allows logo overlay
    });

    const ctx = qrCanvas.getContext('2d');

    // Draw gold border
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.round(size * 0.02);
    ctx.strokeRect(0, 0, size, size);

    // Draw "A" logo in center
    const logoSize = Math.round(size * 0.22);
    const logoX = (size - logoSize) / 2;
    const logoY = (size - logoSize) / 2;

    // White background circle for logo
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, logoSize * 0.65, 0, Math.PI * 2);
    ctx.fill();

    // Gold border circle
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.round(size * 0.015);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, logoSize * 0.65, 0, Math.PI * 2);
    ctx.stroke();

    // "A" letter
    ctx.fillStyle = GOLD;
    ctx.font = `bold ${logoSize}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', size / 2, size / 2 + Math.round(logoSize * 0.05));

    return qrCanvas;
}

// ═══════════════════════════════════════
// RECEIPT RENDERER (300 DPI)
// ═══════════════════════════════════════
async function renderReceiptToJpeg(order, customer) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    let y = M;
    const LM = M;
    const RM = W - M;
    const CW = RM - LM;

    // ════════════════════════════════════
    // HEADER
    // ════════════════════════════════════
    ctx.fillStyle = DARK;
    ctx.font = `bold ${fs(26)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('ARTÉVA MAISON', W / 2, y);
    y += fs(30);

    ctx.font = `${fs(10)}px Arial`;
    ctx.fillStyle = LIGHT;
    ctx.letterSpacing = '2px';
    ctx.fillText('ORDER RECEIPT  /  إيصال الطلب', W / 2, y);
    y += fs(16);

    // Gold divider
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = fs(1.5);
    ctx.beginPath();
    ctx.moveTo(LM, y);
    ctx.lineTo(RM, y);
    ctx.stroke();
    y += fs(12);

    // ════════════════════════════════════
    // ORDER META ROW
    // ════════════════════════════════════
    const orderDate = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
    const payment = (order.paymentMethod || 'N/A').toUpperCase();
    const orderStatus = order.paymentStatus === 'paid' ? '✓ PAID' : (order.paymentStatus || 'N/A').toUpperCase();

    const metaCols = [
        { label: 'ORDER / رقم الطلب', value: order.orderNumber || 'N/A' },
        { label: 'DATE / التاريخ', value: orderDate },
        { label: 'PAYMENT / الدفع', value: payment },
        { label: 'STATUS / الحالة', value: orderStatus, color: '#16a34a' }
    ];

    const colW = CW / metaCols.length;
    ctx.textAlign = 'left';
    metaCols.forEach((col, i) => {
        const x = LM + (i * colW);
        ctx.fillStyle = LIGHT;
        ctx.font = `${fs(7)}px Arial`;
        ctx.fillText(col.label, x, y);
        ctx.fillStyle = col.color || DARK;
        ctx.font = `bold ${fs(10)}px Arial`;
        ctx.fillText(col.value, x, y + fs(11));
    });
    y += fs(28);

    // ════════════════════════════════════
    // CUSTOMER & SHIPPING BOXES
    // ════════════════════════════════════
    const boxH = fs(55);
    const boxW = (CW - fs(8)) / 2;
    const customerName = customer ? customer.name : 'Guest';
    const customerEmail = customer ? customer.email : '';
    const customerPhone = customer ? (customer.phone || '') : '';
    const addr = order.shippingAddress || {};
    const addressParts = [addr.street, addr.city, addr.state, addr.country].filter(Boolean);

    // Customer box
    ctx.fillStyle = '#f9f7f4';
    roundRect(ctx, LM, y, boxW, boxH, fs(3));
    ctx.fill();
    ctx.strokeStyle = '#e6e1d6';
    ctx.lineWidth = fs(0.5);
    roundRect(ctx, LM, y, boxW, boxH, fs(3));
    ctx.stroke();

    ctx.fillStyle = LIGHT;
    ctx.font = `${fs(7)}px Arial`;
    ctx.textAlign = 'left';
    ctx.fillText('CUSTOMER / العميل', LM + fs(6), y + fs(10));
    ctx.fillStyle = DARK;
    ctx.font = `bold ${fs(11)}px Arial`;
    ctx.fillText(customerName, LM + fs(6), y + fs(22));
    ctx.font = `${fs(9)}px Arial`;
    ctx.fillStyle = MID;
    ctx.fillText(customerEmail, LM + fs(6), y + fs(33));
    ctx.fillText(customerPhone, LM + fs(6), y + fs(43));

    // Shipping box
    const shipX = LM + boxW + fs(8);
    ctx.fillStyle = '#f9f7f4';
    roundRect(ctx, shipX, y, boxW, boxH, fs(3));
    ctx.fill();
    ctx.strokeStyle = '#e6e1d6';
    roundRect(ctx, shipX, y, boxW, boxH, fs(3));
    ctx.stroke();

    ctx.fillStyle = LIGHT;
    ctx.font = `${fs(7)}px Arial`;
    ctx.fillText('SHIPPING / الشحن', shipX + fs(6), y + fs(10));
    ctx.fillStyle = MID;
    ctx.font = `${fs(9)}px Arial`;

    // Word-wrap address
    const addrText = addressParts.join(', ') || 'N/A';
    wrapText(ctx, addrText, shipX + fs(6), y + fs(22), boxW - fs(12), fs(11));

    if (addr.phone) {
        ctx.fillText('📞 ' + addr.phone, shipX + fs(6), y + fs(43));
    }

    y += boxH + fs(12);

    // ════════════════════════════════════
    // ITEMS TABLE
    // ════════════════════════════════════
    const items = order.items || [];

    // Column definitions
    const tableX = LM;
    const skuW = fs(55);
    const nameW = CW - skuW - fs(45) - fs(70) - fs(85);
    const qtyW = fs(45);
    const priceW = fs(70);
    const totalW = fs(85);

    const colDefs = [
        { label: 'SKU', x: tableX, w: skuW, align: 'left' },
        { label: 'ITEM / المنتج', x: tableX + skuW, w: nameW, align: 'left' },
        { label: 'QTY', x: tableX + skuW + nameW, w: qtyW, align: 'center' },
        { label: 'PRICE', x: tableX + skuW + nameW + qtyW, w: priceW, align: 'right' },
        { label: 'TOTAL', x: tableX + skuW + nameW + qtyW + priceW, w: totalW, align: 'right' }
    ];

    // Table header
    ctx.fillStyle = '#f5f2ec';
    roundRect(ctx, LM, y, CW, fs(16), fs(2));
    ctx.fill();

    ctx.fillStyle = LIGHT;
    ctx.font = `bold ${fs(7)}px Arial`;
    colDefs.forEach(col => {
        ctx.textAlign = col.align;
        const tx = col.align === 'right' ? col.x + col.w : col.align === 'center' ? col.x + col.w / 2 : col.x + fs(3);
        ctx.fillText(col.label, tx, y + fs(11));
    });
    y += fs(20);

    // Table rows
    items.forEach((item, idx) => {
        const sku = item.sku || '—';
        const name = item.name || 'Product';
        const total = (item.price * item.quantity).toFixed(3);
        const rowY = y;

        // SKU
        ctx.textAlign = 'left';
        ctx.fillStyle = LIGHT;
        ctx.font = `${fs(8)}px Courier New`;
        ctx.fillText(sku, colDefs[0].x + fs(3), rowY);

        // Name
        ctx.fillStyle = DARK;
        ctx.font = `${fs(10)}px Arial`;
        const displayName = truncateText(ctx, name, colDefs[1].w - fs(6));
        ctx.fillText(displayName, colDefs[1].x + fs(3), rowY);

        // Arabic name
        if (item.nameAr) {
            ctx.fillStyle = LIGHT;
            ctx.font = `${fs(7.5)}px Arial`;
            ctx.fillText(item.nameAr, colDefs[1].x + fs(3), rowY + fs(11));
        }

        // Qty
        ctx.textAlign = 'center';
        ctx.fillStyle = DARK;
        ctx.font = `${fs(10)}px Arial`;
        ctx.fillText(String(item.quantity), colDefs[2].x + colDefs[2].w / 2, rowY);

        // Price
        ctx.textAlign = 'right';
        ctx.fillText(item.price.toFixed(3), colDefs[3].x + colDefs[3].w, rowY);

        // Total
        ctx.font = `bold ${fs(10)}px Arial`;
        ctx.fillText(total, colDefs[4].x + colDefs[4].w, rowY);

        // Row separator
        y += item.nameAr ? fs(20) : fs(16);
        ctx.strokeStyle = '#eeeeee';
        ctx.lineWidth = fs(0.3);
        ctx.beginPath();
        ctx.moveTo(LM, y);
        ctx.lineTo(RM, y);
        ctx.stroke();
        y += fs(4);
    });

    y += fs(8);

    // ════════════════════════════════════
    // TOTALS
    // ════════════════════════════════════
    const totW2 = fs(200);
    const totX = RM - totW2;
    const amtX = RM - fs(5); // Right-align amounts with padding

    ctx.font = `${fs(10)}px Arial`;
    ctx.fillStyle = MID;
    ctx.textAlign = 'left';
    ctx.fillText('Subtotal', totX, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${(order.subtotal || 0).toFixed(3)} KWD`, amtX, y);
    y += fs(14);

    ctx.textAlign = 'left';
    ctx.fillText('Delivery', totX, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${(order.shippingCost || 0).toFixed(3)} KWD`, amtX, y);
    y += fs(8);

    // Gold divider
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = fs(1.5);
    ctx.beginPath();
    ctx.moveTo(totX, y);
    ctx.lineTo(RM, y);
    ctx.stroke();
    y += fs(14);

    // TOTAL - label on left, amount on right with clear separation
    ctx.textAlign = 'left';
    ctx.font = `bold ${fs(14)}px Arial`;
    ctx.fillStyle = DARK;
    ctx.fillText('TOTAL', totX, y);
    ctx.textAlign = 'right';
    ctx.font = `bold ${fs(16)}px Arial`;
    ctx.fillStyle = GOLD;
    ctx.fillText(`${(order.total || 0).toFixed(3)} KWD`, amtX, y);
    y += fs(24);

    // ════════════════════════════════════
    // QR CODE SECTION
    // ════════════════════════════════════
    const qrSize = fs(70);
    const qrSectionH = qrSize + fs(16);

    // QR background box
    ctx.fillStyle = '#fafaf8';
    roundRect(ctx, LM, y, CW, qrSectionH, fs(4));
    ctx.fill();
    ctx.strokeStyle = '#e6e1d6';
    ctx.lineWidth = fs(0.5);
    roundRect(ctx, LM, y, CW, qrSectionH, fs(4));
    ctx.stroke();

    // Generate and draw QR code
    try {
        const qrUrl = 'https://www.artevamaisonkw.com';
        const qrCanvas = await generateQRWithLogo(qrUrl, qrSize);
        const qrX = LM + fs(12);
        const qrY = y + (qrSectionH - qrSize) / 2;
        ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

        // QR labels
        const labelX = qrX + qrSize + fs(15);
        ctx.textAlign = 'left';
        ctx.fillStyle = DARK;
        ctx.font = `bold ${fs(11)}px Arial`;
        ctx.fillText('Scan for Digital Receipt', labelX, y + fs(22));
        ctx.fillStyle = LIGHT;
        ctx.font = `${fs(9)}px Arial`;
        ctx.fillText('امسح للإيصال الرقمي', labelX, y + fs(34));
        ctx.fillStyle = VLIGHT;
        ctx.font = `${fs(8)}px Arial`;
        ctx.fillText('www.artevamaisonkw.com', labelX, y + fs(48));

        // WhatsApp QR info
        ctx.fillStyle = MID;
        ctx.font = `${fs(9)}px Arial`;
        ctx.fillText('WhatsApp: +965 5068 3207', labelX, y + fs(62));
    } catch (e) {
        console.error('[PRINT] QR generation error:', e.message);
    }

    y += qrSectionH + fs(10);

    // ════════════════════════════════════
    // RETURN POLICY
    // ════════════════════════════════════
    const policyH = fs(28);
    ctx.fillStyle = '#fffbeb';
    roundRect(ctx, LM, y, CW, policyH, fs(3));
    ctx.fill();
    ctx.strokeStyle = '#f0e6c0';
    ctx.lineWidth = fs(0.5);
    roundRect(ctx, LM, y, CW, policyH, fs(3));
    ctx.stroke();

    // Left gold accent bar
    ctx.fillStyle = GOLD;
    ctx.fillRect(LM, y, fs(2), policyH);

    ctx.textAlign = 'left';
    ctx.font = `bold ${fs(8)}px Arial`;
    ctx.fillStyle = '#666666';
    ctx.fillText('Return Policy: 14-day return on unopened items.  |  WhatsApp: +965 5068 3207', LM + fs(8), y + fs(11));
    ctx.font = `${fs(7.5)}px Arial`;
    ctx.fillText('سياسة الإرجاع: إرجاع خلال ١٤ يومًا للمنتجات غير المفتوحة', LM + fs(8), y + fs(22));
    y += policyH + fs(10);

    // ════════════════════════════════════
    // FOOTER
    // ════════════════════════════════════
    ctx.strokeStyle = '#e6e1d6';
    ctx.lineWidth = fs(0.5);
    ctx.beginPath();
    ctx.moveTo(LM, y);
    ctx.lineTo(RM, y);
    ctx.stroke();
    y += fs(10);

    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = `bold ${fs(10)}px Arial`;
    ctx.fillText('Thank you for shopping with ARTÉVA Maison!', W / 2, y);
    y += fs(10);
    ctx.fillStyle = LIGHT;
    ctx.font = `${fs(9)}px Arial`;
    ctx.fillText('شكراً لتسوقكم مع أرتيفا ميزون', W / 2, y);
    y += fs(12);
    ctx.fillStyle = VLIGHT;
    ctx.font = `${fs(8)}px Arial`;
    ctx.fillText('www.artevamaisonkw.com  •  artevamaison@gmail.com  •  +965 5068 3207', W / 2, y);

    // Convert to high-quality JPEG
    return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

// ═══════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    words.forEach(word => {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > maxW && line !== '') {
            ctx.fillText(line.trim(), x, currentY);
            line = word + ' ';
            currentY += lineH;
        } else {
            line = test;
        }
    });
    ctx.fillText(line.trim(), x, currentY);
}

function truncateText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (ctx.measureText(t + '...').width > maxW && t.length > 0) {
        t = t.substring(0, t.length - 1);
    }
    return t + '...';
}

// ═══════════════════════════════════════
// IPP PROTOCOL
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
    attrs.push(Buffer.from([0x01]));
    attrs.push(ippAttribute(0x47, 'attributes-charset', 'utf-8'));
    attrs.push(ippAttribute(0x48, 'attributes-natural-language', 'en'));
    attrs.push(ippAttribute(0x45, 'printer-uri', 'ipp://localhost/ipp/print'));
    attrs.push(ippAttribute(0x49, 'document-format', 'image/jpeg'));
    attrs.push(ippAttribute(0x42, 'job-name', jobName || 'ARTEVA Receipt'));
    attrs.push(Buffer.from([0x02]));
    attrs.push(ippIntAttribute(0x21, 'copies', 1));
    attrs.push(Buffer.from([0x03]));

    const header = Buffer.alloc(8);
    header.writeUInt8(2, 0);
    header.writeUInt8(0, 1);
    header.writeUInt16BE(0x0002, 2);
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
            headers: { 'Content-Type': 'application/ipp', 'Content-Length': ippData.length },
            timeout: 60000
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const r = Buffer.concat(chunks);
                if (r.length >= 4) {
                    const sc = r.readUInt16BE(2);
                    resolve({
                        success: sc <= 0x00FF,
                        statusCode: `0x${sc.toString(16).padStart(4, '0')}`,
                        message: sc <= 0x00FF ? 'Print job accepted' : `IPP error: 0x${sc.toString(16)}`
                    });
                } else {
                    resolve({ success: true, message: 'Request sent' });
                }
            });
        });
        req.on('error', reject);
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
        console.log(`[PRINT] 🖨️ Rendering 300 DPI receipt for ${order.orderNumber}...`);
        const jpegBuffer = await renderReceiptToJpeg(order, customer);
        console.log(`[PRINT] 📄 Receipt: ${(jpegBuffer.length / 1024).toFixed(0)} KB (${W}×${H} px @ ${DPI} DPI)`);

        const ippData = buildIppPrintJob(jpegBuffer, `Receipt-${order.orderNumber}`);
        console.log(`[PRINT] 📡 Sending to ${printerUrl}...`);

        const result = await sendIppRequest(printerUrl, ippData);
        if (result.success) {
            console.log(`[PRINT] ✅ Printed: ${order.orderNumber}`);
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
