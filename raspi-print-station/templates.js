/**
 * ARTÉVA MAISON — Receipt & Label HTML Templates
 * Extracted from print-station.js for modularity.
 * These templates exactly match receipt.html from the frontend.
 */

const QRCode = require('qrcode');
const fsSync = require('fs');
const path = require('path');

// QR Code generation (base64 data URL with high error correction)
async function generateQR(text) {
  return await QRCode.toDataURL(text, {
    width: 200, margin: 1, errorCorrectionLevel: 'H',
    color: { dark: '#2c241b', light: '#ffffff' }
  });
}

// Load logo as base64 for embedding
let _logoCache = null;
function getLogoBase64() {
  if (_logoCache !== null) return _logoCache;
  const logoPath = path.join(__dirname, 'logo.png');
  if (fsSync.existsSync(logoPath)) {
    const buf = fsSync.readFileSync(logoPath);
    _logoCache = 'data:image/png;base64,' + buf.toString('base64');
  } else {
    _logoCache = false;
  }
  return _logoCache || null;
}

// Build receipt HTML — EXACT match of receipt.html from frontend
async function buildReceiptHTML(order) {
  const receiptQR = await generateQR('https://www.artevamaisonkw.com/receipt.html?order=' + (order.orderNumber || ''));
  const whatsappQR = await generateQR('https://wa.me/96550683207');
  const logoB64 = getLogoBase64();
  const date = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const customer = order.user || {};
  const addr = order.shippingAddress || {};
  const items = order.items || [];
  const statusRaw = (order.orderStatus || 'pending').replace(/_/g, ' ');
  const payStatusRaw = (order.paymentStatus || 'pending').replace(/_/g, ' ');
  const payMap = { cod: 'Cash on Delivery / الدفع عند الاستلام', knet: 'KNET / كي نت', card: 'Credit/Debit Card / بطاقة ائتمان', applepay: 'Apple Pay / أبل باي', myfatoorah: 'Online Payment / دفع إلكتروني' };
  const payMethod = payMap[order.paymentMethod] || (order.paymentMethod || 'N/A').toUpperCase();
  const customerName = customer.name || addr.fullName || 'Guest';
  const addressParts = [addr.street || addr.address || addr.addressLine1, addr.area, addr.block ? 'Block ' + addr.block : '', addr.city, addr.governorate || addr.state, addr.country].filter(Boolean);

  const statusBadge = ['confirmed','delivered'].includes(order.orderStatus)
    ? 'background:#d1fae5;color:#065f46' : order.orderStatus === 'cancelled'
    ? 'background:#fee2e2;color:#991b1b' : 'background:#fef3c7;color:#92400e';
  const payBadge = order.paymentStatus === 'paid'
    ? 'background:#d1fae5;color:#065f46' : order.paymentStatus === 'failed'
    ? 'background:#fee2e2;color:#991b1b' : 'background:#fef3c7;color:#92400e';

  const itemsHTML = items.map(it => {
    const sku = it.sku || '—';
    const total = ((it.price || 0) * (it.quantity || 1)).toFixed(3);
    return `<tr>
      <td class="sku-col">${sku}</td>
      <td>
        <div style="font-weight:500">${it.name}</div>
        ${it.nameAr ? '<div style="font-size:10px;color:#888;font-family:var(--font-arabic);direction:rtl">' + it.nameAr + '</div>' : ''}
      </td>
      <td>${(it.price||0).toFixed(3)} KWD</td>
      <td style="text-align:center">${it.quantity}</td>
      <td style="text-align:right">${total} KWD</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Montserrat:wght@300;400;500;600&family=Noto+Sans+Arabic:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --color-text: #2c241b;
    --color-text-light: #666;
    --color-border: #e6e1d6;
    --color-gold: #D4AF37;
    --font-display: 'Cormorant Garamond', serif;
    --font-body: 'Montserrat', sans-serif;
    --font-arabic: 'Noto Sans Arabic', sans-serif;
  }
  @page { size: A4; margin: 8mm 10mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:var(--font-body); color:var(--color-text); background:#fff; padding:20px; max-width:800px; margin:0 auto; font-size:13px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  .header { text-align:center; margin-bottom:16px; padding-bottom:10px; border-bottom:2px solid var(--color-gold); }
  .header-logo { max-width:220px; height:auto; margin-bottom:8px; }
  .logo-text { display:flex; flex-direction:column; align-items:center; line-height:1.1; margin-bottom:6px; }
  .logo-text .main { font-family:var(--font-display); font-size:28px; font-weight:700; letter-spacing:0.15em; color:var(--color-text); }
  .logo-text .sub { font-family:var(--font-display); font-size:12px; font-weight:400; letter-spacing:0.3em; color:var(--color-gold); }
  .receipt-title { font-size:11px; text-transform:uppercase; letter-spacing:2px; color:var(--color-text-light); }
  .receipt-title-ar { font-family:var(--font-arabic); font-size:11px; color:var(--color-text-light); margin-top:2px; direction:rtl; }

  .order-meta { display:flex; justify-content:space-between; margin-bottom:14px; }
  .meta-group h3 { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--color-text-light); margin:0 0 3px 0; }
  .meta-group .ar-label { font-family:var(--font-arabic); font-size:9px; color:#999; direction:rtl; display:block; }
  .meta-group p { margin:0; font-weight:500; font-size:13px; }

  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px; padding:12px; background:#fafaf8; border-radius:6px; border:1px solid var(--color-border); }
  .info-grid .meta-group p { font-size:12px; }

  .items-table { width:100%; border-collapse:collapse; margin-bottom:14px; }
  .items-table th { text-align:left; padding:6px 4px; border-bottom:1px solid var(--color-border); font-family:var(--font-display); font-size:13px; }
  .items-table td { padding:8px 4px; border-bottom:1px solid var(--color-border); font-size:12px; }
  .sku-col { color:var(--color-text-light); font-size:11px; font-family:monospace; }

  .total-section { width:260px; margin-left:auto; }
  .total-row { display:flex; justify-content:space-between; padding:3px 0; font-size:12px; }
  .total-row.final { border-top:2px solid var(--color-border); margin-top:6px; padding-top:6px; font-weight:700; font-size:15px; }

  .status-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; text-transform:capitalize; }

  .qr-section { display:flex; align-items:center; justify-content:center; gap:30px; margin-top:14px; padding:14px; border:1.5px solid var(--color-gold); border-radius:8px; background:#fafaf8; }
  .qr-box { text-align:center; }
  .qr-code-wrapper { position:relative; width:100px; height:100px; margin:0 auto; }
  .qr-code-wrapper img { width:100px; height:100px; border:2px solid var(--color-gold); border-radius:6px; }
  .qr-logo-overlay { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:30px; height:30px; background:#fff; border-radius:4px; display:flex; flex-direction:column; align-items:center; justify-content:center; border:1px solid var(--color-gold); line-height:1; padding:2px; }
  .qr-logo-overlay .qo-main { font-family:var(--font-display); font-size:9px; font-weight:700; color:var(--color-text); letter-spacing:0.5px; }
  .qr-logo-overlay .qo-sub { font-family:var(--font-display); font-size:5px; font-weight:400; color:var(--color-gold); letter-spacing:1px; }
  .qr-wa-overlay { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:26px; height:26px; background:#25D366; border-radius:50%; display:flex; align-items:center; justify-content:center; }
  .qr-wa-overlay svg { width:16px; height:16px; fill:#fff; }
  .qr-label { font-size:11px; font-weight:600; color:var(--color-text); margin-top:6px; }
  .qr-label-ar { font-family:var(--font-arabic); font-size:10px; color:var(--color-text-light); direction:rtl; }

  .return-policy { margin-top:14px; padding:10px 12px; background:#fffbeb; border:1px solid #f59e0b33; border-radius:6px; border-left:3px solid var(--color-gold); }
  .return-policy h4 { font-family:var(--font-display); font-size:14px; margin:0 0 4px; color:var(--color-text); }
  .return-policy .ar-title { font-family:var(--font-arabic); font-size:12px; direction:rtl; margin:0 0 6px; color:var(--color-text); font-weight:600; }
  .return-policy p { margin:2px 0; font-size:11px; color:var(--color-text-light); line-height:1.5; }
  .return-policy .ar-text { font-family:var(--font-arabic); direction:rtl; text-align:right; }

  .footer { margin-top:14px; text-align:center; font-size:11px; color:var(--color-text-light); border-top:1px solid var(--color-border); padding-top:10px; }
  .footer .ar-footer { font-family:var(--font-arabic); direction:rtl; margin-top:4px; }
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
    <p>${order.orderNumber || 'N/A'}</p>
  </div>
  <div class="meta-group">
    <h3>Date <span class="ar-label">التاريخ</span></h3>
    <p>${date}</p>
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
    <p style="font-size:11px;color:#666;font-weight:400">${customer.email || ''}</p>
    <p style="font-size:11px;color:#666;font-weight:400">${customer.phone || addr.phone || ''}</p>
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
  <div class="total-row"><span>Subtotal / المجموع الفرعي</span><span>${(order.subtotal || order.total || 0).toFixed(3)} KWD</span></div>
  <div class="total-row"><span>Delivery / التوصيل</span><span>${(order.shippingCost || 0).toFixed(3)} KWD</span></div>
  <div class="total-row final"><span>Total Paid / المبلغ المدفوع</span><span>${(order.total || 0).toFixed(3)} KWD</span></div>
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
  <h4>Return & Exchange Policy</h4>
  <div class="ar-title">سياسة الإرجاع والاستبدال</div>
  <p>Products may be returned or exchanged within <strong>14 days</strong> of delivery, provided they are <strong>unopened</strong> and in their <strong>original condition and packaging</strong>.</p>
  <p class="ar-text">يمكن إرجاع أو استبدال المنتجات خلال <strong>١٤ يومًا</strong> من التسليم، بشرط أن تكون <strong>غير مفتوحة</strong> وفي <strong>حالتها وتغليفها الأصلي</strong>.</p>
  <p style="margin-top:4px">Contact us via WhatsApp: <strong>+965 5068 3207</strong></p>
  <p class="ar-text">تواصلوا معنا عبر واتساب: <strong>+965 5068 3207</strong></p>
</div>

<div class="footer">
  <p>Thank you for shopping with ARTÉVA Maison.</p>
  <p class="ar-footer">شكراً لتسوقكم مع أرتيفا ميزون</p>
  <p>artevamaison@gmail.com • www.artevamaisonkw.com</p>
</div>

</body></html>`;
}

// Build shipping label HTML
function buildLabelHTML(order) {
  const addr = order.shippingAddress || {};
  const customer = order.user || {};
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page{size:A4;margin:20mm} *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:14pt}
    .h{text-align:center;border-bottom:3px solid #D4AF37;padding-bottom:10mm;margin-bottom:10mm}
    .h h1{font-size:28pt;letter-spacing:3px}
    .s{margin-bottom:10mm} .l{font-size:10pt;color:#888;text-transform:uppercase;margin-bottom:2mm} .v{font-size:16pt;font-weight:600}
    .addr{border:2px solid #D4AF37;padding:10mm;margin:10mm 0;background:#fafaf8} .addr .v{font-size:18pt;line-height:1.5}
  </style></head><body>
    <div class="h"><h1>ARTÉVA MAISON</h1><p style="font-size:14pt;color:#888">SHIPPING LABEL</p></div>
    <div class="s"><div class="l">Order Number</div><div class="v">${order.orderNumber}</div></div>
    <div class="s"><div class="l">From</div><div class="v">Artéva Maison<br>Kuwait</div></div>
    <div class="addr"><div class="l">Deliver To</div><div class="v">
      ${addr.fullName || customer.name || 'Customer'}<br>
      ${addr.phone || customer.phone || ''}<br><br>
      ${addr.street || addr.address || addr.addressLine1 || ''}<br>
      ${[addr.area, addr.block ? 'Block ' + addr.block : '', addr.city].filter(Boolean).join(', ')}<br>
      ${addr.governorate || addr.state || ''}<br>${addr.country || 'Kuwait'}
    </div></div>
  </body></html>`;
}

module.exports = { buildReceiptHTML, buildLabelHTML };
