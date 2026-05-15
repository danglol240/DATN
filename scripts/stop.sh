#!/usr/bin/env bash
set -euo pipefail

PID_DIR=$HOME/.edr/run

stop_pidfile() {
  local name=$1
  local f="$PID_DIR/$name.pid"

  if [ -f "$f" ]; then
    pid=$(cat "$f" 2>/dev/null || true)

    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1

      # force kill nếu chưa chết
      if kill -0 "$pid" 2>/dev/null; then
        echo "Force killing $name..."
        kill -9 "$pid" 2>/dev/null || true
      fi
    else
      echo "$name not running"
    fi

    rm -f "$f"
  else
    echo "No PID file for $name"
  fi
}

# stop theo PID file (ưu tiên)
stop_pidfile backend
stop_pidfile agent
stop_pidfile frontend

# fallback (an toàn hơn)
pkill -f "server.js" >/dev/null 2>&1 || true
pkill -f "agent/main.py" >/dev/null 2>&1 || true
pkill -f "npm run dev" >/dev/null 2>&1 || true

echo "All services stopped"