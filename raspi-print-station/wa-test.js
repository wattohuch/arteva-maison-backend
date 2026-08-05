#!/usr/bin/env node

/**
 * ARTÉVA MAISON — WhatsApp readability test
 *
 * Sends one real message through the RUNNING agent, so you can look at the
 * receiving phone and confirm it arrives as readable text rather than
 * "Waiting for this message. This may take a while."
 *
 * Usage (on the Pi):
 *   npm run wa:test -- 96550683207
 *   npm run wa:test -- 96550683207 "custom text"
 *
 * This deliberately does NOT open its own WhatsApp connection. Authenticating
 * a second socket against the same auth_info_baileys is what corrupts the
 * encryption session in the first place, so the send is delegated to the
 * agent's loopback-only /test-send endpoint and uses its live session.
 */

require('dotenv').config();
const http = require('http');

const PORT = parseInt(process.env.WA_HEALTH_PORT) || 3101;
const phone = process.argv[2];
const message = process.argv[3];

if (!phone) {
  console.error('');
  console.error('Usage: npm run wa:test -- <phone> ["message"]');
  console.error('Example: npm run wa:test -- 96550683207');
  console.error('');
  console.error('Phone must include country code, digits only (no + or spaces).');
  console.error('');
  process.exit(1);
}

function request(path, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timed out')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  console.log('');
  console.log('  ╔════════════════════════════════════════════════════╗');
  console.log('  ║  ARTÉVA — WhatsApp readability test                ║');
  console.log('  ╚════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Is the agent up and is its session actually usable?
  let health;
  try {
    const res = await request('/health', 'GET');
    health = res.body;
  } catch (e) {
    console.error(`❌ Cannot reach the agent on 127.0.0.1:${PORT} — ${e.message}`);
    console.error('');
    console.error('   Start it first:  sudo systemctl start arteva-whatsapp');
    console.error('   Then check:      sudo systemctl status arteva-whatsapp');
    console.error('');
    process.exit(1);
  }

  if (!health) {
    console.error('❌ Agent responded but not with JSON — is something else on this port?');
    process.exit(1);
  }

  console.log(`  Agent v${health.version}  connected=${health.connected}  warmedUp=${health.warmedUp}`);
  if (health.needsQrScan) {
    console.error('');
    console.error('❌ The agent reports it is LOGGED OUT and needs a QR scan.');
    console.error('   Run: bash wa-reset.sh');
    console.error('');
    process.exit(1);
  }
  if (!health.canSend) {
    console.error('');
    console.error('❌ Session is not ready to send yet.');
    console.error(`   connected=${health.connected} warmedUp=${health.warmedUp}`);
    console.error('   If it just started, wait a few seconds and try again.');
    console.error('');
    process.exit(1);
  }

  // 2. Send it.
  console.log(`  Sending to +${phone}...`);
  const res = await request('/test-send', 'POST', { phone, message });

  if (res.status === 200 && res.body?.success) {
    console.log('');
    console.log('  ✅ Message handed to WhatsApp.');
    console.log('');
    console.log('  ╔════════════════════════════════════════════════════╗');
    console.log('  ║  NOW LOOK AT THE RECEIVING PHONE                   ║');
    console.log('  ╚════════════════════════════════════════════════════╝');
    console.log('');
    console.log('  Readable text        → session is healthy. ✅');
    console.log('                          You may set WA_AUTO_GREET=true');
    console.log('');
    console.log('  "Waiting for this message"');
    console.log('  "في انتظار هذه الرسالة"  → session is STILL BROKEN. ❌');
    console.log('                          Run: bash wa-reset.sh');
    console.log('                          Leave WA_AUTO_GREET=false meanwhile.');
    console.log('');
    console.log('  Delivered ≠ readable — the sender side cannot tell the');
    console.log('  difference, which is why this has to be eyeballed.');
    console.log('');
    process.exit(0);
  }

  console.error('');
  console.error(`  ❌ Send failed (HTTP ${res.status}): ${res.body?.error || res.raw}`);
  console.error('');
  process.exit(1);
})().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
