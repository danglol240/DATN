#!/usr/bin/env bash
set -euo pipefail

PID_DIR=/var/run/edr

stop_pidfile() {
  local f=$1
  if [ -f "$f" ]; then
    pid=$(cat "$f" 2>/dev/null || true)
    if [ -n "$pid" ]; then sudo kill "$pid" >/dev/null 2>&1 || true; fi
    rm -f "$f"
  fi
}

stop_pidfile "$PID_DIR/backend.pid"
stop_pidfile "$PID_DIR/agent.pid"
stop_pidfile "$PID_DIR/frontend.pid"

# fallback kills by process pattern (safe-ignore failures)
# match the exact commands we start in start.sh
sudo pkill -f "node server.js" >/dev/null 2>&1 || true
sudo pkill -f "main.py" >/dev/null 2>&1 || true
sudo pkill -f "npm run dev" >/dev/null 2>&1 || true

echo "stopped services"