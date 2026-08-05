#!/bin/bash
# ── ARTÉVA MAISON — Deploy to Raspberry Pi (no git required) ──
#
# The Pi has no git, so updates are copied over SSH rather than pulled.
#
# Run from your PC, inside this folder (Git Bash on Windows works):
#     bash deploy.sh pi@192.168.1.50
#     bash deploy.sh pi@raspberrypi.local
#
# What it does NOT touch on the Pi — deliberately:
#     .env                    your configuration
#     auth_info_baileys/      the paired WhatsApp session (copying this over
#                             would break encryption for every recipient)
#     queue/                  receipts not yet printed
#     logs/
#     greeted-state.json      greeting cooldowns
#
# After it finishes it restarts the services and runs the doctor.
set -u

TARGET="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_DIR="${REMOTE_DIR:-~/print-station}"

if [ -z "$TARGET" ]; then
  echo ""
  echo "Usage: bash deploy.sh <user@host>"
  echo "Example: bash deploy.sh pi@192.168.1.50"
  echo ""
  echo "Optional: REMOTE_DIR=~/other-dir bash deploy.sh pi@host"
  echo ""
  exit 1
fi

echo ""
echo "  ╔════════════════════════════════════════════════════╗"
echo "  ║  ARTÉVA — Deploy Print Station                     ║"
echo "  ╚════════════════════════════════════════════════════╝"
echo ""
echo "  From:   $SCRIPT_DIR"
echo "  To:     $TARGET:$REMOTE_DIR"
echo ""

# ── 1. Reachable? ──
echo "🔌 Checking SSH..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$TARGET" 'echo ok' > /dev/null 2>&1; then
  # BatchMode fails when the key needs a passphrase / password auth is used;
  # retry interactively before giving up.
  if ! ssh -o ConnectTimeout=10 "$TARGET" 'echo ok' > /dev/null 2>&1; then
    echo "  ❌ Cannot SSH to $TARGET"
    echo "     Check the address, and that SSH is enabled on the Pi."
    exit 1
  fi
fi
echo "  ✅ Connected"

# ── 2. Local sanity check before shipping anything ──
echo ""
echo "🔍 Checking the files about to be deployed..."
FAILED=0
for f in print-station.js whatsapp-agent.js chatbot.js templates.js sharedReceiptTemplate.js wa-test.js stress-test.js; do
  if [ -f "$SCRIPT_DIR/$f" ]; then
    if ! node --check "$SCRIPT_DIR/$f" 2>/dev/null; then
      echo "  ❌ Syntax error in $f — not deploying"
      FAILED=1
    fi
  fi
done
[ "$FAILED" -eq 1 ] && exit 1
echo "  ✅ All scripts parse"

# ── 3. Copy ──
echo ""
echo "📦 Copying files..."
ssh "$TARGET" "mkdir -p $REMOTE_DIR"

# rsync when available (fast, and --exclude keeps Pi-local state safe).
if command -v rsync > /dev/null 2>&1 && ssh "$TARGET" 'command -v rsync' > /dev/null 2>&1; then
  rsync -az --info=stats1 \
    --exclude '.env' \
    --exclude 'node_modules/' \
    --exclude 'auth_info_baileys/' \
    --exclude 'auth_broken-*/' \
    --exclude 'queue/' \
    --exclude 'logs/' \
    --exclude 'greeted-state.json' \
    --exclude 'NEEDS_QR_SCAN' \
    --exclude 'whatsapp-agent.lock' \
    --exclude '.git/' \
    "$SCRIPT_DIR/" "$TARGET:$REMOTE_DIR/"
else
  # scp fallback: name each file, so nothing Pi-local is ever overwritten.
  echo "  (rsync unavailable — using scp)"
  for f in print-station.js whatsapp-agent.js chatbot.js templates.js \
           sharedReceiptTemplate.js wa-test.js stress-test.js \
           package.json setup.sh watchdog.sh doctor.sh wa-reset.sh \
           deploy.sh .env.example .gitattributes README.md logo.png; do
    [ -f "$SCRIPT_DIR/$f" ] && scp -q "$SCRIPT_DIR/$f" "$TARGET:$REMOTE_DIR/$f"
  done
fi
echo "  ✅ Files copied"

# ── 4. First-run help ──
if ! ssh "$TARGET" "test -f $REMOTE_DIR/.env"; then
  echo ""
  echo "  ⚠️  No .env on the Pi yet. Creating one from the example."
  ssh "$TARGET" "cp $REMOTE_DIR/.env.example $REMOTE_DIR/.env"
  echo "     Edit it before the services will work properly:"
  echo "       ssh $TARGET 'nano $REMOTE_DIR/.env'"
fi

# ── 5. Dependencies (only when they changed) ──
echo ""
echo "📚 Installing dependencies (skipped when unchanged)..."
ssh "$TARGET" "cd $REMOTE_DIR && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5"

# ── 6. Line endings — a CRLF shebang makes a script unrunnable on Linux ──
ssh "$TARGET" "cd $REMOTE_DIR && sed -i 's/\r$//' *.sh 2>/dev/null; chmod +x *.sh 2>/dev/null" || true

# ── 7. Restart ──
echo ""
echo "🔄 Restarting services..."
ssh -t "$TARGET" "sudo systemctl restart arteva-print 2>/dev/null && echo '  ✅ arteva-print restarted' || echo '  ℹ️  arteva-print not installed yet (run: bash setup.sh on the Pi)'"

# The WhatsApp agent is only restarted if it is not waiting for a QR scan —
# restarting into a logged-out state just churns.
ssh -t "$TARGET" "if [ -f $REMOTE_DIR/NEEDS_QR_SCAN ]; then echo '  ⚠️  WhatsApp is LOGGED OUT — not restarting. Run: cd $REMOTE_DIR && bash wa-reset.sh'; else sudo systemctl restart arteva-whatsapp 2>/dev/null && echo '  ✅ arteva-whatsapp restarted' || echo '  ℹ️  arteva-whatsapp not installed yet'; fi"

# ── 8. Verify ──
echo ""
echo "🩺 Running doctor on the Pi..."
sleep 4
ssh -t "$TARGET" "cd $REMOTE_DIR && bash doctor.sh" || true

echo ""
echo "  ╔════════════════════════════════════════════════════╗"
echo "  ║  Deploy complete                                   ║"
echo "  ╚════════════════════════════════════════════════════╝"
echo ""
echo "  Logs:    ssh $TARGET 'journalctl -u arteva-print -f'"
echo "  WA logs: ssh $TARGET 'journalctl -u arteva-whatsapp -f'"
echo ""
