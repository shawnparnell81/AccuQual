#!/usr/bin/env bash
# Restores the newest stored backup into a scratch PostgreSQL 17 and proves it matches the backup's manifest.
# Touches ONLY the scratch container: no production database is contacted (the backup store is read, nothing is written).
#
#   BACKUP_PASSPHRASE=... BACKUP_S3_BUCKET=... [BACKUP_S3_ENDPOINT=...] AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
#     bash ops/backup/restore-drill.sh [latest|<object key>] [daily|weekly|monthly]
#   (or BACKUP_LOCAL_DIR=<directory> in place of the bucket variables)
#
# Needs: docker, Node + `npm ci` already run in the repository (db:migrate and db:verify-restore are the repo's own scripts).
set -euo pipefail
export MSYS_NO_PATHCONV=1

TARGET="${1:-latest}"
TIER="${2:-daily}"
IMG="accuqual-backup:drill"
PG="accuqual-drill-pg-$$"
PORT="${DRILL_PG_PORT:-54399}"
PASS="drill-$(openssl rand -hex 8)"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
winpath() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }

cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
started=$(date +%s)

step "Building the backup tool image"
ROOT_W="$(winpath "$ROOT")"
docker build -q -f "$ROOT_W/ops/backup/Dockerfile" -t "$IMG" "$ROOT_W" >/dev/null

step "Downloading, decrypting and integrity-checking the backup ($TIER/$TARGET)"
mkdir -p "$WORK/out"
chmod 777 "$WORK/out"
MOUNTS=(-v "$(winpath "$WORK/out"):/out")
if [ -n "${BACKUP_LOCAL_DIR:-}" ]; then MOUNTS+=(-v "$BACKUP_LOCAL_DIR:/store" -e BACKUP_LOCAL_DIR=/store); fi
docker run --rm --user 0 "${MOUNTS[@]}" \
  -e BACKUP_PASSPHRASE -e BACKUP_S3_BUCKET -e BACKUP_S3_ENDPOINT -e BACKUP_PREFIX \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
  "$IMG" fetch "$TARGET" --tier "$TIER" --out /out

step "Starting a scratch PostgreSQL 17 (pgvector)"
docker run -d --name "$PG" -e POSTGRES_USER=drill -e POSTGRES_PASSWORD="$PASS" -p "$PORT:5432" pgvector/pgvector:pg17 >/dev/null
for _ in $(seq 1 60); do docker exec "$PG" pg_isready -U drill -d postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$PG" psql -U drill -d postgres -qc "create database restored" >/dev/null
docker exec "$PG" psql -U drill -d restored -qc "create extension if not exists vector" >/dev/null

step "Restoring"
restore_started=$(date +%s)
docker cp "$(winpath "$WORK/out")/accuqual.dump" "$PG:/tmp/a.dump"
docker exec "$PG" sh -c 'pg_restore -l /tmp/a.dump | grep -vE " SCHEMA - public| COMMENT - SCHEMA public" > /tmp/a.list; pg_restore --no-owner --no-privileges --exit-on-error -L /tmp/a.list -U drill -d restored /tmp/a.dump'
echo "restored in $(( $(date +%s) - restore_started ))s"

URL="postgres://drill:${PASS}@localhost:${PORT}/restored"

step "Recreating the application role, grants, security policies, audit triggers (db:migrate)"
(cd "$ROOT/services/api" && DATABASE_URL="$URL" DATABASE_SSL_CA= npm run --silent db:migrate 2>&1 | tail -3)

step "Verifying against the backup's manifest"
(cd "$ROOT/services/api" && DATABASE_URL="$URL" DATABASE_SSL_CA= MANIFEST_FILE="$(winpath "$WORK/out")/manifest.json" npm run --silent db:verify-restore)

echo
echo "DRILL PASSED in $(( $(date +%s) - started ))s — the newest backup restores and matches its manifest."
