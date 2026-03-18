#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="${PYTHON_BIN:-$(command -v python)}"
else
  echo "Error: python3 or python is required." >&2
  exit 1
fi

VENV_DIR="${VENV_DIR:-$SCRIPT_DIR/.venv}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5000}"

if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating virtual environment at $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

if [[ ! -f "$VENV_DIR/.requirements-installed" ]] || [[ requirements.txt -nt "$VENV_DIR/.requirements-installed" ]]; then
  echo "Installing dependencies from requirements.txt"
  "$VENV_DIR/bin/python" -m pip install -r requirements.txt
  touch "$VENV_DIR/.requirements-installed"
else
  echo "Using existing virtualenv dependencies from $VENV_DIR"
fi

echo "Starting local server at http://$HOST:$PORT"
exec env HOST="$HOST" PORT="$PORT" "$VENV_DIR/bin/python" - <<'PY'
import os

from app import app, socketio

host = os.environ.get("HOST", "127.0.0.1")
port = int(os.environ.get("PORT", "5000"))

socketio.run(
    app,
    host=host,
    port=port,
    debug=True,
    use_reloader=False,
    allow_unsafe_werkzeug=True,
)
PY
