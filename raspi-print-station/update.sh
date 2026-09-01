#!/bin/bash
# ── ARTÉVA MAISON — Update the Pi from GitHub (no git needed) ──
#
# Downloads the latest raspi-print-station folder straight from GitHub as a
# tarball, keeps everything local to this Pi, and restarts the services.
#
#     bash update.sh
#
# Kept intact, never overwritten:
#     .env                  your configuration
#     auth_info_baileys/    the paired WhatsApp session
#     queue/                receipts not yet printed
#     logs/                 history
#     greeted-state.json    greeting cooldowns
#
# The whole body is wrapped in main() on purpose: bash must parse to the final
# line before it runs anything, so this script replacing itself mid-update
# cannot corrupt the run.
set -u

REPO="${REPO:-wattohuch/arteva-maison-backend}"
BRANCH="${BRANCH:-main}"
SUBDIR="raspi-print-station"

main() {
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  echo ""
  echo "  ╔════════════════════════════════════════════════════╗"
  echo "  ║  ARTÉVA — Update Print Station                     ║"
  echo "  ╚════════════════════════════════════════════════════╝"
  echo ""
  echo "  Source: github.com/$REPO ($BRANCH)"
  echo "  Target: $SCRIPT_DIR"
  echo ""

  # ── 1. Download ──
  echo "⬇️  Downloading..."
  URL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"
  if ! curl -fsSL "$URL" -o "$TMP/src.tar.gz"; then
    echo "  ❌ Download failed."
    echo "     Check the Pi's internet, and that github.com/$REPO is reachable."
    exit 1
  fi

  # Pull out only the folder we care about.
  REPO_NAME="${REPO##*/}"
  if ! tar -xzf "$TMP/src.tar.gz" -C "$TMP" "$REPO_NAME-$BRANCH/$SUBDIR" 2>/dev/null; then
    echo "  ❌ Could not extract $SUBDIR from the archive."
    exit 1
  fi
  NEW="$TMP/$REPO_NAME-$BRANCH/$SUBDIR"
  echo "  ✅ Downloaded"

  # ── 2. Refuse to install anything that does not parse ──
  echo ""
  # Only meaningful if node is present. Without this guard a Pi that has not
  # installed Node yet gets "Syntax error" for every file, which points at
  # entirely the wrong problem.
  if ! command -v node > /dev/null 2>&1; then
    echo "⚠️  Node.js is not installed — skipping the syntax check."
    echo "    Install it before starting the services:"
    echo "      sudo apt install -y nodejs npm"
  else
    echo "🔍 Checking the downloaded scripts..."
    BAD=0
    for f in "$NEW"/*.js; do
      [ -f "$f" ] || continue
      if ! node --check "$f" 2>/dev/null; then
        echo "  ❌ Syntax error in $(basename "$f")"
        BAD=1
      fi
    done
    if [ "$BAD" -eq 1 ]; then
      echo "  Aborting — nothing was changed."
      exit 1
    fi
    echo "  ✅ All scripts parse"
  fi

  # ── 3. Copy code only ──
  echo ""
  echo "📦 Installing..."
  for f in "$NEW"/*.js "$NEW"/*.sh "$NEW"/package.json "$NEW"/.env.example \
           "$NEW"/.gitignore "$NEW"/.gitattributes "$NEW"/README.md "$NEW"/logo.png; do
    [ -f "$f" ] && cp -f "$f" "$SCRIPT_DIR/"
  done
  # CRLF in a shebang makes a script unrunnable on Linux.
  sed -i 's/\r$//' "$SCRIPT_DIR"/*.sh 2>/dev/null || true
  chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true
  echo "  ✅ Files updated (.env, session, queue and logs untouched)"

  # ── 4. First run needs a config ──
  if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo ""
    echo "  ⚠️  No .env existed — created one from the example."
    echo "     Set PRINT_KEY and PRINTER_NAME before this will work:"
    echo "       nano $SCRIPT_DIR/.env"
  fi

  # ── 5. Dependencies ──
  echo ""
  echo "📚 Installing dependencies..."
  # Show the real error on failure. This used to pipe through `tail -4`, which
  # cut npm's actual message and left only "a complete log can be found in…" —
  # useless, and it hid a failure that left a KNOWN-VULNERABLE Baileys in place.
  NPM_LOG="$TMP/npm-install.log"
  if (cd "$SCRIPT_DIR" && npm install --omit=dev --no-audit --no-fund) > "$NPM_LOG" 2>&1; then
    tail -3 "$NPM_LOG"
    echo "  ✅ Dependencies installed"
  else
    echo "  ❌ npm install FAILED — the error follows:"
    echo "  ─────────────────────────────────────────────"
    grep -iE "npm (error|ERR!)" "$NPM_LOG" | head -20 || tail -25 "$NPM_LOG"
    echo "  ─────────────────────────────────────────────"
    echo ""
    echo "  ⚠️  The services were NOT left in a known-good dependency state."
    echo "     This matters: package.json pins a Baileys version that patches a"
    echo "     message-spoofing advisory, and a failed install leaves whatever"
    echo "     was here before. Fix the error above, then re-run:"
    echo "       cd $SCRIPT_DIR && npm install --omit=dev"
    echo ""
    # Keep a copy that outlives the temp dir so it can be read afterwards.
    cp "$NPM_LOG" "$SCRIPT_DIR/logs/npm-install-failed.log" 2>/dev/null && \
      echo "     Full log: $SCRIPT_DIR/logs/npm-install-failed.log"
    echo ""
  fi

  # ── 5b. Warn when the systemd units / watchdog are older than the code ──
  # This script intentionally does not touch systemd or cron — that is setup.sh's
  # job, and it does apt installs and swap setup that should not run on every
  # update. But a Pi that only ever runs update.sh keeps stale unit files, so say
  # so rather than letting it pass unnoticed.
  WA_UNIT=/etc/systemd/system/arteva-whatsapp.service
  NEEDS_SETUP=0
  if [ -f "$WA_UNIT" ] && grep -q '^Restart=always' "$WA_UNIT" 2>/dev/null; then
    NEEDS_SETUP=1
  fi
  if ! sudo crontab -l 2>/dev/null | grep -q "watchdog.sh"; then
    NEEDS_SETUP=1
  fi
  if [ "$NEEDS_SETUP" -eq 1 ]; then
    echo ""
    echo "  ⚠️  The service definitions and/or watchdog on this Pi are out of date."
    echo "     Code was updated, but systemd units and cron are installed by"
    echo "     setup.sh. Run it once (safe to re-run):"
    echo "       bash setup.sh"
  fi

  # ── 6. Restart ──
  echo ""
  echo "🔄 Restarting services..."
  if sudo systemctl restart arteva-print 2>/dev/null; then
    echo "  ✅ arteva-print"
  else
    echo "  ℹ️  arteva-print not installed yet — run: bash setup.sh"
  fi

  # Do not restart into a logged-out WhatsApp; it would just churn.
  if [ -f "$SCRIPT_DIR/NEEDS_QR_SCAN" ]; then
    echo "  ⚠️  WhatsApp is logged out — not restarting it."
    echo "     Run: bash wa-reset.sh"
  elif sudo systemctl restart arteva-whatsapp 2>/dev/null; then
    echo "  ✅ arteva-whatsapp"
  else
    echo "  ℹ️  arteva-whatsapp not installed yet — run: bash setup.sh"
  fi

  # ── 7. Verify ──
  echo ""
  echo "🩺 Health check..."
  sleep 4
  bash "$SCRIPT_DIR/doctor.sh" || true

  echo ""
  echo "  Update complete."
  echo ""
}

# Nothing may follow this call.
#
# Bash reads a script by file offset. main() has just replaced this file, so
# any further read lands at that offset inside the NEW content and fails to
# parse — printing a syntax error after a successful update. Exiting here ends
# the read.
main "$@"
exit $?
