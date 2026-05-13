/**
 * ARTÉVA MAISON - Pixel-Perfect A4 Receipt Template
 * Matches the reference design exactly
 */

function generateReceiptHTML(order) {
    // Format date
    const orderDate = new Date(order.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Format order status badge
    const statusMap = {
        'pending': { text: 'Processing', bg: '#fef3c7', color: '#92400e' },
        'confirmed': { text: 'Confirmed', bg: '#d1fae5', color: '#065f46' },
        'processing': { text: 'Processing', bg: '#fef3c7', color: '#92400e' },
        'shipped': { text: 'Shipped', bg: '#dbeafe', color: '#1e40af' },
        'delivered': { text: 'Delivered', bg: '#d1fae5', color: '#065f46' },
        'cancelled': { text: 'Cancelled', bg: '#fee2e2', color: '#991b1b' }
    };
    const orderStatusStyle = statusMap[order.orderStatus] || statusMap.processing;

    // Format payment status badge
    const paymentStatusMap = {
        'paid': { text: 'Paid', bg: '#d1fae5', color: '#065f46' },
        'pending': { text: 'Pending', bg: '#fef3c7', color: '#92400e' },
        'failed': { text: 'Failed', bg: '#fee2e2', color: '#991b1b' }
    };
    const paymentStatusStyle = paymentStatusMap[order.paymentStatus] || paymentStatusMap.pending;

    // Format payment method
    const paymentMethodMap = {
        'cod': 'ONLINE PAYMENT / دفع إلكتروني',
        'knet': 'KNET / كي نت',
        'card': 'CREDIT CARD / بطاقة ائتمان',
        'applepay': 'APPLE PAY / أبل باي',
        'myfatoorah': 'ONLINE PAYMENT / دفع إلكتروني'
    };
    const paymentMethodText = paymentMethodMap[order.paymentMethod] || order.paymentMethod.toUpperCase();

    // Customer details
    const customerName = order.user?.name || order.shippingAddress?.fullName || 'Guest';
    const customerEmail = order.user?.email || '';
    const customerPhone = order.shippingAddress?.phone || order.user?.phone || '';

    // Shipping address
    const addr = order.shippingAddress || {};
    const addressParts = [
        addr.street || addr.address,
        addr.city,
        addr.governorate || addr.state,
        addr.country
    ].filter(Boolean);
    const shippingAddressText = addressParts.join('<br>');

    // Generate items HTML
    const itemsHTML = order.items.map(item => {
        const sku = item.sku || '—';
        const nameAr = item.nameAr || 'مبخر كريستال';
        return `
            <tr>
                <td style="padding: 10px 6px; border-bottom: 1px solid #e6e1d6; font-size: 11px; color: #6b7280; font-family: monospace;">${sku}</td>
                <td style="padding: 10px 6px; border-bottom: 1px solid #e6e1d6;">
                    <div style="font-size: 13px; color: #2c241b; font-weight: 500; margin-bottom: 2px;">${item.name}</div>
                    <div style="font-size: 11px; color: #888; font-family: 'Noto Sans Arabic', Arial, sans-serif; direction: rtl; text-align: right;">${nameAr}</div>
                </td>
                <td style="padding: 10px 6px; border-bottom: 1px solid #e6e1d6; text-align: right; font-size: 13px; color: #2c241b;">${item.price.toFixed(3)} KWD</td>
                <td style="padding: 10px 6px; border-bottom: 1px solid #e6e1d6; text-align: center; font-size: 13px; color: #2c241b;">${item.quantity}</td>
                <td style="padding: 10px 6px; border-bottom: 1px solid #e6e1d6; text-align: right; font-size: 13px; font-weight: 600; color: #2c241b;">${(item.price * item.quantity).toFixed(3)} KWD</td>
            </tr>
        `;
    }).join('');

    // QR Code URL
    const qrCodeURL = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=10&data=${encodeURIComponent(`https://www.artevamaisonkw.com/receipt.html?order=${order.orderNumber}`)}`;

    // WhatsApp QR Code URL
    const whatsappQR = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=10&data=${encodeURIComponent('https://wa.me/96550683207')}`;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Receipt - ${order.orderNumber}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Montserrat:wght@300;400;500;600;700&family=Noto+Sans+Arabic:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        @page {
            size: A4 portrait;
            margin: 10mm;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Montserrat', sans-serif;
            background: #ffffff;
            color: #2c241b;
            font-size: 13px;
            line-height: 1.5;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .receipt-container {
            max-width: 210mm;
            margin: 0 auto;
            background: white;
            padding: 0;
        }

        /* Header */
        .header {
            text-align: center;
            padding-bottom: 12px;
            margin-bottom: 16px;
            border-bottom: 1.5px solid #D4AF37;
        }

        .brand-name {
            font-family: 'Cormorant Garamond', serif;
            font-size: 32px;
            font-weight: 600;
            letter-spacing: 4px;
            color: #2c241b;
            margin-bottom: 4px;
        }

        .receipt-title {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: #6b7280;
            font-weight: 500;
            margin-bottom: 2px;
        }

        .receipt-title-ar {
            font-family: 'Noto Sans Arabic', Arial, sans-serif;
            font-size: 11px;
            color: #9ca3af;
            direction: rtl;
        }

        /* Top Summary Row */
        .summary-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 16px;
            padding: 12px 0;
            border-bottom: 1px solid #e6e1d6;
        }

        .summary-item {
            flex: 1;
        }

        .summary-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #9ca3af;
            margin-bottom: 4px;
            font-weight: 500;
        }

        .summary-label-ar {
            font-family: 'Noto Sans Arabic', Arial, sans-serif;
            font-size: 9px;
            color: #d1d5db;
            direction: rtl;
            display: block;
        }

        .summary-value {
            font-size: 14px;
            font-weight: 600;
            color: #2c241b;
        }

        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: capitalize;
        }

        /* Info Sections */
        .info-section {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 16px;
            padding: 14px;
            background: #fafaf8;
            border: 1px solid #e6e1d6;
            border-radius: 6px;
        }

        .info-block {
            min-height: 80px;
        }

        .info-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #9ca3af;
            margin-bottom: 6px;
            font-weight: 600;
        }

        .info-label-ar {
            font-family: 'Noto Sans Arabic', Arial, sans-serif;
            font-size: 9px;
            color: #d1d5db;
            direction: rtl;
            display: block;
            margin-top: 2px;
        }

        .info-content {
            font-size: 12px;
            color: #2c241b;
            line-height: 1.6;
        }

        .info-content strong {
            font-weight: 600;
            display: block;
            margin-bottom: 2px;
        }

        /* Payment Section */
        .payment-section {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 16px;
            padding: 14px;
            background: #fafaf8;
            border: 1px solid #e6e1d6;
            border-radius: 6px;
        }

        /* Products Table */
        .products-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
        }

        .products-table thead th {
            background: #f5f2ec;
            padding: 8px 6px;
            text-align: left;
            font-size: 11px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #e6e1d6;
        }

        .products-table thead th:nth-child(3),
        .products-table thead th:nth-child(4),
        .products-table thead th:nth-child(5) {
            text-align: right;
        }

        .products-table thead th:nth-child(4) {
            text-align: center;
        }

        /* Totals Section */
        .totals-section {
            width: 280px;
            margin-left: auto;
            margin-bottom: 20px;
        }

        .total-row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            font-size: 13px;
            color: #2c241b;
        }

        .total-row.final {
            border-top: 2px solid #D4AF37;
            margin-top: 8px;
            padding-top: 10px;
            font-size: 16px;
            font-weight: 700;
        }

        /* QR Section */
        .qr-section {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 40px;
            margin: 20px 0;
            padding: 16px;
            background: #fafaf8;
            border: 1.5px solid #D4AF37;
            border-radius: 8px;
        }

        .qr-box {
            text-align: center;
        }

        .qr-box img {
            width: 100px;
            height: 100px;
            border: 2px solid #D4AF37;
            border-radius: 6px;
            padding: 4px;
            background: white;
        }

        .qr-label {
            font-size: 11px;
            font-weight: 600;
            color: #2c241b;
            margin-top: 6px;
        }

        .qr-label-ar {
            font-family: 'Noto Sans Arabic', Arial, sans-serif;
            font-size: 10px;
            color: #6b7280;
            direction: rtl;
            margin-top: 2px;
        }

        /* Return Policy */
        .return-policy {
            margin: 20px 0;
            padding: 14px;
            background: #fffbeb;
            border: 1px solid #fbbf2433;
            border-left: 3px solid #D4AF37;
            border-radius: 6px;
        }

        .policy-title {
            font-family: 'Cormorant Garamond', serif;
            font-size: 16px;
            font-weight: 600;
            color: #2c241b;
            margin-bottom: 4px;
        }

        .policy-title-ar {
            font-family: 'Noto Sans Arabic', Arial, sans-serif;
            font-size: 14px;
            font-weight: 600;
            color: #2c241b;
            direction: rtl;
            margin-bottom: 8px;
        }

        .policy-text {
            font-size: 11px;
            color: #6b7280;
            line-height: 1.6;
            margin-bottom: 4px;
        }

        .policy-text-ar {
            font-family: 'Noto Sans Arabic', Arial, sans-serif;
            font-size: 11px;
            color: #6b7280;
            direction: rtl;
            text-align: right;
            line-height: 1.8;
        }

        .whatsapp-contact {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #fbbf2433;
            font-size: 11px;
            color: #2c241b;
        }

        .whatsapp-contact strong {
            font-weight: 600;
        }

        /* Footer */
        .footer {
            text-align: center;
            padding-top: 16px;
            margin-top: 20px;
            border-top: 1px solid #e6e1d6;
            font-size: 11px;
            color: #6b7280;
        }

        .footer-thank-you {
            font-size: 13px;
            font-weight: 500;
            color: #2c241b;
            margin-bottom: 4px;
        }

        .footer-thank-you-ar {
            font-family: 'Noto Sans Arabic', Arial, sans-serif;
            font-size: 12px;
            color: #6b7280;
            direction: rtl;
            margin-bottom: 6px;
        }

        .footer-contact {
            font-size: 10px;
            color: #9ca3af;
        }

        /* Print Styles */
        @media print {
            body {
                padding: 0;
                margin: 0;
            }

            .receipt-container {
                padding: 0;
            }

            .info-section,
            .payment-section,
            .return-policy,
            .qr-section {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .status-badge {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }
    </style>
</head>
<body>
    <div class="receipt-container">
        <!-- Header -->
        <div class="header">
            <div class="brand-name">ARTÉVA MAISON</div>
            <div class="receipt-title">ORDER RECEIPT</div>
            <div class="receipt-title-ar">إيصال الطلب</div>
        </div>

        <!-- Summary Row -->
        <div class="summary-row">
            <div class="summary-item">
                <div class="summary-label">
                    ORDER NUMBER
                    <span class="summary-label-ar">رقم الطلب</span>
                </div>
                <div class="summary-value">${order.orderNumber}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">
                    DATE
                    <span class="summary-label-ar">التاريخ</span>
                </div>
                <div class="summary-value">${orderDate}</div>
            </div>
            <div class="summary-item" style="text-align: right;">
                <div class="summary-label">
                    ORDER STATUS
                    <span class="summary-label-ar">حالة الطلب</span>
                </div>
                <div class="summary-value">
                    <span class="status-badge" style="background: ${orderStatusStyle.bg}; color: ${orderStatusStyle.color};">${orderStatusStyle.text}</span>
                </div>
            </div>
        </div>

        <!-- Customer & Shipping -->
        <div class="info-section">
            <div class="info-block">
                <div class="info-label">
                    CUSTOMER DETAILS
                    <span class="info-label-ar">بيانات العميل</span>
                </div>
                <div class="info-content">
                    <strong>${customerName}</strong>
                    ${customerEmail}<br>
                    ${customerPhone}
                </div>
            </div>
            <div class="info-block">
                <div class="info-label">
                    SHIPPING ADDRESS
                    <span class="info-label-ar">عنوان الشحن</span>
                </div>
                <div class="info-content">
                    ${shippingAddressText}
                </div>
            </div>
        </div>

        <!-- Payment Info -->
        <div class="payment-section">
            <div class="info-block">
                <div class="info-label">
                    PAYMENT METHOD
                    <span class="info-label-ar">طريقة الدفع</span>
                </div>
                <div class="info-content">
                    <strong>${paymentMethodText}</strong>
                </div>
            </div>
            <div class="info-block">
                <div class="info-label">
                    PAYMENT STATUS
                    <span class="info-label-ar">حالة الدفع</span>
                </div>
                <div class="info-content">
                    <span class="status-badge" style="background: ${paymentStatusStyle.bg}; color: ${paymentStatusStyle.color};">${paymentStatusStyle.text}</span>
                </div>
            </div>
        </div>

        <!-- Products Table -->
        <table class="products-table">
            <thead>
                <tr>
                    <th style="width: 10%;">SKU / رقم</th>
                    <th style="width: 40%;">Item / المنتج</th>
                    <th style="width: 18%;">Unit Price / السعر</th>
                    <th style="width: 10%;">Qty / الكمية</th>
                    <th style="width: 22%;">Total / المجموع</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHTML}
            </tbody>
        </table>

        <!-- Totals -->
        <div class="totals-section">
            <div class="total-row">
                <span>Subtotal / المجموع الجزئي</span>
                <span>${order.subtotal.toFixed(3)} KWD</span>
            </div>
            <div class="total-row">
                <span>Delivery / التوصيل</span>
                <span>${(order.shippingCost || 0).toFixed(3)} KWD</span>
            </div>
            <div class="total-row final">
                <span>Total Paid / المبلغ المدفوع</span>
                <span>${order.total.toFixed(3)} KWD</span>
            </div>
        </div>

        <!-- QR Codes -->
        <div class="qr-section">
            <div class="qr-box">
                <img src="${qrCodeURL}" alt="Receipt QR Code">
                <div class="qr-label">Scan for Digital Receipt</div>
                <div class="qr-label-ar">امسح للإيصال الرقمي</div>
            </div>
        </div>

        <!-- Return Policy -->
        <div class="return-policy">
            <div class="policy-title">Return & Exchange Policy</div>
            <div class="policy-title-ar">سياسة الإرجاع والاستبدال</div>
            <p class="policy-text">
                Products may be returned or exchanged within <strong>14 days</strong> of delivery, provided they are <strong>unopened</strong> and in their <strong>original condition and packaging</strong>.
            </p>
            <p class="policy-text-ar">
                يمكن إرجاع أو استبدال المنتجات خلال <strong>14 يوماً</strong> من التسليم، بشرط أن تكون <strong>غير مفتوحة</strong> وفي <strong>حالتها وتغليفها الأصلي</strong>.
            </p>
            <div class="whatsapp-contact">
                <p class="policy-text">Contact us via WhatsApp: <strong>+965 5068 3207</strong></p>
                <p class="policy-text-ar">تواصلوا معنا عبر واتساب: <strong>٣٢٠٧ ٥٠٦٨ ٩٦٥+</strong></p>
            </div>
        </div>

        <!-- Footer -->
        <div class="footer">
            <div class="footer-thank-you">Thank you for shopping with ARTÉVA Maison.</div>
            <div class="footer-thank-you-ar">شكراً لتسوقكم من أرتيفا ميزون</div>
            <div class="footer-contact">artevamaison@gmail.com • www.artevamaisonkw.com</div>
        </div>
    </div>
</body>
</html>
    `.trim();
}

module.exports = { generateReceiptHTML };
