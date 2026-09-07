#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [--port PORT]
       ./deploy.sh [PORT]

Options:
  -p, --port PORT  Port to bind the local server to.
  -h, --help       Show this help message.

Environment:
  HOST             Bind host (default: 127.0.0.1)
  PORT             Default port when no CLI port is provided (default: 5000)
  FLASK_DEBUG      Enable Flask debug mode only for loopback binds (default: 0)
  VENV_DIR         Virtual environment path (default: ./.venv)
  PYTHON_BIN       Python interpreter used to create the virtual environment
EOF
}

CLI_PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      if [[ $# -lt 2 ]]; then
        echo "Error: $1 requires a port value." >&2
        usage >&2
        exit 1
      fi
      CLI_PORT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Error: unknown option '$1'." >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$CLI_PORT" ]]; then
        echo "Error: multiple port values provided." >&2
        usage >&2
        exit 1
      fi
      CLI_PORT="$1"
      shift
      ;;
  esac
done

if [[ -n "$CLI_PORT" ]] && [[ ! "$CLI_PORT" =~ ^[0-9]+$ ]]; then
  echo "Error: port must be a positive integer." >&2
  exit 1
fi

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
FLASK_DEBUG="${FLASK_DEBUG:-0}"

if [[ -n "$CLI_PORT" ]]; then
  PORT="$CLI_PORT"
fi

DEBUG_NORMALIZED="$(printf '%s' "$FLASK_DEBUG" | tr '[:upper:]' '[:lower:]')"
if [[ "$DEBUG_NORMALIZED" =~ ^(1|true|yes|on)$ ]]; then
  DEBUG_ENABLED=1
else
  DEBUG_ENABLED=0
fi

if [[ "$DEBUG_ENABLED" -eq 1 ]] && [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" && "$HOST" != "::1" ]]; then
  echo "Error: FLASK_DEBUG may only be used with loopback hosts (127.0.0.1, localhost, or ::1)." >&2
  exit 1
fi

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

if [[ "$DEBUG_ENABLED" -eq 1 ]]; then
  echo "Starting local debug server at http://$HOST:$PORT"
else
  echo "Starting local server at http://$HOST:$PORT"
fi
exec env HOST="$HOST" PORT="$PORT" FLASK_DEBUG="$FLASK_DEBUG" "$VENV_DIR/bin/python" "$SCRIPT_DIR/app.py"
