#!/bin/bash
# ── ARTÉVA MAISON — WhatsApp Session Reset ───────────────────
#
# Use this when messages sent by the business number arrive at the recipient as
#   "Waiting for this message. This may take a while."
#   "في انتظار هذه الرسالة، قد يستغرق ذلك بعض الوقت"
#
# That text is NOT a delay. It is WhatsApp on the RECIPIENT's phone reporting
# that it could not decrypt what we sent. The encryption session in
# auth_info_baileys is unusable and no amount of restarting will repair it —
# the keys have to be re-negotiated, which means pairing the device again.
#
# This script stops the agent, preserves the broken session for reference,
# clears it, and walks you through scanning a fresh QR code.
#
# Run on the Pi:  bash wa-reset.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTH_DIR="$SCRIPT_DIR/auth_info_baileys"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo ""
echo "  ╔════════════════════════════════════════════════════╗"
echo "  ║  ARTÉVA — WhatsApp Session Reset                   ║"
echo "  ╚════════════════════════════════════════════════════╝"
echo ""
echo "  This will UNPAIR this device from WhatsApp."
echo "  You will need the business phone in hand to scan a QR code."
echo ""
read -r -p "  Continue? [y/N] " reply
case "$reply" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "  Aborted — nothing changed."; exit 0 ;;
esac

# ── 1. Stop the service so it cannot hold or rewrite the session ──
echo ""
echo "⏹  Stopping arteva-whatsapp..."
if sudo systemctl stop arteva-whatsapp 2>/dev/null; then
  echo "   ✅ Service stopped"
else
  echo "   ℹ️  Service not installed or already stopped"
fi

# Any agent started by hand also has to go — two agents on one session is
# what corrupts it in the first place.
if pgrep -f "whatsapp-agent.js" > /dev/null 2>&1; then
  echo "   Stopping stray whatsapp-agent.js process(es)..."
  pkill -f "whatsapp-agent.js" 2>/dev/null || true
  sleep 2
fi
rm -f "$SCRIPT_DIR/whatsapp-agent.lock"

# ── 2. Keep the broken session rather than deleting it outright ──
if [ -d "$AUTH_DIR" ]; then
  BACKUP="$SCRIPT_DIR/auth_broken-$STAMP"
  echo ""
  echo "📦 Moving the old session aside → $(basename "$BACKUP")"
  mv "$AUTH_DIR" "$BACKUP"
  echo "   (safe to delete once WhatsApp is working again)"
else
  echo ""
  echo "ℹ️  No existing session found — this will be a first-time pairing."
fi

rm -f "$SCRIPT_DIR/NEEDS_QR_SCAN"

# ── 3. Pair again ──
echo ""
echo "  ╔════════════════════════════════════════════════════╗"
echo "  ║  📱 SCAN THE QR CODE                                ║"
echo "  ╚════════════════════════════════════════════════════╝"
echo ""
echo "  On the business phone:"
echo "    WhatsApp → Settings → Linked Devices → Link a Device"
echo ""
echo "  Then scan the QR code below."
echo "  When you see '✅ WhatsApp successfully connected!', press Ctrl+C."
echo ""
sleep 2

cd "$SCRIPT_DIR"
node whatsapp-agent.js || true

# ── 4. Back under systemd, then verify and finish configuring ──
echo ""
echo "🔄 Starting the service again..."
if sudo systemctl start arteva-whatsapp 2>/dev/null; then
  echo "   ✅ arteva-whatsapp started"
else
  echo "   ⚠️  Could not start the service (not installed? run: bash setup.sh)"
  echo "      Nothing else to do here."
  exit 0
fi

# Give it time to connect and finish its warm-up window before sending.
echo "   Waiting for the session to connect and warm up..."
for _ in $(seq 1 24); do
  sleep 2
  if curl -s --max-time 3 http://127.0.0.1:3101/health 2>/dev/null | grep -q '"canSend": *true'; then
    echo "   ✅ Session ready"
    break
  fi
done

echo ""
echo "  ╔════════════════════════════════════════════════════╗"
echo "  ║  Verify it is READABLE                             ║"
echo "  ╚════════════════════════════════════════════════════╝"
echo ""
echo "  Nothing on this end can tell a delivered message from an"
echo "  unreadable one, so this last check has to be done by eye."
echo ""
read -r -p "  Phone to send a test to (country code, digits only, blank to skip): " TESTNUM

if [ -z "${TESTNUM:-}" ]; then
  echo ""
  echo "  Skipped. When you are ready:"
  echo "    npm run wa:test -- 9655XXXXXXX"
  echo "  Customer greetings stay OFF until a test passes."
  echo ""
  exit 0
fi

echo ""
node "$SCRIPT_DIR/wa-test.js" "$TESTNUM" || true

echo ""
read -r -p "  Did the message arrive as READABLE TEXT on that phone? [y/N] " READABLE
case "$READABLE" in
  [yY]|[yY][eE][sS]) ;;
  *)
    echo ""
    echo "  ❌ Then the session is still not right."
    echo "     Customer greetings are staying OFF — that is the safe state."
    echo "     Check:  npm run check-wa-health   (look at decryptRetries)"
    echo "     Then try this script again."
    echo ""
    exit 1 ;;
esac

# ── Enable customer greetings for them, rather than making them edit .env ──
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE" 2>/dev/null || touch "$ENV_FILE"
fi

echo ""
read -r -p "  Turn customer auto-greeting ON now? [y/N] " ENABLE
case "$ENABLE" in
  [yY]|[yY][eE][sS])
    if grep -q '^WA_AUTO_GREET=' "$ENV_FILE"; then
      sed -i 's/^WA_AUTO_GREET=.*/WA_AUTO_GREET=true/' "$ENV_FILE"
    else
      printf '\nWA_AUTO_GREET=true\n' >> "$ENV_FILE"
    fi
    sudo systemctl restart arteva-whatsapp 2>/dev/null || true
    echo "   ✅ Customer auto-greeting is ON and the service was restarted."
    ;;
  *)
    echo "   Left OFF. Enable later with: WA_AUTO_GREET=true in .env"
    ;;
esac

echo ""
echo "  ╔════════════════════════════════════════════════════╗"
echo "  ║  ✅ Done — this is a one-time repair               ║"
echo "  ╚════════════════════════════════════════════════════╝"
echo ""
echo "  From here it runs itself: starts on boot, restarts on crash,"
echo "  reconnects on network drops, and now automatically re-sends any"
echo "  message a recipient reports it could not decrypt."
echo ""
echo "  Check on it any time with:  npm run doctor"
echo ""
