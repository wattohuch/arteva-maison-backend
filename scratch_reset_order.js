require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./src/models/Order');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to DB');
    const order = await Order.findOneAndUpdate(
      { orderNumber: 'ART-000029' },
      { $unset: { printedAt: 1 } },
      { new: true }
    );
    if (order) {
      console.log('Successfully reset printedAt for ART-000029! The Pi will print it in < 30 seconds.');
    } else {
      console.log('Order ART-000029 not found.');
    }
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
