#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=/var/log/edr
PID_DIR=/var/run/edr
PROJECT=/home/danglol240/Desktop/files

# prepare dirs
sudo mkdir -p "$LOG_DIR" "$PID_DIR"
sudo chown "$(whoami)":"$(whoami)" "$LOG_DIR" "$PID_DIR"

# start backend
(
  NODE_BIN=$(command -v node || command -v nodejs || true)
  if [ -n "$NODE_BIN" ]; then
    cd "$PROJECT/backend"
    nohup "$NODE_BIN" server.js > "$LOG_DIR/backend.log" 2>&1 &
    echo $! > "$PID_DIR/backend.pid"
  else
    echo "$(date) [ERROR] node not found in PATH; skipping backend start" >> "$LOG_DIR/backend.log"
  fi
)

# start agent (venv + requirements if needed)
(
  cd "$PROJECT/agent"
  # prefer using the project's virtualenv if present
  if [ -x ".venv/bin/python3" ]; then
    # ensure venv has requirements
    .venv/bin/python3 -m pip install --upgrade pip setuptools wheel >/dev/null 2>&1 || true
    .venv/bin/python3 -m pip install -r requirements.txt >/dev/null 2>&1 || true
    nohup .venv/bin/python3 main.py > "$LOG_DIR/agent.log" 2>&1 &
    echo $! > "$PID_DIR/agent.pid"
  else
    nohup python3 main.py > "$LOG_DIR/agent.log" 2>&1 &
    echo $! > "$PID_DIR/agent.pid"
  fi
)

# start frontend (dashboard)
(
  NPM_BIN=$(command -v npm || true)
  if [ -n "$NPM_BIN" ]; then
    cd "$PROJECT/dashboard"
    nohup "$NPM_BIN" run dev > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$PID_DIR/frontend.pid"
  else
    echo "$(date) [ERROR] npm not found in PATH; skipping frontend start" >> "$LOG_DIR/frontend.log"
  fi
)

echo "started services"