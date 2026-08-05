#!/bin/bash
# ── ARTÉVA MAISON — Print Station Doctor ─────────────────────
#
# Read-only health check. Changes nothing; tells you what is wrong.
# Run on the Pi:  npm run doctor
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0; WARN=0; FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo ""
echo "  ╔════════════════════════════════════════════════════╗"
echo "  ║  ARTÉVA Print Station — Doctor                     ║"
echo "  ╚════════════════════════════════════════════════════╝"

# ── 1. Environment ──
echo ""
echo "── Environment ──"
if command -v node > /dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  # Node 20 is a hard floor, not a preference: every Baileys release that
  # patches the message-spoofing advisory (6.7.22+) declares node >= 20. The
  # only build that runs on Node 18 is the deprecated, vulnerable 6.17.x. Node
  # 18 is also past end-of-life.
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "Node $(node -v)"
  else
    bad "Node $(node -v) is too old — Baileys needs >= 20 (and Node 18 is EOL)."
    echo "     Upgrade:  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
    echo "     Then:     npm install --omit=dev && sudo systemctl restart arteva-whatsapp"
  fi
else
  bad "Node.js not installed"
fi

if [ -f "$SCRIPT_DIR/.env" ]; then
  ok ".env present"
  if grep -qE '^PRINT_KEY=(change-me|arteva-print-2026)' "$SCRIPT_DIR/.env"; then
    bad "PRINT_KEY is still the public default — customer data is exposed to anyone with the repo"
  else
    ok "PRINT_KEY has been changed from the default"
  fi
else
  bad ".env missing — run: cp .env.example .env && nano .env"
fi

if [ -d "$SCRIPT_DIR/node_modules" ]; then
  ok "node_modules installed"
  BAILEYS_VER=$(node -e "try{console.log(require('$SCRIPT_DIR/node_modules/@whiskeysockets/baileys/package.json').version)}catch(e){console.log('missing')}" 2>/dev/null)
  if [ "$BAILEYS_VER" = "missing" ]; then
    bad "Baileys not installed — run: npm install"
  else
    EXPECTED=$(node -e "try{console.log(require('$SCRIPT_DIR/package.json').dependencies['@whiskeysockets/baileys'])}catch(e){console.log('?')}" 2>/dev/null)
    if [ "$BAILEYS_VER" = "$EXPECTED" ]; then
      ok "Baileys $BAILEYS_VER (matches package.json)"
    else
      # The 6.17.x line is DEPRECATED by the Baileys maintainers for a zero-day
      # that allows message spoofing; their advisory says use 6.7.22+. A higher
      # version number is misleading here, so name it explicitly rather than
      # reporting a bland version mismatch.
      case "$BAILEYS_VER" in
        6.17.*|6.1[0-9].*)
          bad "Baileys $BAILEYS_VER is DEPRECATED — zero-day message-spoofing advisory (GHSA-qvv5-jq5g-4cgg)."
          echo "     Despite the higher number, $EXPECTED is the patched line. Run:"
          echo "       npm install --omit=dev"
          ;;
        *)
          warn "Baileys $BAILEYS_VER installed but package.json wants $EXPECTED — run: npm install"
          ;;
      esac
    fi
  fi
else
  bad "node_modules missing — run: npm install"
fi

# ── 2. Printer ──
echo ""
echo "── Printer ──"
if command -v lpstat > /dev/null 2>&1; then
  if lpstat -p > /dev/null 2>&1 && [ -n "$(lpstat -p 2>/dev/null)" ]; then
    lpstat -p 2>/dev/null | while read -r line; do echo "     $line"; done
    if lpstat -p 2>/dev/null | grep -qE 'disabled|rejecting'; then
      warn "A printer is disabled or rejecting jobs — run: cupsenable <name>"
    else
      ok "Printer present and accepting jobs"
    fi
  else
    bad "No CUPS printer configured — run: sudo hp-setup -i"
  fi
else
  bad "CUPS not installed (lpstat missing) — run: sudo apt install cups"
fi

# ── 3. Fonts (Arabic receipts must render offline) ──
echo ""
echo "── Fonts ──"
if command -v fc-list > /dev/null 2>&1; then
  if fc-list 2>/dev/null | grep -qi "noto.*arabic"; then
    ok "Noto Sans Arabic installed (Arabic prints correctly offline)"
  else
    warn "No local Arabic font — Arabic will render as boxes with no internet. Run: sudo apt install fonts-noto-core"
  fi
else
  warn "fontconfig missing — cannot verify Arabic font"
fi

# ── 4. Services ──
echo ""
echo "── Services ──"
for svc in arteva-print arteva-whatsapp; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^$svc.service"; then
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      ok "$svc is running"
    else
      warn "$svc is installed but NOT running — sudo systemctl start $svc"
    fi
  else
    bad "$svc not installed — run: bash setup.sh"
  fi
done

# ── 5. Watchdog must be able to act ──
echo ""
echo "── Watchdog ──"
if sudo crontab -l 2>/dev/null | grep -q "watchdog.sh"; then
  ok "Watchdog in root's crontab (can restart services)"
elif crontab -l 2>/dev/null | grep -q "watchdog.sh"; then
  bad "Watchdog is in $USER's crontab — it cannot restart anything. Re-run: bash setup.sh"
else
  warn "Watchdog not installed — run: bash setup.sh"
fi

# ── 6. Health endpoints ──
echo ""
echo "── Health ──"
check_health() {
  local port=$1 name=$2
  local body
  body=$(curl -s --max-time 5 "http://127.0.0.1:$port/health" 2>/dev/null)
  if [ -z "$body" ]; then
    warn "$name not answering on :$port"
    return
  fi
  if echo "$body" | grep -q '"unauthorized"'; then
    ok "$name up (health endpoint is token-protected)"
    return
  fi
  ok "$name responding on :$port"
  echo "$body" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  try{
    const h=JSON.parse(d);
    if(h.printer!==undefined) console.log('     printer='+h.printer+' pending='+h.pendingJobs+' failed='+h.failedJobs+' printed='+h.printedThisSession);
    if(h.connected!==undefined) console.log('     connected='+h.connected+' warmedUp='+h.warmedUp+' canSend='+h.canSend+' autoGreet='+(h.features&&h.features.autoGreet));
    if(h.decryptRetries){
      const r=h.decryptRetries;
      console.log('     decryptRetries: recovered='+r.recovered+' unrecoverable='+r.unrecoverable);
      if(r.unrecoverable>0) console.log('     ⚠️  '+r.unrecoverable+' message(s) could not be re-sent and stay unreadable to the recipient.');
      else if(r.recovered>0) console.log('     ℹ️  '+r.recovered+' undecryptable message(s) were automatically re-sent — self-healing is working.');
    }
  }catch(e){}
});" 2>/dev/null
}
check_health 3100 "Print station"
check_health 3101 "WhatsApp agent"

# ── 7. WhatsApp session ──
echo ""
echo "── WhatsApp session ──"
if [ -f "$SCRIPT_DIR/NEEDS_QR_SCAN" ]; then
  bad "LOGGED OUT — run: bash wa-reset.sh, then scan the QR code"
elif [ -d "$SCRIPT_DIR/auth_info_baileys" ]; then
  ok "Session folder present (paired)"
  echo "     Paired ≠ readable. If recipients see \"Waiting for this message\","
  echo "     the encryption session is broken: bash wa-reset.sh"
else
  warn "Not paired yet — run: bash wa-reset.sh and scan the QR code"
fi

COUNT=$(ls -1d "$SCRIPT_DIR"/auth_broken-* 2>/dev/null | wc -l)
if [ "$COUNT" -gt 0 ]; then
  warn "$COUNT old broken session backup(s) present (auth_broken-*) — safe to delete once WhatsApp works"
fi

if pgrep -f "whatsapp-agent.js" > /dev/null 2>&1; then
  N=$(pgrep -cf "whatsapp-agent.js")
  if [ "$N" -gt 1 ]; then
    bad "$N whatsapp-agent processes running! Two agents corrupt the WhatsApp session. Stop the extras."
  else
    ok "Exactly one whatsapp-agent process"
  fi
fi

# ── 8. Disk & queue ──
echo ""
echo "── Disk & queue ──"
FREE_MB=$(df -Pm "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "$FREE_MB" ]; then
  if [ "$FREE_MB" -lt 50 ]; then bad "Only ${FREE_MB}MB free — receipts may be lost"
  elif [ "$FREE_MB" -lt 200 ]; then warn "${FREE_MB}MB free (getting low)"
  else ok "${FREE_MB}MB free"; fi
fi
for d in pending completed failed; do
  N=$(ls -1 "$SCRIPT_DIR/queue/$d"/*.json 2>/dev/null | wc -l)
  echo "     queue/$d: $N"
done
PEND=$(ls -1 "$SCRIPT_DIR/queue/pending"/*.json 2>/dev/null | wc -l)
[ "$PEND" -gt 20 ] && warn "$PEND jobs stuck pending — is the printer online? npm run check-health"
FAILED=$(ls -1 "$SCRIPT_DIR/queue/failed"/*.json 2>/dev/null | wc -l)
[ "$FAILED" -gt 0 ] && warn "$FAILED failed job(s) — inspect, then: npm run retry-failed"

# ── 9. Backend reachability ──
echo ""
echo "── Backend ──"
API_URL=$(grep -E '^API_URL=' "$SCRIPT_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
API_URL=${API_URL:-https://arteva-maison-backend-gy1x.onrender.com}
if curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$API_URL/api/health" 2>/dev/null | grep -q '^200$'; then
  ok "Backend reachable ($API_URL)"
else
  warn "Backend did not return 200 at $API_URL/api/health (Render cold start can take ~30s)"
fi

# ── Summary ──
echo ""
echo "  ╔════════════════════════════════════════════════════╗"
printf "  ║  %2d passed   %2d warnings   %2d problems              ║\n" "$PASS" "$WARN" "$FAIL"
echo "  ╚════════════════════════════════════════════════════╝"
echo ""
[ "$FAIL" -gt 0 ] && exit 1
exit 0
