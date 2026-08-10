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
const whatsappService = require('../services/whatsappService');

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
 * Link preview for a single product.
 *
 * The storefront is client-rendered, so every URL returns the same HTML shell
 * with one fixed title and description. Crawlers do not run JavaScript, which
 * means every product link shared to Instagram, WhatsApp or Facebook previewed
 * as the generic site card — no product name, no price, no photograph.
 *
 * Vercel rewrites crawler traffic for /product/:slug here (see vercel.json).
 * Real visitors never reach this route: they get the SPA from the CDN exactly
 * as before, so nothing about the site's behaviour or speed changes.
 *
 * The response is a complete document rather than tags alone, because that is
 * what a crawler expects to parse. It carries a redirect for the rare human who
 * lands here — a crawler ignores it, a browser follows it to the real page.
 *
 * @route GET /api/meta/og/product/:slug
 * @access Public
 */
const getProductPreview = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const canonical = `${FRONTEND}/product/${encodeURIComponent(slug)}`;

    const product = await Product.findOne({ slug, isActive: true })
        .select('name nameAr description descriptionAr price currency images slug')
        .lean();

    // Unknown slug still gets a valid card — a broken preview is worse than a
    // generic one, and the crawler must not see a 404 for a live share.
    const title = product
        ? `${product.name} — ARTÉVA Maison`
        : 'ARTÉVA Maison | Luxury Home Décor';

    const description = product
        ? (product.description || `${product.name}. Handcrafted home décor, delivered across Kuwait.`).slice(0, 200)
        : 'Luxury home décor, handcrafted glassware and artisan collections.';

    const image = product?.images?.length
        ? (product.images.find(i => i.isPrimary) || product.images[0]).url
        : `${FRONTEND}/assets/images/favicon.svg`;

    const price = product ? Number(product.price).toFixed(3) : '';
    const currency = product?.currency || 'KWD';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${xmlEscape(title)}</title>
<meta name="description" content="${xmlEscape(description)}" />
<link rel="canonical" href="${xmlEscape(canonical)}" />

<meta property="og:type" content="${product ? 'product' : 'website'}" />
<meta property="og:site_name" content="ARTÉVA Maison" />
<meta property="og:title" content="${xmlEscape(title)}" />
<meta property="og:description" content="${xmlEscape(description)}" />
<meta property="og:url" content="${xmlEscape(canonical)}" />
<meta property="og:image" content="${xmlEscape(image)}" />
<meta property="og:image:alt" content="${xmlEscape(product?.name || 'ARTÉVA Maison')}" />
${product ? `<meta property="product:price:amount" content="${price}" />
<meta property="product:price:currency" content="${xmlEscape(currency)}" />` : ''}

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${xmlEscape(title)}" />
<meta name="twitter:description" content="${xmlEscape(description)}" />
<meta name="twitter:image" content="${xmlEscape(image)}" />

<meta http-equiv="refresh" content="0; url=${xmlEscape(canonical)}" />
</head>
<body>
<p><a href="${xmlEscape(canonical)}">${xmlEscape(title)}</a></p>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    // Crawlers re-scrape often; an hour spares the database a query per scrape.
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(html);
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
    } else if (process.env.NODE_ENV === 'production') {
        /* Fail closed. This endpoint is public and unauthenticated by design —
         * the signature IS its authentication. Without a secret to check
         * against, anything posted here would be treated as a genuine customer
         * message, which means a stranger could trigger WhatsApp sends from the
         * business number to any phone they name. Refusing is the safe answer;
         * local development still runs unsigned so the handler can be tested.  */
        console.error('[META-WA] Refusing webhook: META_APP_SECRET is not set, so its authenticity cannot be verified');
        return res.sendStatus(403);
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
                    const text = message.text?.body || '';

                    /* Acknowledge the customer and alert the owners. Deliberately
                     * not awaited: the 200 has already been sent, and Meta resends
                     * anything it considers slow, which would double-greet. Errors
                     * are handled inside; this catch is the last resort so a
                     * rejection can never become an unhandled rejection. */
                    whatsappService.handleInboundMessage(from, text)
                        .catch(err => console.error(`[META-WA] Inbound handling failed: ${err.message}`));
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
        },
    });
});

module.exports = {
    getCatalogFeed,
    getProductPreview,
    verifyWhatsAppWebhook,
    handleWhatsAppWebhook,
    getMetaStatus,
};
