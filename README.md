# ARTEVA Maison Backend

Node.js/Express backend API for ARTEVA Maison e-commerce platform.

## Features

- RESTful API with Express.js
- MongoDB database with Mongoose ODM
- JWT authentication
- Real-time updates with Socket.IO
- Email notifications (Gmail SMTP)
- File uploads for product images
- Automatic database backups
- Admin dashboard API
- Driver management and tracking

## Setup

### Prerequisites

- Node.js 16+ and npm
- MongoDB Atlas account (or local MongoDB)
- Gmail account for email notifications

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file in the root directory:

```env
# Server
PORT=5000
NODE_ENV=production

# Database
MONGODB_URI=your_mongodb_connection_string

# Frontend
FRONTEND_URL=https://www.artevamaisonkw.com

# Security
JWT_SECRET=your_random_64_character_secret
JWT_EXPIRES_IN=7d

# Email (Gmail SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=ARTEVA Maison <your_email@gmail.com>

# Payment (Optional)
STRIPE_SECRET_KEY=disabled
STRIPE_PUBLISHABLE_KEY=disabled
STRIPE_WEBHOOK_SECRET=disabled
```

### Running

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/verify-otp` - Verify OTP
- `POST /api/auth/reset-password` - Reset password

### Products
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get product by ID
- `POST /api/products` - Create product (admin)
- `PUT /api/products/:id` - Update product (admin)
- `DELETE /api/products/:id` - Delete product (admin)

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders` - Get user orders
- `GET /api/orders/:id` - Get order details

### Admin
- `GET /api/admin/stats` - Dashboard statistics
- `GET /api/admin/orders` - Get all orders
- `PUT /api/admin/orders/:id/status` - Update order status

### Delivery
- `GET /api/delivery/track/:orderNumber` - Track order (public)
- `POST /api/delivery/pilots` - Create delivery pilot (admin)
- `PUT /api/delivery/location/:orderId` - Update driver location

## Deployment

### Render (Recommended)

1. Connect your GitHub repository
2. Set environment variables in Render dashboard
3. Deploy automatically on push to main branch

### Manual Deployment

```bash
npm install --production
npm start
```

## Database Backups

Automatic backups are configured to run:
- Every 6 hours during active usage
- Daily at 2 AM Kuwait time
- Manual backup: `POST /api/admin/backup`

Backups are stored in `backups/` directory.

## Project Structure

```
arteva-maison-backend/
├── src/
│   ├── config/       # Database configuration
│   ├── controllers/  # Route controllers
│   ├── middleware/   # Auth, error handling
│   ├── models/       # Mongoose models
│   ├── routes/       # API routes
│   └── server.js     # Main server file
├── backups/          # Database backups
├── package.json
└── README.md
```

## Security

- JWT tokens for authentication
- Password hashing with bcrypt
- CORS configuration for frontend domain
- Helmet.js for security headers
- Input validation and sanitization

## License

© 2026 ARTÉVA Maison. All rights reserved.
