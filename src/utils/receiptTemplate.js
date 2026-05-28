/**
 * ARTÉVA MAISON — Receipt Template (Backend)
 * Thin wrapper around the shared receipt template.
 * Uses the SAME HTML as the Raspberry Pi print agent.
 */

const QRCode = require('qrcode');
const { buildReceiptHTMLFromData } = require('../../raspi-print-station/sharedReceiptTemplate');

// QR Code generation (base64 data URL)
async function generateQR(text) {
  return await QRCode.toDataURL(text, {
    width: 400, margin: 1, errorCorrectionLevel: 'H',
    color: { dark: '#2c241b', light: '#ffffff' }
  });
}

/**
 * Generate receipt HTML for an order.
 * Produces IDENTICAL output to the Raspberry Pi print agent.
 */
async function generateReceiptHTML(order) {
  const receiptQR = await generateQR(
    'https://www.artevamaisonkw.com/receipt.html?order=' + encodeURIComponent(order.orderNumber || '')
  );
  const whatsappQR = await generateQR('https://wa.me/96550683207');

  return buildReceiptHTMLFromData(order, {
    receiptQR,
    whatsappQR,
    logoBase64: null // Backend doesn't have the logo file; text fallback is used
  });
}

module.exports = { generateReceiptHTML };
