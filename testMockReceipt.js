const { buildReceiptHTMLFromData } = require('./raspi-print-station/sharedReceiptTemplate');
const fs = require('fs');

const mockOrder = {
  orderNumber: 'Y3PYX201',
  createdAt: new Date(),
  orderStatus: 'confirmed',
  paymentStatus: 'paid',
  paymentMethod: 'knet',
  subtotal: 15.000,
  shippingCost: 2.000,
  total: 14.500,
  discount: 2.500,
  promoCode: {
    code: 'SUMMER',
    totalDiscount: 2.500,
    discounts: [
      {
        product: 'prod1',
        discountAmount: 1.500
      },
      {
        product: 'prod2',
        discountAmount: 1.000
      }
    ]
  },
  user: { name: 'Ali Al-Kuwaiti', email: 'ali@example.com', phone: '96512345678' },
  shippingAddress: {
    street: 'Street 5',
    area: 'Salmiya',
    block: '4',
    city: 'Salmiya',
    country: 'Kuwait',
    phone: '96512345678'
  },
  items: [
    {
      _id: 'prod1',
      product: 'prod1',
      sku: 'AM-CANDLE-01',
      name: 'Signature Scented Candle',
      price: 10.000,
      quantity: 1
    },
    {
      _id: 'prod2',
      product: 'prod2',
      sku: 'AM-DIFF-01',
      name: 'Reed Diffuser',
      price: 5.000,
      quantity: 1
    }
  ]
};

const html = buildReceiptHTMLFromData(mockOrder, {
  receiptQR: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  whatsappQR: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
});

fs.writeFileSync('mock_receipt.html', html);
console.log('Saved mock_receipt.html');
