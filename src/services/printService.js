/**
 * ARTEVA Maison - Auto-Print Service (HP ePrint)
 * 
 * Sends receipt HTML to the printer's HP ePrint email address.
 * The HP Smart Tank 790 supports ePrint — it has a unique email address.
 * When an email is sent to that address, the printer prints the body/attachment.
 * 
 * How to set up:
 * 1. Open HP Smart app on your phone
 * 2. Go to Printer Settings → HP ePrint
 * 3. Enable ePrint and note the printer's email (e.g., abc123@hpeprint.com)
 * 4. Set HP_EPRINT_EMAIL in your .env file
 * 
 * This service is 100% free — no extra software needed.
 * The printer just needs to be connected to the internet.
 */

const { sendEmail } = require('./emailService');

/**
 * Generate a compact, print-optimized receipt HTML for the printer
 */
function generatePrintReceiptHTML(order, customer) {
    const orderDate = new Date(order.createdAt).toLocaleDateString('en-US', {
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

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        @page { size: A4; margin: 10mm; }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #333; margin: 0; padding: 10px; }
        .header { text-align: center; border-bottom: 2px solid #D4AF37; padding-bottom: 8px; margin-bottom: 10px; }
        .logo { font-size: 22px; font-weight: bold; letter-spacing: 2px; margin: 0; }
        .subtitle { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin: 2px 0; }
        .meta { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; }
        .meta-item { }
        .meta-item .label { font-size: 9px; color: #888; text-transform: uppercase; }
        .meta-item .value { font-weight: 600; margin-top: 1px; }
        .info-box { background: #f9f7f4; border: 1px solid #e6e1d6; border-radius: 4px; padding: 8px; margin-bottom: 8px; font-size: 11px; }
        .info-box .label { font-size: 9px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
        .items-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
        .items-table th { background: #f5f2ec; padding: 4px; font-size: 9px; text-transform: uppercase; color: #888; text-align: left; }
        .totals { width: 200px; margin-left: auto; }
        .total-row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
        .total-row.grand { border-top: 2px solid #D4AF37; margin-top: 4px; padding-top: 4px; font-size: 14px; font-weight: bold; }
        .footer { text-align: center; font-size: 9px; color: #888; margin-top: 10px; border-top: 1px solid #ddd; padding-top: 6px; }
        .policy { background: #fffbeb; border: 1px solid #f0e6c0; border-radius: 4px; padding: 6px; margin-top: 8px; font-size: 9px; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <p class="logo">ARTÉVA MAISON</p>
        <p class="subtitle">Order Receipt / إيصال الطلب</p>
    </div>

    <div class="meta">
        <div class="meta-item">
            <div class="label">Order / رقم الطلب</div>
            <div class="value">${order.orderNumber}</div>
        </div>
        <div class="meta-item">
            <div class="label">Date / التاريخ</div>
            <div class="value">${orderDate}</div>
        </div>
        <div class="meta-item">
            <div class="label">Payment / الدفع</div>
            <div class="value">${(order.paymentMethod || 'N/A').toUpperCase()}</div>
        </div>
    </div>

    <div style="display:flex;gap:8px;">
        <div class="info-box" style="flex:1;">
            <div class="label">Customer / العميل</div>
            <div style="font-weight:600;">${customer ? customer.name : 'Guest'}</div>
            <div>${customer ? customer.email : ''}</div>
            <div>${customer ? (customer.phone || '') : ''}</div>
        </div>
        <div class="info-box" style="flex:1;">
            <div class="label">Shipping / الشحن</div>
            <div>${addressParts.join(', ')}</div>
            ${addr.phone ? '<div>📞 ' + addr.phone + '</div>' : ''}
        </div>
    </div>

    <table class="items-table">
        <thead>
            <tr>
                <th style="width:12%;">SKU</th>
                <th style="width:38%;">Item / المنتج</th>
                <th style="width:10%;text-align:center;">Qty</th>
                <th style="width:18%;text-align:right;">Price</th>
                <th style="width:22%;text-align:right;">Total</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHtml}
        </tbody>
    </table>

    <div class="totals">
        <div class="total-row">
            <span>Subtotal</span>
            <span>${(order.subtotal || 0).toFixed(3)} KWD</span>
        </div>
        <div class="total-row">
            <span>Delivery</span>
            <span>${(order.shippingCost || 0).toFixed(3)} KWD</span>
        </div>
        <div class="total-row grand">
            <span>TOTAL</span>
            <span>${(order.total || 0).toFixed(3)} KWD</span>
        </div>
    </div>

    <div class="policy">
        <strong>Return Policy / سياسة الإرجاع:</strong> 14-day return on unopened items. / إرجاع خلال ١٤ يومًا للمنتجات غير المفتوحة.<br>
        WhatsApp: +965 5563 6321
    </div>

    <div class="footer">
        <p>Thank you for shopping with ARTÉVA Maison! / شكراً لتسوقكم مع أرتيفا ميزون</p>
        <p>www.artevamaisonkw.com • artevamaison@gmail.com</p>
    </div>
</body>
</html>`;
}

/**
 * Auto-print receipt via HP ePrint
 * Sends the receipt HTML as an email to the printer's ePrint address
 * 
 * @param {Object} order - The order document
 * @param {Object} customer - The customer/user document
 */
async function autoPrintReceipt(order, customer) {
    const printerEmail = process.env.HP_EPRINT_EMAIL;

    if (!printerEmail) {
        console.log('[PRINT] HP_EPRINT_EMAIL not configured — skipping auto-print');
        return { success: false, reason: 'HP ePrint email not configured' };
    }

    try {
        console.log(`[PRINT] 🖨️ Sending receipt for order ${order.orderNumber} to printer: ${printerEmail}`);

        const receiptHtml = generatePrintReceiptHTML(order, customer);

        const result = await sendEmail({
            to: printerEmail,
            subject: `Receipt - ${order.orderNumber}`,
            html: receiptHtml
        });

        if (result.success) {
            console.log(`[PRINT] ✅ Receipt sent to printer for order ${order.orderNumber}`);
        } else {
            console.error(`[PRINT] ❌ Failed to send to printer: ${result.error}`);
        }

        return result;
    } catch (error) {
        console.error(`[PRINT] ❌ Auto-print error for order ${order.orderNumber}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Manually trigger a receipt print (for admin use)
 */
async function printExistingOrderReceipt(orderId) {
    const Order = require('../models/Order');
    const order = await Order.findById(orderId).populate('user', 'name email phone').lean();

    if (!order) {
        return { success: false, error: 'Order not found' };
    }

    return autoPrintReceipt(order, order.user);
}

module.exports = {
    autoPrintReceipt,
    printExistingOrderReceipt,
    generatePrintReceiptHTML
};
