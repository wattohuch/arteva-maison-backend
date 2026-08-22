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
    'https://www.artevamaisonkw.com/receipt.html?order=' + encodeURIComponent(order.orderNumber || '') +
    '&token=' + encodeURIComponent(order.trackingToken || '')
  );
  /* The QR points at whichever number the shop is actually reachable on.
   * Hardcoding it meant a printed receipt kept sending customers to the old
   * line after the business moved to the WhatsApp API number — and paper,
   * unlike a web page, cannot be corrected once it is in someone's bag. */
  const contactNumber = (process.env.WHATSAPP_CONTACT_NUMBER
    || process.env.WHATSAPP_OWNER_PHONE
    || '96550683207').split(',')[0].replace(/\D/g, '');
  const whatsappQR = await generateQR(`https://wa.me/${contactNumber}`);

  return buildReceiptHTMLFromData(order, {
    receiptQR,
    whatsappQR,
    logoBase64: null // Backend doesn't have the logo file; text fallback is used
  });
}

module.exports = { generateReceiptHTML };
