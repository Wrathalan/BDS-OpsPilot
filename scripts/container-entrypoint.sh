#!/bin/sh
set -eu

APP_PID=
HBBS_PID=
HBBR_PID=

stop_children() {
  trap - EXIT INT TERM
  for pid in "$APP_PID" "$HBBS_PID" "$HBBR_PID"; do
    if [ -n "$pid" ]; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$APP_PID" "$HBBS_PID" "$HBBR_PID"; do
    if [ -n "$pid" ]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -f /tmp/opspilot-app.pid /tmp/opspilot-hbbs.pid /tmp/opspilot-hbbr.pid
}

trap 'stop_children; exit 143' TERM
trap 'stop_children; exit 130' INT
trap stop_children EXIT

mkdir -p /data /rustdesk

cd /app
gosu node npm run db:sync

cd /rustdesk
HOME=/rustdesk env -u PORT /usr/local/bin/hbbs -r "${RUSTDESK_RELAY_SERVER:-127.0.0.1:21117}" &
HBBS_PID=$!
printf '%s\n' "$HBBS_PID" > /tmp/opspilot-hbbs.pid

HOME=/rustdesk env -u PORT /usr/local/bin/hbbr &
HBBR_PID=$!
printf '%s\n' "$HBBR_PID" > /tmp/opspilot-hbbr.pid

cd /app
gosu node npm start &
APP_PID=$!
printf '%s\n' "$APP_PID" > /tmp/opspilot-app.pid

while :; do
  for process in "app:$APP_PID" "RustDesk ID server:$HBBS_PID" "RustDesk relay:$HBBR_PID"; do
    name=${process%%:*}
    pid=${process##*:}
    if ! kill -0 "$pid" 2>/dev/null; then
      status=0
      wait "$pid" || status=$?
      printf '%s exited unexpectedly with status %s.\n' "$name" "$status" >&2
      exit "$status"
    fi
  done
  sleep 2 &
  wait $! || true
done
