#!/usr/bin/env bash
# Restores a backup made by backup.sh into the configured database and data dir. Stop the server first.
#   usage: restore.sh <stamp>        e.g. restore.sh 20260923-033000 (see ls $AIWS_BACKUP_DIR)
# Same environment as backup.sh. The target database must exist; its objects are replaced.
set -euo pipefail
: "${AIWS_BACKUP_DIR:?AIWS_BACKUP_DIR is required}"
STAMP="${1:?usage: restore.sh <stamp>}"
URL="${AIWS_DATABASE_URL:-postgres://aiws@127.0.0.1:${AIWS_PG_PORT:-54329}/${AIWS_DB:-aiws}}"
DATA="${AIWS_DATA_DIR:-.aiws-dev/data}"
DUMP="$AIWS_BACKUP_DIR/aiws-$STAMP.dump"
FILES="$AIWS_BACKUP_DIR/attachments-$STAMP.tar.gz"

[ -f "$DUMP" ] || { echo "no backup $DUMP" >&2; exit 1; }
pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$URL" "$DUMP"
if [ -f "$FILES" ]; then
  mkdir -p "$DATA"
  rm -rf "$DATA/attachments"
  tar -xzf "$FILES" -C "$DATA"
fi
echo "restored $STAMP"
