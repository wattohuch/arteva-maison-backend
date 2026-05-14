#!/bin/bash
# ARTÉVA Print Station — Watchdog
# Checks heartbeat file age and restarts service if stale.
# Installed as cron job by setup.sh

HEARTBEAT="/tmp/print-heartbeat"
MAX_AGE=60  # seconds

if [ ! -f "$HEARTBEAT" ]; then
  echo "$(date): No heartbeat file found, restarting..."
  systemctl restart arteva-print
  exit 0
fi

LAST=$(cat "$HEARTBEAT")
NOW=$(date +%s)
AGE=$(( NOW - LAST ))

if [ "$AGE" -gt "$MAX_AGE" ]; then
  echo "$(date): Heartbeat stale (${AGE}s), restarting..."
  systemctl restart arteva-print
fi
