const baseUrl = 'https://arteva-maison-backend-gy1x.onrender.com/api';

async function createOrder() {
    try {
        console.log('1. Registering dummy user...');
        const email = `testfarwaniya${Date.now()}@example.com`;
        const regRes = await fetch(`${baseUrl}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Test Farwaniya',
                email: email,
                password: 'password123',
                phone: '96512345678'
            })
        });
        const regData = await regRes.json();
        const token = regData.data.token;
        console.log('User registered with token');

        console.log('2. Fetching products...');
        const prodRes = await fetch(`${baseUrl}/products`);
        const prodData = await prodRes.json();
        const product = prodData.data[0];
        console.log(`Selected product: ${product.name}`);

        console.log('3. Adding to cart...');
        await fetch(`${baseUrl}/cart`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                productId: product._id,
                quantity: 1
            })
        });
        console.log('Added to cart');

        console.log('4. Placing COD Order for Farwaniya...');
        const codRes = await fetch(`${baseUrl}/payments/cod`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                shippingAddress: {
                    street: 'Block 1, Street 6, House 2',
                    city: 'Rehab',
                    phone: '96512345678',
                    label: 'Home',
                    coordinates: {
                        lat: 29.281096,
                        lng: 47.941679
                    }
                }
            })
        });
        const codData = await codRes.json();

        if (codData.success) {
            console.log('✅ Order created successfully for Farwaniya!');
        } else {
            console.log('❌ Failed to create order:', codData);
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

createOrder();
