#!/bin/sh
# Starts ClamAV beside the API, then the API.
#
#   1. Refresh the virus definitions once (freshclam), so a restart never starts on stale ones.
#   2. Keep them fresh: freshclam runs as a daemon and checks 4 times a day (every 6 hours).
#   3. Start clamd, which the API talks to on 127.0.0.1:3310.
#   4. Wait (up to CLAMAV_WAIT_SECONDS, default 240) until clamd answers PING, then start the API.
#
# freshclam and clamd each run in a small loop, so one that exits is started again. The API refuses uploads
# while clamd is down (it fails closed), so a restart in the middle of the day only costs a "try again shortly".
#
# VIRUS_SCAN_ENABLED=false skips all of this and just starts the API. CLAMAV_DB_DIR puts the definitions on a
# persistent disk so a restart does not download them again (Render: /var/data/clamav-db).
set -u

flag="$(printf '%s' "${VIRUS_SCAN_ENABLED:-true}" | tr 'A-Z' 'a-z')"
if [ "$flag" = "false" ] || [ "$flag" = "0" ]; then
  echo "[clamav] virus scanning is turned off (VIRUS_SCAN_ENABLED=$flag); not starting ClamAV"
  exec "$@"
fi

DB_DIR="${CLAMAV_DB_DIR:-/var/lib/clamav}"
WAIT_SECONDS="${CLAMAV_WAIT_SECONDS:-240}"
CLAMD_CONF=/tmp/clamd.conf
FRESHCLAM_CONF=/tmp/freshclam.conf

mkdir -p "$DB_DIR" /run/clamav
chown -R clamav:clamav "$DB_DIR" /run/clamav 2>/dev/null || true

cat > "$CLAMD_CONF" <<EOF
DatabaseDirectory $DB_DIR
TCPSocket 3310
TCPAddr ${CLAMD_BIND_ADDRESS:-127.0.0.1}
User clamav
Foreground yes
# Largest file the API will send is 50 MB (the Admin import); 25 MB for everything else.
StreamMaxLength 64M
MaxFileSize 64M
MaxScanSize 256M
MaxThreads 4
# Pick up new definitions that freshclam wrote.
SelfCheck 600
EOF

cat > "$FRESHCLAM_CONF" <<EOF
DatabaseDirectory $DB_DIR
DatabaseOwner clamav
DatabaseMirror database.clamav.net
Checks 4
EOF

have_definitions() {
  ls "$DB_DIR"/main.c[lv]d "$DB_DIR"/daily.c[lv]d >/dev/null 2>&1 || ls "$DB_DIR"/*.cvd "$DB_DIR"/*.cld >/dev/null 2>&1
}

# First start on an empty disk: begin from the definitions baked into the image, then update them.
if ! have_definitions && [ "$DB_DIR" != "/var/lib/clamav" ]; then
  cp /var/lib/clamav/*.c[lv]d "$DB_DIR"/ 2>/dev/null || true
  chown -R clamav:clamav "$DB_DIR" 2>/dev/null || true
fi

attempt=1
while [ "$attempt" -le 3 ]; do
  if freshclam --config-file="$FRESHCLAM_CONF" --foreground 2>&1 | sed 's/^/[freshclam] /'; then break; fi
  echo "[clamav] definitions update attempt $attempt did not finish"
  attempt=$((attempt + 1))
  sleep 10
done

# Updates every 6 hours. If it ever exits, start it again a minute later.
(
  while true; do
    freshclam --config-file="$FRESHCLAM_CONF" --daemon --foreground 2>&1 | sed 's/^/[freshclam] /'
    sleep 60
  done
) &

# clamd cannot start without definitions. Until freshclam has fetched some, check again every few seconds.
(
  while true; do
    if have_definitions; then
      clamd --config-file="$CLAMD_CONF" 2>&1 | sed 's/^/[clamd] /'
    fi
    sleep 5
  done
) &

echo "[clamav] waiting up to ${WAIT_SECONDS}s for clamd"
waited=0
until [ "$(printf 'zPING\0' | nc -w 2 127.0.0.1 3310 2>/dev/null | tr -d '\0')" = "PONG" ]; do
  if [ "$waited" -ge "$WAIT_SECONDS" ]; then
    echo "[clamav] clamd is not answering yet; starting the API anyway. Uploads are refused until it is up."
    break
  fi
  sleep 2
  waited=$((waited + 2))
done
[ "$waited" -lt "$WAIT_SECONDS" ] && echo "[clamav] clamd is ready after ${waited}s"

exec "$@"
