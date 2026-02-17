# Admin Access Issue - 403 Not Authorized

## Problem
Getting "Not authorized as admin" (403) errors when trying to access admin dashboard features.

## Root Cause
You're logged in with a regular user account, not an admin account. The admin middleware checks if `user.role === 'admin'` and rejects requests if not.

## Solution Options

### Option 1: Login with Existing Admin Account ✅ RECOMMENDED
There's already an admin account in the database:
- **Email:** `admin@arteva.com`
- **Password:** `admin123`
- **Role:** admin
- **Created:** 2/17/2026

**Steps:**
1. Logout from current account (click logout button)
2. Login with:
   - Email: `admin@arteva.com`
   - Password: `admin123`
3. Access admin dashboard at `/admin.html`

**⚠️ IMPORTANT:** Change this password in production!

### Option 2: Make Your Current Account Admin

If you want to make your current logged-in account an admin:

1. **List all users to find your email:**
   ```bash
   cd arteva-maison-backend
   node list-users.js
   ```

2. **Make your account admin:**
   ```bash
   node make-admin.js your-email@example.com
   ```

3. **Logout and login again** (to refresh the JWT token with new role)

### Option 3: Create New Admin Account via Seed Script

The seed script (`src/seed-user.js`) can create admin accounts. Check if it has the admin credentials.

## How Admin Authorization Works

1. **Login** → Server generates JWT token with user data including `role`
2. **API Request** → Frontend sends JWT in `Authorization: Bearer <token>` header
3. **Middleware Chain:**
   - `protect` middleware: Verifies JWT, loads user from database
   - `admin` middleware: Checks if `req.user.role === 'admin'`
4. **If not admin** → Returns 403 error

## Important Notes

- **JWT tokens don't auto-update:** If you change a user's role in the database, they must logout and login again to get a new token with the updated role
- **Frontend check:** The admin dashboard (`admin.js`) also checks `user.role !== 'admin'` on page load and redirects to account page if not admin
- **Security:** Never expose admin credentials in frontend code or public repositories

## Testing Admin Access

After logging in as admin, you should be able to:
- View dashboard stats (`GET /api/admin/stats`)
- Manage products (`/api/admin/products`)
- Manage orders (`/api/admin/orders`)
- Manage users (`/api/admin/users`)
- Send marketing emails (`POST /api/admin/send-email`)

## Scripts Available

- `node list-users.js` - List all users with their roles
- `node make-admin.js <email>` - Promote a user to admin role
