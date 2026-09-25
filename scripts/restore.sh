#!/usr/bin/env bash
# Restores a backup made by backup.sh into the configured database and data dir. Stop the server first.
#   usage: restore.sh <stamp>        e.g. restore.sh 20260923-033000 (see ls $GONGGONG_BACKUP_DIR)
# Same environment as backup.sh. The target database must exist; its objects are replaced.
set -euo pipefail
: "${GONGGONG_BACKUP_DIR:?GONGGONG_BACKUP_DIR is required}"
STAMP="${1:?usage: restore.sh <stamp>}"
URL="${GONGGONG_DATABASE_URL:-postgres://gonggong@127.0.0.1:${GONGGONG_PG_PORT:-54329}/${GONGGONG_DB:-gonggong}}"
DATA="${GONGGONG_DATA_DIR:-.gonggong-dev/data}"
DUMP="$GONGGONG_BACKUP_DIR/gonggong-$STAMP.dump"
FILES="$GONGGONG_BACKUP_DIR/attachments-$STAMP.tar.gz"

[ -f "$DUMP" ] || { echo "no backup $DUMP" >&2; exit 1; }
pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$URL" "$DUMP"
if [ -f "$FILES" ]; then
  mkdir -p "$DATA"
  rm -rf "$DATA/attachments"
  tar -xzf "$FILES" -C "$DATA"
fi
echo "restored $STAMP"
