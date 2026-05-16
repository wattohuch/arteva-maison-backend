require('dotenv').config();
const whatsapp = require('./src/services/whatsappService');

// Mock order data
const mockOrder = {
    orderNumber: 'TEST-001',
    total: 15.50,
    currency: 'KWD',
    paymentMethod: 'knet',
    orderStatus: 'confirmed',
    items: [
        { name: 'Test Product', nameAr: 'منتج تجريبي', quantity: 1, price: 15.50 }
    ],
    shippingAddress: {
        street: 'Test Street 123',
        city: 'Kuwait City',
        country: 'Kuwait'
    }
};

// Mock user data - using your display phone as the customer for testing
const mockUser = {
    name: 'Test Customer',
    phone: '96550683207', 
    email: 'test@artevamaison.com',
    language: 'en'
};

console.log('🚀 Starting Green API test...');
console.log('This will send to Owner 1, Owner 2, and the Customer (96550683207)');
console.log('There should be a 10-second gap between each message.');
console.log('--------------------------------------------------');

// Mock DB call so it doesn't time out waiting for MongoDB
whatsapp.getOwnerPhones = async () => {
    return ['96565611566', '96551008567'];
};

// Fire the notifications!
whatsapp.sendAllOrderNotifications(mockOrder, mockUser);
