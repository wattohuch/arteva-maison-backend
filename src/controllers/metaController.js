/**
 * ARTEVA Maison — Meta integrations
 *
 *   GET  /api/meta/catalog.xml   product feed for Commerce Manager
 *   GET  /api/meta/whatsapp      webhook verification handshake
 *   POST /api/meta/whatsapp      inbound messages and delivery receipts
 *   GET  /api/meta/status        what is configured (admin only)
 */

const crypto = require('crypto');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/error');

const FRONTEND = (process.env.FRONTEND_URL || 'https://www.artevamaisonkw.com').replace(/\/$/, '');

/** XML has five characters that cannot appear literally in text content. */
function xmlEscape(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Product feed in Google/Meta RSS 2.0 format.
 *
 * Commerce Manager fetches this URL on a schedule rather than being pushed to,
 * so the catalogue on Instagram tracks the database without anyone exporting a
 * spreadsheet. Availability and price come from the same fields the storefront
 * reads, which is what stops the shop from advertising something that is out of
 * stock or priced differently on the site.
 *
 * @route GET /api/meta/catalog.xml
 * @access Public — Meta's crawler is unauthenticated, and everything in here is
 *         already public on the storefront.
 */
const getCatalogFeed = asyncHandler(async (req, res) => {
    const products = await Product.find({ isActive: true })
        .populate('category', 'name')
        .lean();

    const entries = products.map(p => {
        const image = p.images?.length
            ? (p.images.find(i => i.isPrimary) || p.images[0]).url
            : '';

        // Meta rejects an item with no image or no price, so skip rather than
        // ship an entry that will fail validation and flag the whole feed.
        if (!image || !p.price) return '';

        const extraImages = (p.images || [])
            .filter(i => i.url && i.url !== image)
            .slice(0, 10)
            .map(i => `      <g:additional_image_link>${xmlEscape(i.url)}</g:additional_image_link>`)
            .join('\n');

        const available = p.isComingSoon ? 'preorder'
            : (p.stock > 0 ? 'in stock' : 'out of stock');

        const description = p.description || p.name;

        return `    <item>
      <g:id>${xmlEscape(p._id)}</g:id>
      <g:title>${xmlEscape(p.name)}</g:title>
      <g:description>${xmlEscape(description)}</g:description>
      <g:link>${FRONTEND}/product/${xmlEscape(p.slug || p._id)}</g:link>
      <g:image_link>${xmlEscape(image)}</g:image_link>
${extraImages}
      <g:availability>${available}</g:availability>
      <g:condition>new</g:condition>
      <g:price>${Number(p.price).toFixed(3)} ${xmlEscape(p.currency || 'KWD')}</g:price>${
        p.compareAtPrice && p.compareAtPrice > p.price
            ? `\n      <g:sale_price>${Number(p.price).toFixed(3)} ${xmlEscape(p.currency || 'KWD')}</g:sale_price>`
            : ''
      }
      <g:brand>ARTÉVA Maison</g:brand>
${p.sku ? `      <g:mpn>${xmlEscape(p.sku)}</g:mpn>\n` : ''}${p.category?.name ? `      <g:product_type>${xmlEscape(p.category.name)}</g:product_type>\n` : ''}    </item>`;
    }).filter(Boolean);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>ARTÉVA Maison</title>
    <link>${FRONTEND}</link>
    <description>Luxury home décor, handcrafted glassware and artisan collections.</description>
${entries.join('\n')}
  </channel>
</rss>`;

    res.set('Content-Type', 'application/xml; charset=utf-8');
    // Meta re-fetches on a schedule; an hour of cache spares the database a
    // full scan every time a crawler or a curious browser hits the URL.
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
});

/**
 * Webhook verification.
 *
 * Meta calls this once when the webhook is saved and expects the challenge
 * echoed back verbatim, but only if our verify token matches the one entered
 * in the App dashboard.
 *
 * @route GET /api/meta/whatsapp
 */
const verifyWhatsAppWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log('[META-WA] Webhook verified');
        return res.status(200).send(challenge);
    }

    console.warn('[META-WA] Webhook verification rejected — token mismatch');
    return res.sendStatus(403);
};

/**
 * Inbound WhatsApp events: customer replies, and delivery/read receipts.
 *
 * Meta retries anything that is not answered quickly, so this acknowledges
 * first and interprets afterwards — a slow handler turns into duplicate
 * deliveries of the same event.
 *
 * @route POST /api/meta/whatsapp
 */
const handleWhatsAppWebhook = (req, res) => {
    // Signature check. Meta signs every payload with the app secret; without
    // this, anyone who learns the URL can post fabricated messages.
    const signature = req.get('x-hub-signature-256');
    const appSecret = process.env.META_APP_SECRET;

    if (appSecret && req.rawBody) {
        const expected = 'sha256=' + crypto
            .createHmac('sha256', appSecret)
            .update(req.rawBody)
            .digest('hex');

        const a = Buffer.from(signature || '');
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            console.warn('[META-WA] Rejected webhook with a bad signature');
            return res.sendStatus(401);
        }
    }

    res.sendStatus(200);

    try {
        const entries = req.body?.entry || [];
        for (const entry of entries) {
            for (const change of entry.changes || []) {
                const value = change.value || {};

                for (const status of value.statuses || []) {
                    console.log(`[META-WA] ${status.recipient_id}: ${status.status}` +
                        (status.errors?.[0]?.title ? ` — ${status.errors[0].title}` : ''));
                }

                for (const message of value.messages || []) {
                    const from = message.from;
                    const text = message.text?.body || `[${message.type}]`;
                    console.log(`[META-WA] Inbound from ${from}: ${text}`);
                }
            }
        }
    } catch (err) {
        console.error('[META-WA] Webhook parse error:', err.message);
    }
};

/** @route GET /api/meta/status — what is wired up, for the admin screen. */
const getMetaStatus = asyncHandler(async (req, res) => {
    const meta = require('../services/metaConversions');
    const productCount = await Product.countDocuments({ isActive: true });

    res.json({
        success: true,
        data: {
            conversionsApi: meta.getStatus(),
            catalogFeedUrl: `${(process.env.BACKEND_URL || '').replace(/\/$/, '')}/api/meta/catalog.xml`,
            catalogProducts: productCount,
            whatsapp: {
                configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
                webhookVerifyTokenSet: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
                signatureCheckEnabled: Boolean(process.env.META_APP_SECRET),
            },
            facebookLogin: {
                configured: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
            },
        },
    });
});

module.exports = {
    getCatalogFeed,
    verifyWhatsAppWebhook,
    handleWhatsAppWebhook,
    getMetaStatus,
};
