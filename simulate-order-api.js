/**
 * Simulate Order via API
 * Creates a test order through the backend API
 */

const axios = require('axios');

const API_URL = 'https://arteva-maison-backend.onrender.com';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OTQwZTY4NjcxN2EzOGJjNjczZTdmMCIsImlhdCI6MTc3ODM0NzA4NywiZXhwIjoxOTk5MjUwMjg3fQ.LT8NzouiJGLOb9SSQcYlmEPwcckyJRgNTl2aJvBY5yA';

async function simulateOrder() {
    try {
        console.log('🔍 Fetching products...');
        
        // Get products
        const productsRes = await axios.get(`${API_URL}/api/products`, {
            timeout: 30000
        });
        
        if (!productsRes.data.success || !productsRes.data.data || productsRes.data.data.length === 0) {
            console.error('❌ No products found');
            process.exit(1);
        }
        
        const products = productsRes.data.data.slice(0, 2); // Take first 2 products
        console.log(`✅ Found ${products.length} products`);
        
        // Create order payload
        const orderData = {
            items: products.map(p => ({
                product: p._id,
                quantity: 1,
                price: p.price
            })),
            shippingAddress: {
                fullName: 'Test Customer',
                phone: '+96550000000',
                street: '123 Test Street, Block 5',
                city: 'Kuwait City',
                governorate: 'Capital',
                country: 'Kuwait',
                postalCode: '12345'
            },
            paymentMethod: 'knet',
            notes: 'Test order for print station'
        };
        
        console.log('📝 Creating order...');
        
        // Create order
        const orderRes = await axios.post(
            `${API_URL}/api/orders`,
            orderData,
            {
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );
        
        if (!orderRes.data.success) {
            console.error('❌ Failed to create order:', orderRes.data.message);
            process.exit(1);
        }
        
        const order = orderRes.data.data;
        
        console.log('✅ Order created successfully!');
        console.log('');
        console.log('📋 ORDER DETAILS:');
        console.log('   Order Number:', order.orderNumber);
        console.log('   Order ID:', order._id);
        console.log('   Total:', `${order.total.toFixed(3)} KWD`);
        console.log('   Items:', order.items.length);
        console.log('');
        console.log('🖨️  The print station should automatically detect and print this order!');
        console.log('');
        console.log('📍 Check print station logs:');
        console.log('   sudo journalctl -u print-station -f');
        console.log('');
        console.log('🌐 View receipt at:');
        console.log(`   https://arteva-maison-backend.onrender.com/api/admin/receipt/${order._id}`);
        console.log('');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

simulateOrder();
