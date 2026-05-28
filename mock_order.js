require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./src/models/Order');
const User = require('./src/models/User');
const Product = require('./src/models/Product');
const whatsapp = require('./src/services/whatsappService');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to DB');

    // Get any product
    const product = await Product.findOne({});
    if (!product) {
      console.log('No products found');
      process.exit(1);
    }

    // See if user exists with phone number, else get any admin user for mapping
    let user = await User.findOne({ phone: { $regex: '97295917' } });
    if (!user) {
      user = await User.findOne({ role: 'admin' });
    }

    const orderNumber = 'ART-000037';

    const mockOrder = new Order({
      user: user._id,
      orderNumber,
      orderStatus: 'confirmed',
      paymentStatus: 'paid',
      paymentMethod: 'knet',
      items: [{
        product: product._id,
        name: product.name,
        nameAr: product.nameAr || product.name,
        sku: product.sku || 'MOCK-001',
        price: product.price || 10,
        quantity: 1
      }],
      shippingAddress: {
        street: 'Mock Street',
        city: 'Kuwait City',
        country: 'Kuwait',
        phone: '97295917',
        fullName: 'Test Customer'
      },
      subtotal: product.price || 10,
      shippingCost: 2,
      total: (product.price || 10) + 2
    });

    await mockOrder.save();
    console.log(`Created mock order ${orderNumber} for 97295917`);

    try {
       await whatsapp.notifyOwnerNewOrder(mockOrder, { name: 'Test Customer', phone: '97295917' });
       console.log('Notified owner');
       await whatsapp.notifyCustomerNewOrder(mockOrder, { name: 'Test Customer', phone: '97295917' });
       console.log('Notified customer');
    } catch(err) {
       console.log('WhatsApp error', err.message);
    }

    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
