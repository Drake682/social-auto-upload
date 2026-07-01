#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export FLASK_PORT="${FLASK_PORT:-5000}"

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p /app/error_logs /app/videoFile /app/cookiesFile

Xvfb "$DISPLAY" -screen 0 1280x800x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

sleep 1

fluxbox >/tmp/fluxbox.log 2>&1 &
FLUXBOX_PID=$!

x11vnc -display "$DISPLAY" -nopw -listen localhost -xkb -forever -shared >/tmp/x11vnc.log 2>&1 &
X11VNC_PID=$!

/usr/share/novnc/utils/launch.sh --vnc localhost:5900 --listen 8080 >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!

echo "Xvfb started pid=${XVFB_PID} display=${DISPLAY}"
echo "fluxbox started pid=${FLUXBOX_PID}"
echo "x11vnc started pid=${X11VNC_PID} display=${DISPLAY}"
echo "noVNC started pid=${NOVNC_PID} url=http://0.0.0.0:8080/vnc.html"
echo "Starting Flask uploader on port ${FLASK_PORT}"

exec python sau_backend.py
