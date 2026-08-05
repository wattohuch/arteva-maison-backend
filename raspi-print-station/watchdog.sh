#!/bin/bash
# ARTÉVA Print Station — Watchdog
# Checks heartbeat, memory, temperature, and WhatsApp agent health.
# Installed by setup.sh into ROOT's crontab (runs every minute).
#
# Root matters: every corrective action here needs privileges. When this lived
# in the user crontab, `systemctl restart` and the drop_caches write were both
# denied, so the watchdog ran every minute and fixed nothing.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HEARTBEAT="/tmp/print-heartbeat"
MAX_AGE=180  # seconds — a long print plus a slow API call must not trip this
LOG="$SCRIPT_DIR/logs/watchdog.log"

mkdir -p "$SCRIPT_DIR/logs" 2>/dev/null

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"; }

# ── Print station: is it wedged? ──
#
# Only intervene when systemd thinks the unit is ACTIVE but the heartbeat has
# gone cold — that is the genuinely stuck case. If the unit is inactive it was
# either stopped deliberately (restarting it would fight the operator, e.g.
# mid-maintenance) or it crashed, and systemd's Restart= handles crashes.
if systemctl is-active --quiet arteva-print 2>/dev/null; then
  if [ -f "$HEARTBEAT" ]; then
    LAST=$(cat "$HEARTBEAT" 2>/dev/null)
    case "$LAST" in
      ''|*[!0-9]*) log "WARN: Heartbeat unreadable, restarting arteva-print"
                   systemctl restart arteva-print ;;
      *) NOW=$(date +%s)
         AGE=$(( NOW - LAST ))
         if [ "$AGE" -gt "$MAX_AGE" ]; then
           log "WARN: Heartbeat stale (${AGE}s > ${MAX_AGE}s), restarting arteva-print"
           systemctl restart arteva-print
         fi ;;
    esac
  else
    log "WARN: Service active but no heartbeat file, restarting arteva-print"
    systemctl restart arteva-print
  fi
fi

# ── WhatsApp agent ──
#
# Do NOT start it while it is waiting for a QR scan. The agent leaves this
# marker when WhatsApp has unlinked the device; starting it on a loop would
# just churn without ever pairing, and would bury the reason in the log.
if [ -f "$SCRIPT_DIR/NEEDS_QR_SCAN" ]; then
  # Once an hour is enough to keep this visible without flooding the log.
  if [ "$(date +%M)" = "07" ]; then
    log "ACTION REQUIRED: WhatsApp is logged out. Run 'bash wa-reset.sh' on the Pi and scan the QR code."
  fi
elif ! systemctl is-active --quiet arteva-whatsapp 2>/dev/null; then
  # Respect a deliberate stop: only (re)start a unit that is enabled at boot.
  if systemctl is-enabled --quiet arteva-whatsapp 2>/dev/null; then
    log "WARN: arteva-whatsapp not running, starting..."
    systemctl start arteva-whatsapp 2>/dev/null || true
  fi
fi

# ── Disk space ──
# Receipts are written to disk before printing, so a full card loses orders.
FREE_MB=$(df -Pm "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "$FREE_MB" ] && [ "$FREE_MB" -lt 50 ]; then
  log "CRIT: Only ${FREE_MB}MB disk free! Trimming completed jobs and old logs..."
  # Oldest completed job files first — they are already printed and acked.
  ls -1t "$SCRIPT_DIR/queue/completed"/*.json 2>/dev/null | tail -n +200 | xargs -r rm -f
  find "$SCRIPT_DIR/logs" -name '*.log.*' -mtime +2 -delete 2>/dev/null
  find "$SCRIPT_DIR/logs" -name '*.gz' -mtime +2 -delete 2>/dev/null
fi

# ── System memory ──
FREE_RAM=$(free -m | awk '/^Mem:/ {print $7}')
if [ "${FREE_RAM:-999}" -lt 50 ]; then
  log "CRIT: Only ${FREE_RAM}MB free RAM! Clearing caches..."
  sync
  echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
fi

# ── CPU temperature ──
if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
  TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
  TEMP_C=$((TEMP / 1000))
  if [ "$TEMP_C" -gt 80 ]; then
    log "CRIT: CPU temperature ${TEMP_C}°C! Consider adding cooling."
  fi
fi

# ── Trim this log (keep last 1000 lines) ──
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
