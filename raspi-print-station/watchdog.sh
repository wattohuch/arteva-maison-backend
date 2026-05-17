#!/bin/bash
# ARTÉVA Print Station — Enhanced Watchdog
# Checks heartbeat, memory, and WhatsApp agent health.
# Installed as cron job by setup.sh (runs every minute)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HEARTBEAT="/tmp/print-heartbeat"
MAX_AGE=120  # seconds (2 minutes — allows for slow prints)
LOG="$SCRIPT_DIR/logs/watchdog.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"; }

# ── Check print station heartbeat ──
if [ ! -f "$HEARTBEAT" ]; then
  log "WARN: No heartbeat file, restarting arteva-print"
  systemctl restart arteva-print
elif [ -f "$HEARTBEAT" ]; then
  LAST=$(cat "$HEARTBEAT")
  NOW=$(date +%s)
  AGE=$(( NOW - LAST ))
  if [ "$AGE" -gt "$MAX_AGE" ]; then
    log "WARN: Heartbeat stale (${AGE}s > ${MAX_AGE}s), restarting arteva-print"
    systemctl restart arteva-print
  fi
fi

# ── Check WhatsApp agent is running ──
if ! systemctl is-active --quiet arteva-whatsapp 2>/dev/null; then
  log "WARN: arteva-whatsapp not running, starting..."
  systemctl start arteva-whatsapp 2>/dev/null || true
fi

# ── Check system memory ──
FREE_MB=$(free -m | awk '/^Mem:/ {print $7}')
if [ "${FREE_MB:-999}" -lt 50 ]; then
  log "CRIT: Only ${FREE_MB}MB free RAM! Clearing caches..."
  sync
  echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
fi

# ── Check CPU temperature ──
if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
  TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
  TEMP_C=$((TEMP / 1000))
  if [ "$TEMP_C" -gt 80 ]; then
    log "CRIT: CPU temperature ${TEMP_C}°C! Consider adding cooling."
  fi
fi

# ── Trim old logs (keep last 1000 lines) ──
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
