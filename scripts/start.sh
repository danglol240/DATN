#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=$HOME/.edr/log
PID_DIR=$HOME/.edr/run
PROJECT=/home/danglol240/Desktop/files

mkdir -p "$LOG_DIR" "$PID_DIR"

echo "$(date) Starting services..."

# BACKEND
(
  NODE_BIN=$(command -v node || command -v nodejs || true)
  if [ -n "$NODE_BIN" ]; then
    if [ -f "$PID_DIR/backend.pid" ] && kill -0 $(cat "$PID_DIR/backend.pid") 2>/dev/null; then
      echo "Backend already running"
    else
      cd "$PROJECT/backend" || exit 1
      echo "$(date) Starting backend..." >> "$LOG_DIR/backend.log"
      nohup "$NODE_BIN" server.js >> "$LOG_DIR/backend.log" 2>&1 &
      echo $! > "$PID_DIR/backend.pid"
    fi
  fi
)

# AGENT
(
  cd "$PROJECT/agent" || exit 1
  echo "$(date) Starting agent..." >> "$LOG_DIR/agent.log"

  if [ -x "venv/bin/python3" ]; then
    .venv/bin/python3 -m pip install -r requirements.txt >/dev/null 2>&1 || true
    nohup venv/bin/python3 main.py >> "$LOG_DIR/agent.log" 2>&1 &
  else
    nohup python3 main.py >> "$LOG_DIR/agent.log" 2>&1 &
  fi

  echo $! > "$PID_DIR/agent.pid"
)

# FRONTEND
(
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

  NPM_BIN=$(command -v npm || true)

  if [ -n "$NPM_BIN" ]; then
    cd "$PROJECT/dashboard" || exit 1
    echo "$(date) Starting frontend..." >> "$LOG_DIR/frontend.log"
    nohup "$NPM_BIN" run dev >> "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$PID_DIR/frontend.pid"
  else
    echo "$(date) [ERROR] npm not found in PATH; skipping frontend start" >> "$LOG_DIR/frontend.log"
  fi
)

# MONITOR STACK (Prometheus + Grafana + Redis Exporter)
(
  if command -v docker >/dev/null 2>&1; then
    cd "$PROJECT/monitor" || exit 1
    echo "$(date) Starting monitor stack..." >> "$LOG_DIR/monitor.log"
    docker compose up -d >> "$LOG_DIR/monitor.log" 2>&1
  else
    echo "$(date) [SKIP] docker not found; skipping monitor stack" >> "$LOG_DIR/monitor.log"
  fi
)

echo "All services started"