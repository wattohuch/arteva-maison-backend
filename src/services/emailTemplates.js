/**
 * Email Templates Module
 * Handles HTML generation for all system emails with a unified "Artéva Maison" brown aesthetic.
 */

const path = require('path');

// Design Constants
const COLORS = {
    bg: '#f9f7f2', // Warm cream background
    containerBg: '#ffffff',
    text: '#4a3b2a', // Dark brown for text
    heading: '#2c241b', // Darker brown for headings
    accent: '#8b7355', // The "brown" accent color from main.css
    gold: '#c9a962', // Gold for highlights
    border: '#e6e1d6'
};

const FONTS = {
    primary: "'Helvetica Neue', Arial, sans-serif",
    serif: "'Playfair Display', Georgia, serif"
};

/**
 * Base email layout wrapper
 * @param {string} content - Inner HTML content
 * @param {string} title - Email title
 * @returns {string} - Complete HTML document
 */
/**
 * Base email layout wrapper
 * @param {string} content - Inner HTML content
 * @param {string} title - Email title
 * @returns {string} - Complete HTML document
 */
function getBaseLayout(content, title) {
    return `
    <!DOCTYPE html>
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>${title}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap');
            body { margin: 0; padding: 0; background-color: ${COLORS.bg}; font-family: ${FONTS.primary}; color: ${COLORS.text}; }
            .wrapper { width: 100%; table-layout: fixed; background-color: ${COLORS.bg}; padding-bottom: 40px; }
            .webkit { max-width: 600px; margin: 0 auto; background-color: ${COLORS.containerBg}; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid ${COLORS.border}; position: relative; overflow: hidden; }
            .header { text-align: center; padding: 0; border-bottom: 3px solid ${COLORS.accent}; position: relative; line-height: 0; }
            .header-img { width: 100%; height: auto; display: block; margin: 0; padding: 0; }
            .content { padding: 40px 40px; text-align: center; position: relative; }
            
            h1, h2, h3, h4, h5, h6 { font-family: ${FONTS.serif}; color: ${COLORS.heading}; font-weight: 600; margin: 0 auto 15px; }
            p { margin: 0 0 20px; line-height: 1.6; font-size: 16px; }
            .btn { 
                display: inline-block; 
                padding: 14px 30px; 
                background-color: ${COLORS.accent}; 
                color: #ffffff !important; 
                text-decoration: none; 
                font-weight: bold; 
                text-transform: uppercase; 
                letter-spacing: 1px; 
                font-size: 14px; 
                border-radius: 2px; 
                margin: 20px 0;
            }
            .footer { text-align: center; padding: 30px 20px; color: ${COLORS.accent}; font-size: 12px; font-family: ${FONTS.serif}; border-top: 1px solid ${COLORS.border}; background-color: ${COLORS.containerBg}; }
            .divider { height: 1px; background-color: ${COLORS.border}; margin: 30px auto; border: none; }
            
            /* Table Styles - Centered */
            table { width: 100%; border-collapse: collapse; margin: 0 auto; }
            th { text-align: center; padding: 15px 10px; border-bottom: 2px solid ${COLORS.accent}; color: ${COLORS.accent}; font-family: ${FONTS.serif}; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
            td { text-align: center; padding: 15px 10px; border-bottom: 1px solid ${COLORS.border}; vertical-align: top; }
            .total-row td { border-top: 2px solid ${COLORS.accent}; border-bottom: none; font-weight: bold; color: ${COLORS.heading}; font-size: 18px; }
            
            @media screen and (max-width: 600px) {
                .content { padding: 30px 20px; }
            }
        </style>
        <!--[if gte mso 9]>
        <xml>
        <o:OfficeDocumentSettings>
            <o:AllowPNG/>
            <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
        </xml>
        <![endif]-->
    </head>
    <body>
        <center class="wrapper">
            <div class="webkit">
                <!-- Header with Brown Image -->
                <div class="header">
                    <img src="cid:brown-header" alt="" class="header-img">
                </div>
                
                <!-- Main Content -->
                <div class="content">
                    ${content}
                </div>
                
                <!-- Footer -->
                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} ARTÉVA MAISON. All rights reserved.</p>
                    <p>Luxury Home Décor & Glassware</p>
                </div>
            </div>
        </center>
    </body>
    </html>
    `;
}

/**
 * Generate Welcome Email HTML
 * @param {Object} user 
 */
function getWelcomeEmailHtml(user) {
    const content = `
        <h1 style="text-align: center; font-size: 28px; margin-bottom: 30px;">Welcome to Artéva Maison</h1>
        
        <p>Dear ${user.name},</p>
        
        <p>We are delighted to welcome you to the world of Artéva Maison.</p>
        
        <p>Your account has been successfully created. You can now explore our exclusive collection of luxury home décor, handcrafted crystals, and exquisite glassware designed to elevate your living space.</p>
        
        <div style="text-align: center; margin: 40px 0;">
            <a href="https://www.artevamaisonkw.com/collections.html" class="btn">Discover Our Collection</a>
        </div>
        
        <p style="text-align: center; font-style: italic; color: ${COLORS.accent};">"Luxury in every detail."</p>
    `;
    return getBaseLayout(content, 'Welcome to Artéva Maison');
}

/**
 * Generate Order Confirmation Email HTML
 * @param {Object} order 
 * @param {Object} user 
 */
function getOrderConfirmationHtml(order, user) {
    const itemsHtml = order.items.map(item => `
        <tr>
            <td width="60%">
                <div style="font-weight: bold;">${item.name}</div>
            </td>
            <td width="15%" style="text-align: center;">${item.quantity}</td>
            <td width="25%" style="text-align: right;">${item.price.toFixed(3)} KWD</td>
        </tr>
    `).join('');

    const content = `
        <h1 style="text-align: center; font-size: 24px;">Order Confirmation</h1>
        
        <p>Dear ${user.name || 'Valued Customer'},</p>
        
        <p>Thank you for choosing Artéva Maison. We have received your order and are preparing it with the utmost care.</p>
        
        <div style="background-color: ${COLORS.bg}; padding: 15px; border: 1px solid ${COLORS.border}; margin: 20px 0; text-align: center;">
            <span style="color: ${COLORS.accent}; font-family: ${FONTS.serif}; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Order Number</span><br>
            <span style="font-size: 22px; font-weight: bold; color: ${COLORS.heading};">${order.orderNumber}</span>
        </div>
        
        <h3>Order Details</h3>
        <table cellpadding="0" cellspacing="0">
            <thead>
                <tr>
                    <th>Item</th>
                    <th style="text-align: center;">Qty</th>
                    <th style="text-align: right;">Price</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="2" style="text-align: right; padding-top: 20px; border-bottom: none;">Subtotal:</td>
                    <td style="text-align: right; padding-top: 20px; border-bottom: none;">${order.subtotal.toFixed(3)} KWD</td>
                </tr>
                <tr>
                    <td colspan="2" style="text-align: right; border-bottom: none;">Shipping:</td>
                    <td style="text-align: right; border-bottom: none;">${order.shippingCost > 0 ? order.shippingCost.toFixed(3) + ' KWD' : 'FREE'}</td>
                </tr>
                <tr class="total-row">
                    <td colspan="2" style="text-align: right;">Total:</td>
                    <td style="text-align: right;">${order.total.toFixed(3)} KWD</td>
                </tr>
            </tfoot>
        </table>
        
        <br>
        
        <div style="display: flex; flex-wrap: wrap; margin-top: 20px;">
            <div style="width: 100%;">
                <h3 style="font-size: 18px; border-bottom: 1px solid ${COLORS.border}; padding-bottom: 10px;">Shipping Address</h3>
                <p style="margin-top: 10px;">
                    ${order.shippingAddress.street}<br>
                    ${order.shippingAddress.city}${order.shippingAddress.state ? ', ' + order.shippingAddress.state : ''}<br>
                    ${order.shippingAddress.country}${order.shippingAddress.zipCode ? ' ' + order.shippingAddress.zipCode : ''}<br>
                    Tel: ${order.shippingAddress.phone}
                </p>
            </div>
        </div>
        
        <div style="text-align: center; margin-top: 30px;">
            <a href="https://www.artevamaisonkw.com/order-tracking.html?order=${order.orderNumber}" class="btn">Track Your Order</a>
        </div>
    `;
    return getBaseLayout(content, `Order Confirmed - ${order.orderNumber}`);
}

/**
 * Generate Order Status Update Email HTML
 * @param {Object} order 
 * @param {Object} user 
 * @param {string} newStatus 
 */
function getOrderStatusUpdateHtml(order, user, newStatus) {
    const statusMessages = {
        confirmed: { title: 'Order Confirmed', message: 'Your order has been confirmed and is being prepared.' },
        packed: { title: 'Order Packed', message: 'Your items have been carefully packed and are ready for shipping.' },
        processing: { title: 'Processing', message: 'Your order is currently being processed.' },
        handed_over: { title: 'Handed to Delivery', message: 'Your order has been handed over to our delivery partner.' },
        out_for_delivery: { title: 'Out for Delivery', message: 'Your order is on its way to you.' },
        delivered: { title: 'Delivered', message: 'Your order has been delivered. We hope you enjoy your purchase.' },
        cancelled: { title: 'Order Cancelled', message: 'Your order has been cancelled.' }
    };

    const statusInfo = statusMessages[newStatus] || { title: 'Status Update', message: `Your order status is now: ${newStatus}` };

    const content = `
        <h1 style="text-align: center; font-size: 24px;">${statusInfo.title}</h1>
        
        <p>Dear ${user.name || 'Valued Customer'},</p>
        
        <p>${statusInfo.message}</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <div style="display: inline-block; padding: 15px 30px; background-color: ${COLORS.bg}; border: 2px solid ${COLORS.accent}; color: ${COLORS.accent}; font-weight: bold; border-radius: 4px;">
                Order #${order.orderNumber}
            </div>
        </div>
        
        <div style="text-align: center; margin-top: 30px;">
            <a href="https://www.artevamaisonkw.com/order-tracking.html?order=${order.orderNumber}" class="btn">Track Order Status</a>
        </div>
    `;

    return getBaseLayout(content, `${statusInfo.title} - ${order.orderNumber}`);
}

/**
 * Generate Password Reset OTP Email HTML
 * @param {Object} user 
 * @param {string} otp 
 */
function getPasswordResetOTPHtml(user, otp) {
    const content = `
        <h1 style="text-align: center; font-size: 28px; margin-bottom: 30px;">Password Reset Request</h1>
        
        <p>Dear ${user.name},</p>
        
        <p>We received a request to reset your password for your Artéva Maison account.</p>
        
        <p>Please use the following OTP (One-Time Password) to verify your identity:</p>
        
        <div style="text-align: center; margin: 40px 0;">
            <div style="display: inline-block; padding: 20px 40px; background-color: ${COLORS.bg}; border: 3px solid ${COLORS.accent}; border-radius: 8px;">
                <div style="font-size: 14px; color: ${COLORS.accent}; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">Your OTP Code</div>
                <div style="font-size: 36px; font-weight: bold; color: ${COLORS.heading}; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</div>
            </div>
        </div>
        
        <p style="color: ${COLORS.accent}; font-weight: bold;">This OTP will expire in 10 minutes.</p>
        
        <p>If you did not request a password reset, please ignore this email. Your password will remain unchanged.</p>
        
        <div style="text-align: center; margin: 40px 0;">
            <a href="https://www.artevamaisonkw.com/forgot-password.html" class="btn">Reset Password</a>
        </div>
        
        <p style="text-align: center; font-size: 12px; color: ${COLORS.accent}; margin-top: 30px;">For security reasons, never share this OTP with anyone.</p>
    `;
    return getBaseLayout(content, 'Password Reset - ARTEVA Maison');
}

module.exports = {
    getWelcomeEmailHtml,
    getOrderConfirmationHtml,
    getOrderStatusUpdateHtml,
    getPasswordResetOTPHtml
};
