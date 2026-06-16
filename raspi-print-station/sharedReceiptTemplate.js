/**
 * ARTÉVA MAISON — Shared Receipt HTML Template
 * SINGLE SOURCE OF TRUTH — Used by:
 *   1. Raspberry Pi print agent (raspi-print-station/templates.js)
 *   2. Backend receiptTemplate.js (admin receipt generation)
 *   3. Receipt HTML API endpoint (for receipt.html frontend)
 *
 * ⚠️  DO NOT MODIFY THIS FILE WITHOUT ALSO TESTING:
 *     - Raspberry Pi printed receipt
 *     - Frontend receipt.html rendering
 *     - Admin receipt preview
 *
 * This is an EXACT COPY of the raspi templates.js receipt HTML.
 * The raspi templates.js now imports from here.
 */

// ── HTML Escaping (prevents XSS injection in Chromium renderer) ──
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe number formatting — never crashes on null/undefined/NaN
function safeFixed(val, digits = 3) {
  const num = parseFloat(val);
  if (isNaN(num)) return '0.000';
  return num.toFixed(digits);
}

/**
 * Build the full receipt HTML string.
 * @param {Object} order - The order document (with populated user, items, shippingAddress)
 * @param {Object} options - Optional configuration
 * @param {string} options.receiptQR - Base64 data URL for receipt QR code (required)
 * @param {string} options.whatsappQR - Base64 data URL for WhatsApp QR code (required)
 * @param {string|null} options.logoBase64 - Base64 data URL for logo image (optional)
 * @returns {string} Complete HTML document string
 */
function buildReceiptHTMLFromData(order, { receiptQR, whatsappQR, logoBase64 = null } = {}) {
  if (!order) throw new Error('buildReceiptHTMLFromData: order is null');

  const logoB64 = logoBase64;
  const date = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const customer = order.user || {};
  const addr = order.shippingAddress || {};
  const items = order.items || [];
  const statusRaw = escapeHTML((order.orderStatus || 'pending').replace(/_/g, ' '));
  const payStatusRaw = escapeHTML((order.paymentStatus || 'pending').replace(/_/g, ' '));
  const payMap = { cod: 'Cash on Delivery / الدفع عند الاستلام', knet: 'KNET / كي نت', card: 'Credit/Debit Card / بطاقة ائتمان', applepay: 'Apple Pay / أبل باي', myfatoorah: 'Online Payment / دفع إلكتروني', deema: 'Deema (BNPL) / ديما' };
  const payMethod = escapeHTML(payMap[order.paymentMethod] || (order.paymentMethod || 'N/A').toUpperCase());
  const customerName = escapeHTML(customer.name || addr.fullName || 'Guest');
  const addressParts = [addr.street || addr.address || addr.addressLine1, addr.area, addr.block ? 'Block ' + addr.block : '', addr.city, addr.governorate || addr.state, addr.country].filter(Boolean).map(escapeHTML);

  const statusBadge = ['confirmed', 'delivered'].includes(order.orderStatus)
    ? 'background:#d1fae5;color:#065f46' : order.orderStatus === 'cancelled'
      ? 'background:#fee2e2;color:#991b1b' : 'background:#fef3c7;color:#92400e';
  const payBadge = order.paymentStatus === 'paid'
    ? 'background:#d1fae5;color:#065f46' : order.paymentStatus === 'failed'
      ? 'background:#fee2e2;color:#991b1b' : 'background:#fef3c7;color:#92400e';

  const promoDiscounts = (order.promoCode && order.promoCode.discounts) ? order.promoCode.discounts : [];
  const itemsHTML = items.map(it => {
    const sku = escapeHTML(it.sku || '—');
    const name = escapeHTML(it.name || 'Unknown');
    const nameAr = escapeHTML(it.nameAr || '');
    const price = safeFixed(it.price);
    const qty = parseInt(it.quantity) || 1;
    const originalTotal = (parseFloat(it.price) || 0) * qty;
    const itemDiscount = promoDiscounts.find(d => {
      const dProd = (d.product && d.product._id ? d.product._id : (d.product || '')).toString();
      const iProd = (it.product && it.product._id ? it.product._id : (it.product || it._id || '')).toString();
      return dProd && iProd && dProd === iProd;
    });
    let priceCell, totalCell;
    if (itemDiscount) {
      const discountedUnitPrice = safeFixed((parseFloat(it.price) * qty - (parseFloat(itemDiscount.discountAmount) || 0)) / qty);
      const discountedTotal = safeFixed(originalTotal - (parseFloat(itemDiscount.discountAmount) || 0));
      priceCell = `<span style="text-decoration:line-through;color:#999">${price} KWD</span><br><span style="color:#059669;font-weight:600">${discountedUnitPrice} KWD</span>`;
      totalCell = `<span style="color:#059669;font-weight:600">${discountedTotal} KWD</span>`;
    } else {
      priceCell = `${price} KWD`;
      totalCell = `${safeFixed(originalTotal)} KWD`;
    }
    return `<tr>
      <td class="sku-col">${sku}</td>
      <td>
        <div style="font-weight:500">${name}</div>
        ${nameAr ? '<div style="font-size:10px;color:#888;font-family:var(--font-arabic);direction:rtl">' + nameAr + '</div>' : ''}
      </td>
      <td>${priceCell}</td>
      <td style="text-align:center">${qty}</td>
      <td style="text-align:right">${totalCell}</td>
    </tr>`;
  }).join('');

  const escapedOrderNumber = escapeHTML(order.orderNumber || 'N/A');
  const escapedEmail = escapeHTML(customer.email || '');
  const escapedPhone = escapeHTML(customer.phone || addr.phone || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  :root {
    --color-text: #2c241b;
    --color-text-light: #666;
    --color-border: #e6e1d6;
    --color-gold: #D4AF37;
    --font-display: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
    --font-body: 'Montserrat', 'Segoe UI', Arial, sans-serif;
    --font-arabic: 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif;
  }

  body {
    font-family: var(--font-body);
    color: var(--color-text);
    background: #fff;
    padding: 20px;
    max-width: 800px;
    margin: 0 auto;
    font-size: 13px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    text-rendering: geometricPrecision;
    -webkit-font-smoothing: subpixel-antialiased;
  }

  .header {
    text-align: center;
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--color-gold);
  }
  .header-logo { max-width: 220px; height: auto; margin-bottom: 8px; }
  .logo-text { display: flex; flex-direction: column; align-items: center; line-height: 1.1; margin-bottom: 6px; }
  .logo-text .main { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: 0.15em; color: var(--color-text); }
  .logo-text .sub { font-family: var(--font-display); font-size: 12px; font-weight: 400; letter-spacing: 0.3em; color: var(--color-gold); }
  .logo { font-family: var(--font-display); font-size: 26px; font-weight: 700; letter-spacing: 2px; margin-bottom: 4px; text-transform: uppercase; }
  .receipt-title { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: var(--color-text-light); }
  .receipt-title-ar { font-family: var(--font-arabic); font-size: 11px; color: var(--color-text-light); margin-top: 2px; direction: rtl; }

  .order-meta { display: flex; justify-content: space-between; margin-bottom: 14px; }
  .meta-group h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--color-text-light); margin: 0 0 3px 0; }
  .meta-group .ar-label { font-family: var(--font-arabic); font-size: 9px; color: #999; direction: rtl; display: block; }
  .meta-group p { margin: 0; font-weight: 500; font-size: 13px; }

  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; padding: 12px; background: #fafaf8; border-radius: 6px; border: 1px solid var(--color-border); }
  .info-grid .meta-group p { font-size: 12px; }

  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .items-table th { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--color-border); font-family: var(--font-display); font-size: 13px; }
  .items-table td { padding: 8px 4px; border-bottom: 1px solid var(--color-border); font-size: 12px; }
  .sku-col { color: var(--color-text-light); font-size: 11px; font-family: monospace; }

  .total-section { width: 260px; margin-left: auto; }
  .total-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
  .total-row.final { border-top: 2px solid var(--color-border); margin-top: 6px; padding-top: 6px; font-weight: 700; font-size: 15px; }
  .promo-row { color: #059669; font-style: italic; }

  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: capitalize; }

  .qr-section { display: flex; align-items: center; justify-content: center; gap: 30px; margin-top: 14px; padding: 14px; border: 1.5px solid var(--color-gold); border-radius: 8px; background: #fafaf8; }
  .qr-box { text-align: center; }
  .qr-code-wrapper { position: relative; width: 100px; height: 100px; margin: 0 auto; }
  .qr-code-wrapper img { width: 100px; height: 100px; border: 2px solid var(--color-gold); border-radius: 6px; }
  .qr-logo-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 30px; height: 30px; background: #fff; border-radius: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--color-gold); line-height: 1; padding: 2px; }
  .qr-logo-overlay .qo-main { font-family: var(--font-display); font-size: 9px; font-weight: 700; color: var(--color-text); letter-spacing: 0.5px; }
  .qr-logo-overlay .qo-sub { font-family: var(--font-display); font-size: 5px; font-weight: 400; color: var(--color-gold); letter-spacing: 1px; }
  .qr-wa-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 26px; height: 26px; background: #25D366; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .qr-wa-overlay svg { width: 16px; height: 16px; fill: #fff; }
  .qr-label { font-size: 11px; font-weight: 600; color: var(--color-text); margin-top: 6px; }
  .qr-label-ar { font-family: var(--font-arabic); font-size: 10px; color: var(--color-text-light); direction: rtl; }

  .return-policy { margin-top: 14px; padding: 10px 12px; background: #fffbeb; border: 1px solid #f59e0b33; border-radius: 6px; border-left: 3px solid var(--color-gold); }
  .return-policy h4 { font-family: var(--font-display); font-size: 14px; margin: 0 0 4px; color: var(--color-text); }
  .return-policy .ar-title { font-family: var(--font-arabic); font-size: 12px; direction: rtl; margin: 0 0 6px; color: var(--color-text); font-weight: 600; }
  .return-policy p { margin: 2px 0; font-size: 11px; color: var(--color-text-light); line-height: 1.5; }
  .return-policy .ar-text { font-family: var(--font-arabic); direction: rtl; text-align: right; }

  .footer { margin-top: 14px; text-align: center; font-size: 11px; color: var(--color-text-light); border-top: 1px solid var(--color-border); padding-top: 10px; }
  .footer .ar-footer { font-family: var(--font-arabic); direction: rtl; margin-top: 4px; }

  /* Print — exact match of receipt.html @media print */
  @page { size: A4; margin: 8mm 10mm; }
  @media print {
    body { padding: 0; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .info-grid { background: #fafaf8 !important; border: 1px solid #ddd; }
    .return-policy { background: #fffbeb !important; }
    .qr-section { background: #fafaf8 !important; }
    .header { margin-bottom: 10px; padding-bottom: 8px; }
    .logo { font-size: 22px; }
    .order-meta { margin-bottom: 10px; }
    .info-grid { margin-bottom: 10px; padding: 8px; gap: 10px; }
    .items-table { margin-bottom: 10px; }
    .items-table th { padding: 4px 2px; font-size: 11px; }
    .items-table td { padding: 5px 2px; font-size: 10px; }
    .total-section { width: 220px; }
    .total-row { font-size: 10px; }
    .total-row.final { font-size: 13px; }
    .return-policy { margin-top: 10px; padding: 8px; }
    .return-policy h4 { font-size: 12px; }
    .return-policy p { font-size: 9px; }
    .qr-section { margin-top: 10px; padding: 8px; }
    .qr-code-wrapper { width: 80px; height: 80px; }
    .qr-code-wrapper img { width: 80px !important; height: 80px !important; }
    .footer { margin-top: 10px; font-size: 9px; padding-top: 6px; }
    .info-grid, .items-table, .total-section, .return-policy, .qr-section, .footer {
      page-break-inside: avoid;
    }
  }
</style>
</head>
<body>

<div class="header">
  ${logoB64 ? '<img src="' + logoB64 + '" class="header-logo" alt="ARTÉVA MAISON">' : '<div class="logo-text"><span class="main">ARTÉVA</span><span class="sub">MAISON</span></div>'}
  <div class="receipt-title">Order Receipt</div>
  <div class="receipt-title-ar">إيصال الطلب</div>
</div>

<div class="order-meta">
  <div class="meta-group">
    <h3>Order Number <span class="ar-label">رقم الطلب</span></h3>
    <p>${escapedOrderNumber}</p>
  </div>
  <div class="meta-group">
    <h3>Date <span class="ar-label">التاريخ</span></h3>
    <p>${escapeHTML(date)}</p>
  </div>
  <div class="meta-group">
    <h3>Order Status <span class="ar-label">حالة الطلب</span></h3>
    <p><span class="status-badge" style="${statusBadge}">${statusRaw}</span></p>
  </div>
</div>

<div class="info-grid">
  <div class="meta-group">
    <h3>Customer Details <span class="ar-label">بيانات العميل</span></h3>
    <p style="font-weight:600;margin-bottom:2px">${customerName}</p>
    <p style="font-size:11px;color:#666;font-weight:400">${escapedEmail}</p>
    <p style="font-size:11px;color:#666;font-weight:400">${escapedPhone}</p>
  </div>
  <div class="meta-group">
    <h3>Shipping Address <span class="ar-label">عنوان الشحن</span></h3>
    <p style="white-space:pre-line;line-height:1.4;font-weight:400;font-size:11px">${addressParts.join('\\n')}</p>
  </div>
</div>

<div class="info-grid">
  <div class="meta-group">
    <h3>Payment Method <span class="ar-label">طريقة الدفع</span></h3>
    <p style="text-transform:uppercase">${payMethod}</p>
  </div>
  <div class="meta-group">
    <h3>Payment Status <span class="ar-label">حالة الدفع</span></h3>
    <p><span class="status-badge" style="${payBadge}">${payStatusRaw}</span></p>
  </div>
</div>

<table class="items-table">
  <thead><tr>
    <th width="10%">SKU / رقم</th>
    <th width="40%">Item / المنتج</th>
    <th width="18%">Unit Price / السعر</th>
    <th width="10%" style="text-align:center">Qty / الكمية</th>
    <th width="22%" style="text-align:right">Total / المجموع</th>
  </tr></thead>
  <tbody>${itemsHTML}</tbody>
</table>

<div class="total-section">
  <div class="total-row"><span>Subtotal / المجموع الفرعي</span><span>${safeFixed(order.subtotal || order.total)} KWD</span></div>
  <div class="total-row"><span>Delivery / التوصيل</span><span>${safeFixed(order.shippingCost)} KWD</span></div>
  ${order.promoCode && order.promoCode.code ? '<div class="total-row promo-row"><span>Promo Code: ' + escapeHTML(order.promoCode.code) + ' / رمز الخصم</span><span>-' + safeFixed(order.promoCode.totalDiscount || order.discount) + ' KWD</span></div>' : ''}
  <div class="total-row final"><span>Total Paid / المبلغ المدفوع</span><span>${safeFixed(order.total)} KWD</span></div>
</div>

<div class="qr-section">
  <div class="qr-box">
    <div class="qr-code-wrapper">
      <img src="${receiptQR}" alt="Receipt QR">
      <div class="qr-logo-overlay"><span class="qo-main">ARTÉVA</span><span class="qo-sub">MAISON</span></div>
    </div>
    <div class="qr-label">Scan for Digital Receipt</div>
    <div class="qr-label-ar">امسح للإيصال الرقمي</div>
  </div>
  <div class="qr-box">
    <div class="qr-code-wrapper">
      <img src="${whatsappQR}" alt="WhatsApp QR">
      <div class="qr-wa-overlay"><svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></div>
    </div>
    <div class="qr-label">Contact us on WhatsApp</div>
    <div class="qr-label-ar">تواصل معنا عبر واتساب</div>
  </div>
</div>

<div class="return-policy">
  <h4>Return &amp; Exchange Policy</h4>
  <div class="ar-title">سياسة الإرجاع والاستبدال</div>
  <p>Products may be returned or exchanged within <strong>14 days</strong> of delivery, provided they are <strong>unopened</strong> and in their <strong>original condition and packaging</strong>.</p>
  <p class="ar-text">يمكن إرجاع أو استبدال المنتجات خلال <strong>١٤ يومًا</strong> من التسليم، بشرط أن تكون <strong>غير مفتوحة</strong> وفي <strong>حالتها وتغليفها الأصلي</strong>.</p>
  <p style="margin-top:4px">For returns, email us at: <strong>artevamaison@gmail.com</strong></p>
  <p class="ar-text">للإرجاع، تواصلوا معنا عبر البريد الإلكتروني: <strong>artevamaison@gmail.com</strong></p>
</div>

<div class="footer">
  <p>Thank you for shopping with ARTÉVA Maison.</p>
  <p class="ar-footer">شكراً لتسوقكم مع أرتيفا ميزون</p>
  <p>artevamaison@gmail.com • www.artevamaisonkw.com</p>
</div>

</div>

<script>
// Dynamic single-page scaler: shrinks content if it overflows A4 height
(function() {
  var A4_HEIGHT_PX = 1045; // ~277mm printable at 96dpi minus margins
  var body = document.body;
  var h = body.scrollHeight;
  if (h > A4_HEIGHT_PX) {
    var scale = Math.max(0.72, A4_HEIGHT_PX / h);
    body.style.transform = 'scale(' + scale + ')';
    body.style.transformOrigin = 'top left';
    body.style.width = (100 / scale) + '%';
  }
})();
</script>

</body></html>`;
}

module.exports = { buildReceiptHTMLFromData, escapeHTML, safeFixed };
