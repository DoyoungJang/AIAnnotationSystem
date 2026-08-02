#!/usr/bin/env bash
set -Eeuo pipefail

# -----------------------------------------------------------------------------
# SonoLabel Ubuntu settings. Edit these defaults or override them as environment
# variables, for example: API_PORT=9000 WEB_PORT=3000 ./scripts/start-ubuntu.sh
# -----------------------------------------------------------------------------
API_HOST="${API_HOST:-127.0.0.1}"
API_PROXY_HOST="${API_PROXY_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8000}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_PORT="${WEB_PORT:-5173}"
PORT_CONFLICT_MODE="${PORT_CONFLICT_MODE:-next-available}" # next-available or fail
INSTALL_MODE="${INSTALL_MODE:-auto}" # auto, always, or never
SECRET_KEY="${SECRET_KEY:-change-this-local-development-secret-key}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeThisBeforeUse123!}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
VENV_MARKER="$VENV_DIR/.sonolabel-ready"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
DATABASE_URL="${DATABASE_URL:-sqlite:///$BACKEND_DIR/sonolabel.db}"
STORAGE_ROOT="${STORAGE_ROOT:-$ROOT_DIR/storage}"
EXPORT_ROOT="${EXPORT_ROOT:-$ROOT_DIR/exports}"

for command_name in python3 npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    exit 1
  fi
done

install_python=false
install_frontend=false
case "${INSTALL_MODE,,}" in
  always) install_python=true; install_frontend=true ;;
  auto)
    [[ -x "$VENV_DIR/bin/python" && -f "$VENV_MARKER" ]] || install_python=true
    [[ -d "$FRONTEND_DIR/node_modules" ]] || install_frontend=true
    ;;
  never) ;;
  *) echo "INSTALL_MODE must be auto, always, or never." >&2; exit 1 ;;
esac

if [[ "$install_python" == true ]]; then
  echo "[setup] Creating Python environment and installing backend dependencies..."
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/python" -m pip install -e "$BACKEND_DIR"
  touch "$VENV_MARKER"
fi

if [[ ! -x "$VENV_DIR/bin/python" || ! -f "$VENV_MARKER" ]]; then
  echo "Python environment is missing. Set INSTALL_MODE=auto or always." >&2
  exit 1
fi

if [[ "$install_frontend" == true ]]; then
  echo "[setup] Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm ci)
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Frontend dependencies are missing. Set INSTALL_MODE=auto or always." >&2
  exit 1
fi

port_available() {
  python3 - "$1" <<'PY'
import socket
import sys

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    sock.bind(("0.0.0.0", int(sys.argv[1])))
except OSError:
    raise SystemExit(1)
finally:
    sock.close()
PY
}

resolve_port() {
  local preferred="$1"
  local service_name="$2"
  local excluded="${3:-}"
  local candidate
  if [[ "$preferred" != "$excluded" ]] && port_available "$preferred"; then
    echo "$preferred"
    return
  fi
  if [[ "${PORT_CONFLICT_MODE,,}" == "fail" ]]; then
    echo "$service_name port $preferred is already in use. Change the port or set PORT_CONFLICT_MODE=next-available." >&2
    exit 1
  fi
  if [[ "${PORT_CONFLICT_MODE,,}" != "next-available" ]]; then
    echo "PORT_CONFLICT_MODE must be next-available or fail." >&2
    exit 1
  fi
  for ((candidate = preferred + 1; candidate <= 65535; candidate++)); do
    if [[ "$candidate" != "$excluded" ]] && port_available "$candidate"; then
      echo "[port] $service_name port $preferred is unavailable; using $candidate instead." >&2
      echo "$candidate"
      return
    fi
  done
  echo "No available port was found for $service_name after $preferred." >&2
  exit 1
}

API_PORT="$(resolve_port "$API_PORT" "API")"
WEB_PORT="$(resolve_port "$WEB_PORT" "Web" "$API_PORT")"

export APP_ENV="development"
export DATABASE_URL SECRET_KEY STORAGE_ROOT EXPORT_ROOT ADMIN_USERNAME ADMIN_PASSWORD
export CORS_ORIGINS="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT"
export SONOLABEL_API_TARGET="http://$API_PROXY_HOST:$API_PORT"

echo "[setup] Applying database migrations..."
(cd "$BACKEND_DIR" && "$VENV_DIR/bin/python" -m alembic -c alembic.ini upgrade head)

api_pid=""
web_pid=""
cleanup() {
  trap - EXIT INT TERM
  echo
  echo "[stop] Stopping SonoLabel servers..."
  [[ -n "$web_pid" ]] && kill "$web_pid" 2>/dev/null || true
  [[ -n "$api_pid" ]] && kill "$api_pid" 2>/dev/null || true
  wait "$web_pid" "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[start] API: http://localhost:$API_PORT/docs"
echo "[start] Web: http://localhost:$WEB_PORT"
echo "[start] Press Ctrl+C to stop both servers."

(cd "$BACKEND_DIR" && exec "$VENV_DIR/bin/python" -m uvicorn app.main:app --host "$API_HOST" --port "$API_PORT") &
api_pid=$!
(cd "$FRONTEND_DIR" && exec "$FRONTEND_DIR/node_modules/.bin/vite" --host "$WEB_HOST" --port "$WEB_PORT" --strictPort) &
web_pid=$!

wait -n "$api_pid" "$web_pid"
echo "One of the servers stopped unexpectedly." >&2
exit 1
