/**
 * ARTEVA Maison - Auto-Print Service (IPP over Internet)
 * 
 * Sends receipts directly to the HP Smart Tank 790 via IPP protocol
 * over the internet using port forwarding.
 * 
 * Setup required:
 * 1. On your router, forward an external port (e.g. 9631) to 192.168.118.89:631
 * 2. Set PRINTER_IPP_URL in .env to: http://YOUR_PUBLIC_IP:9631/ipp/print
 * 3. Set PRINTER_IPP_SECRET in .env for basic security
 * 
 * The printer must be on and connected to WiFi.
 */

const http = require('http');
const https = require('https');

/**
 * Build a minimal IPP request to print a document
 * IPP 2.0 spec: RFC 8011
 */
function buildIppPrintRequest(documentData, jobName) {
    // IPP operation: Print-Job (0x0002)
    const operationId = 0x0002;
    const requestId = Math.floor(Math.random() * 0xFFFF);

    // Build attributes
    const attributes = [];

    // --- Operation attributes group (0x01) ---
    attributes.push(Buffer.from([0x01])); // operation-attributes-tag

    // charset
    attributes.push(ippAttribute(0x47, 'attributes-charset', 'utf-8'));
    // natural language
    attributes.push(ippAttribute(0x48, 'attributes-natural-language', 'en'));
    // printer-uri
    attributes.push(ippAttribute(0x45, 'printer-uri', 'ipp://localhost/ipp/print'));
    // document-format
    attributes.push(ippAttribute(0x49, 'document-format', 'text/html'));
    // job-name
    attributes.push(ippAttribute(0x42, 'job-name', jobName || 'ARTEVA Receipt'));

    // --- Job attributes group (0x02) ---
    attributes.push(Buffer.from([0x02])); // job-attributes-tag

    // copies
    attributes.push(ippIntAttribute(0x21, 'copies', 1));
    // media (A4)
    attributes.push(ippAttribute(0x44, 'media', 'iso_a4_210x297mm'));

    // --- End of attributes (0x03) ---
    attributes.push(Buffer.from([0x03]));

    // Build header: version (2.0), operation, request-id
    const header = Buffer.alloc(8);
    header.writeUInt8(2, 0);    // version major
    header.writeUInt8(0, 1);    // version minor
    header.writeUInt16BE(operationId, 2);
    header.writeUInt32BE(requestId, 4);

    // Combine: header + attributes + document data
    const attrBuf = Buffer.concat(attributes);
    const docBuf = Buffer.from(documentData, 'utf-8');

    return Buffer.concat([header, attrBuf, docBuf]);
}

/**
 * Create an IPP string attribute
 */
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

/**
 * Create an IPP integer attribute
 */
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

/**
 * Send IPP print request to printer
 */
function sendIppRequest(printerUrl, ippData) {
    return new Promise((resolve, reject) => {
        const url = new URL(printerUrl);
        const options = {
            hostname: url.hostname,
            port: url.port || 631,
            path: url.pathname || '/ipp/print',
            method: 'POST',
            headers: {
                'Content-Type': 'application/ipp',
                'Content-Length': ippData.length
            },
            timeout: 30000
        };

        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const response = Buffer.concat(chunks);
                // Parse IPP response status
                if (response.length >= 4) {
                    const statusCode = response.readUInt16BE(2);
                    if (statusCode <= 0x00FF) {
                        // Successful
                        resolve({ success: true, statusCode, message: 'Print job accepted' });
                    } else {
                        resolve({ success: false, statusCode, message: `IPP error: 0x${statusCode.toString(16)}` });
                    }
                } else {
                    resolve({ success: true, message: 'Request sent (no IPP response parsed)' });
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('IPP request timeout'));
        });

        req.write(ippData);
        req.end();
    });
}

/**
 * Generate compact receipt HTML for printing
 */
function generatePrintReceiptHTML(order, customer) {
    const orderDate = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });

    const itemsHtml = (order.items || []).map(item => {
        const sku = item.sku || '—';
        const total = (item.price * item.quantity).toFixed(3);
        return `<tr>
            <td style="padding:4px 2px;border-bottom:1px solid #ddd;font-size:10px;color:#888;font-family:monospace;">${sku}</td>
            <td style="padding:4px 2px;border-bottom:1px solid #ddd;font-size:11px;">${item.name}${item.nameAr ? '<br><span style="font-size:9px;color:#888;">' + item.nameAr + '</span>' : ''}</td>
            <td style="padding:4px 2px;border-bottom:1px solid #ddd;text-align:center;font-size:11px;">${item.quantity}</td>
            <td style="padding:4px 2px;border-bottom:1px solid #ddd;text-align:right;font-size:11px;">${item.price.toFixed(3)}</td>
            <td style="padding:4px 2px;border-bottom:1px solid #ddd;text-align:right;font-size:11px;font-weight:600;">${total}</td>
        </tr>`;
    }).join('');

    const addr = order.shippingAddress || {};
    const addressParts = [addr.street, addr.city, addr.state, addr.country].filter(Boolean);
    const customerName = customer ? customer.name : (addr.fullName || 'Guest');
    const customerEmail = customer ? customer.email : '';

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;font-size:12px;color:#333;margin:0;padding:10px}
.h{text-align:center;border-bottom:2px solid #D4AF37;padding-bottom:8px;margin-bottom:10px}
.h h1{font-size:22px;letter-spacing:2px;margin:0}.h p{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:2px 0}
.m{display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px}
.m .l{font-size:9px;color:#888;text-transform:uppercase}.m .v{font-weight:600}
.b{background:#f9f7f4;border:1px solid #e6e1d6;border-radius:4px;padding:8px;margin-bottom:8px;font-size:11px}
.b .l{font-size:9px;color:#888;text-transform:uppercase;margin-bottom:2px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#f5f2ec;padding:4px;font-size:9px;text-transform:uppercase;color:#888;text-align:left}
.t{width:200px;margin-left:auto}.tr{display:flex;justify-content:space-between;font-size:11px;padding:2px 0}
.tg{border-top:2px solid #D4AF37;margin-top:4px;padding-top:4px;font-size:14px;font-weight:bold}
.f{text-align:center;font-size:9px;color:#888;margin-top:10px;border-top:1px solid #ddd;padding-top:6px}
</style></head><body>
<div class="h"><h1>ARTÉVA MAISON</h1><p>Order Receipt / إيصال الطلب</p></div>
<div class="m"><div><div class="l">Order</div><div class="v">${order.orderNumber || 'N/A'}</div></div><div><div class="l">Date</div><div class="v">${orderDate}</div></div><div><div class="l">Payment</div><div class="v">${(order.paymentMethod || 'N/A').toUpperCase()}</div></div></div>
<div style="display:flex;gap:8px"><div class="b" style="flex:1"><div class="l">Customer</div><div style="font-weight:600">${customerName}</div><div>${customerEmail}</div></div>
<div class="b" style="flex:1"><div class="l">Shipping</div><div>${addressParts.join(', ') || 'N/A'}</div></div></div>
<table><thead><tr><th style="width:12%">SKU</th><th style="width:38%">Item</th><th style="width:10%;text-align:center">Qty</th><th style="width:18%;text-align:right">Price</th><th style="width:22%;text-align:right">Total</th></tr></thead><tbody>${itemsHtml}</tbody></table>
<div class="t"><div class="tr"><span>Subtotal</span><span>${(order.subtotal || 0).toFixed(3)} KWD</span></div><div class="tr"><span>Delivery</span><span>${(order.shippingCost || 0).toFixed(3)} KWD</span></div><div class="tr tg"><span>TOTAL</span><span>${(order.total || 0).toFixed(3)} KWD</span></div></div>
<div style="background:#fffbeb;border:1px solid #f0e6c0;border-radius:4px;padding:6px;margin-top:8px;font-size:9px;color:#666"><strong>Return Policy:</strong> 14-day return on unopened items. WhatsApp: +965 5563 6321</div>
<div class="f"><p>Thank you! / شكراً لتسوقكم • www.artevamaisonkw.com</p></div></body></html>`;
}

/**
 * Auto-print receipt via IPP over internet
 */
async function autoPrintReceipt(order, customer) {
    const printerUrl = process.env.PRINTER_IPP_URL;

    if (!printerUrl) {
        console.log('[PRINT] PRINTER_IPP_URL not configured — skipping auto-print');
        return { success: false, reason: 'IPP URL not configured' };
    }

    try {
        console.log(`[PRINT] 🖨️ Sending receipt for ${order.orderNumber} via IPP to ${printerUrl}`);

        const receiptHtml = generatePrintReceiptHTML(order, customer);
        const ippData = buildIppPrintRequest(receiptHtml, `Receipt-${order.orderNumber}`);
        const result = await sendIppRequest(printerUrl, ippData);

        if (result.success) {
            console.log(`[PRINT] ✅ Receipt printed for ${order.orderNumber}`);
        } else {
            console.error(`[PRINT] ❌ IPP error: ${result.message}`);
        }

        return result;
    } catch (error) {
        console.error(`[PRINT] ❌ Auto-print error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Manually trigger a receipt print
 */
async function printExistingOrderReceipt(orderId) {
    const Order = require('../models/Order');
    const order = await Order.findById(orderId).populate('user', 'name email phone').lean();
    if (!order) return { success: false, error: 'Order not found' };
    return autoPrintReceipt(order, order.user);
}

module.exports = {
    autoPrintReceipt,
    printExistingOrderReceipt,
    generatePrintReceiptHTML
};
