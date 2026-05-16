// Polyfill for older Node.js versions
const crypto = require('crypto');
global.crypto = crypto.webcrypto || crypto;
globalThis.crypto = crypto.webcrypto || crypto;

const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const https = require('https');

const API_KEY = process.env.API_KEY || 'arteva_secret_2024_print';
const BASE_URL = process.env.API_URL || 'https://arteva-maison-backend-gy1x.onrender.com';

const POLL_INTERVAL = 10000; // 10 seconds

const httpsAgent = new https.Agent({
    keepAlive: true,
    timeout: 30000
});

async function apiRequest(endpoint, method = 'GET', body = null) {
    const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${API_KEY}`;
    
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        agent: httpsAgent
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const res = await fetch(url, options);
        return await res.json();
    } catch (e) {
        console.error(`[API] Error calling ${endpoint}:`, e.message);
        return { success: false };
    }
}

async function startAgent() {
    console.log('🔄 Initializing WhatsApp Agent...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    // Disable noisy logs from Baileys
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger,
        browser: ['Arteva Maison', 'MacOS', '1.0.0']
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n================================================================');
            console.log('📱 ACTION REQUIRED: Scan the QR code above with your WhatsApp app.');
            console.log('================================================================\n');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed due to ', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startAgent();
            } else {
                console.log('❌ You are logged out. Please delete the "auth_info_baileys" folder and restart to scan again.');
                process.exit(1);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp successfully connected!');
            startPolling(sock);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

let isPolling = false;

async function startPolling(sock) {
    if (isPolling) return;
    isPolling = true;

    console.log(`🔄 Started polling for WhatsApp messages from ${BASE_URL} every 10s...`);

    setInterval(async () => {
        try {
            const result = await apiRequest('/api/admin/whatsapp-queue/poll');
            
            if (result.success && result.messages && result.messages.length > 0) {
                console.log(`📥 Received ${result.messages.length} message(s) to send.`);
                
                for (const msg of result.messages) {
                    try {
                        const jid = `${msg.phone.replace('+', '')}@s.whatsapp.net`;
                        console.log(`📨 Sending to ${jid}...`);
                        
                        await sock.sendMessage(jid, { text: msg.message });
                        
                        console.log(`✅ Sent message ${msg._id}`);
                        
                        // Confirm with server
                        await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
                            status: 'sent'
                        });

                        // Small 3-second delay to prevent local rate limiting from WhatsApp
                        await new Promise(r => setTimeout(r, 3000));
                    } catch (sendErr) {
                        console.error(`❌ Failed to send message ${msg._id}:`, sendErr.message);
                        
                        await apiRequest(`/api/admin/whatsapp-queue/status/${msg._id}`, 'POST', {
                            status: 'failed',
                            errorLog: sendErr.message
                        });
                    }
                }
            }
        } catch (e) {
            console.error('Polling error:', e.message);
        }
    }, POLL_INTERVAL);
}

startAgent();
