/**
 * ARTÉVA MAISON — Receipt & Label HTML Templates
 * PRODUCTION-HARDENED v6
 *
 * v6: Receipt HTML delegated to shared template (src/utils/sharedReceiptTemplate.js)
 *     for pixel-perfect consistency across all rendering paths.
 *     QR generation, logo loading, and label HTML remain in this file.
 */

const QRCode = require('qrcode');
const fsSync = require('fs');
const path = require('path');

// Import shared template utilities
const { buildReceiptHTMLFromData, escapeHTML, safeFixed } = require('./sharedReceiptTemplate');

// QR Code generation (base64 data URL with high error correction)
async function generateQR(text) {
  return await QRCode.toDataURL(text, {
    width: 400, margin: 1, errorCorrectionLevel: 'H',
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

/* Webfonts are OFF for printing.
 *
 * The template's font <link> points at fonts.googleapis.com, and a stylesheet
 * in <head> blocks both rendering and DOMContentLoaded until it resolves. On a
 * Pi with no internet the request does not fail fast — it hangs — so every
 * receipt stalled until the navigation timeout and then printed NOTHING. A
 * print station cannot depend on the internet being up.
 *
 * Rendering from locally installed fonts is instant and deterministic.
 * setup.sh installs Noto Sans Arabic, so Arabic still renders correctly; the
 * Latin faces fall back to the serif/sans stacks already declared in the
 * template. Set RECEIPT_WEB_FONTS=true to opt back in if this Pi has reliable
 * internet and you want exact typeface parity with the website.
 */
const USE_WEB_FONTS = process.env.RECEIPT_WEB_FONTS === 'true';

// Build receipt HTML — delegates to shared template
async function buildReceiptHTML(order) {
  if (!order) throw new Error('buildReceiptHTML: order is null');

  const receiptQR = await generateQR('https://www.artevamaisonkw.com/receipt.html?order=' + encodeURIComponent(order.orderNumber || '') + '&token=' + encodeURIComponent(order.trackingToken || ''));
  // Same reasoning as the backend template: paper outlives a config change.
  const contactNumber = (process.env.WHATSAPP_CONTACT_NUMBER
    || process.env.WHATSAPP_OWNER_PHONE
    || '96550683207').split(',')[0].replace(/\D/g, '');
  const whatsappQR = await generateQR(`https://wa.me/${contactNumber}`);
  const logoB64 = getLogoBase64();

  return buildReceiptHTMLFromData(order, {
    receiptQR, whatsappQR, logoBase64: logoB64, webFonts: USE_WEB_FONTS,
  });
}

// Build shipping label HTML — all user data escaped
function buildLabelHTML(order) {
  if (!order) return '<html><body><p>Error: No order data</p></body></html>';
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
    <div class="s"><div class="l">Order Number</div><div class="v">${escapeHTML(order.orderNumber)}</div></div>
    <div class="s"><div class="l">From</div><div class="v">Artéva Maison<br>Kuwait</div></div>
    <div class="addr"><div class="l">Deliver To</div><div class="v">
      ${escapeHTML(addr.fullName || customer.name || 'Customer')}<br>
      ${escapeHTML(addr.phone || customer.phone || '')}<br><br>
      ${escapeHTML(addr.street || addr.address || addr.addressLine1 || '')}<br>
      ${[addr.area, addr.block ? 'Block ' + addr.block : '', addr.city].filter(Boolean).map(escapeHTML).join(', ')}<br>
      ${escapeHTML(addr.governorate || addr.state || '')}<br>${escapeHTML(addr.country || 'Kuwait')}
    </div></div>
  </body></html>`;
}

module.exports = { buildReceiptHTML, buildLabelHTML, escapeHTML, safeFixed };
