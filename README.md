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

## WhatsApp Cloud API

Order notifications, delivery receipts, inbound customer messages and an AI
assistant, over Meta's official WhatsApp Cloud API.

**Setup:** [docs/WHATSAPP_SETUP.md](docs/WHATSAPP_SETUP.md) — credentials,
webhook, and message templates, step by step.
**Raspberry Pi:** [docs/RASPBERRY_PI_DEPLOYMENT.md](docs/RASPBERRY_PI_DEPLOYMENT.md).

### What is implemented

| | |
|---|---|
| Outbound | text, template, image, document, audio, video, sticker, location, contacts, interactive buttons, read receipts |
| Inbound | messages of every type, delivery/read/failure receipts, template status changes |
| Security | `X-Hub-Signature-256` verification, fails closed in production, admin-only send routes, per-route rate limits |
| Reliability | duplicate-event protection, exponential backoff, permanent-vs-transient error classification |
| Storage | full message lifecycle (`queued → sent → delivered → read` / `failed`), contacts, conversations; media to Cloudinary, never the local disk |

### Endpoints

```
GET    /api/whatsapp/health                  configuration + connectivity (public)
POST   /api/whatsapp/messages/text           free-form text
POST   /api/whatsapp/messages/template       approved template
POST   /api/whatsapp/messages/media          image / document / audio / video
POST   /api/whatsapp/messages/media/upload   upload, returns a media id
POST   /api/whatsapp/messages/location       location pin
POST   /api/whatsapp/messages/interactive    reply buttons or list
POST   /api/whatsapp/messages/:id/read       mark inbound read
GET    /api/whatsapp/conversations           conversation list
GET    /api/whatsapp/conversations/:waId     one conversation
GET    /api/whatsapp/messages/:id            one message and its status

GET    /api/meta/whatsapp                    Meta verification handshake
POST   /api/meta/whatsapp                    Meta webhook (signature verified)
```

> `/api/whatsapp/webhook` is **retired** and answers `410 Gone`. It ran without
> signature verification while being able to trigger outbound sends. Point Meta
> at `/api/meta/whatsapp`.

### Health

```bash
curl https://your-domain.com/api/whatsapp/health
# {"status":"healthy","whatsapp":"configured","database":"connected","missing":[]}
```

Add `?probe=1` to also make a live call to Meta. The response never contains a
credential.

### Tests

```bash
npm run test:whatsapp     # 64 assertions, no network or credentials needed
```

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
