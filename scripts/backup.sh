#!/usr/bin/env bash
# Daily backup (spec §14): PostgreSQL custom-format dump + attachments tarball, newest 7 of each kept.
#   AIWS_BACKUP_DIR   where backups go (required)
#   AIWS_DATABASE_URL or AIWS_DB / AIWS_PG_PORT   same resolution as the server
#   AIWS_DATA_DIR     server data dir holding attachments/ (default .aiws-dev/data)
# Cron example (03:30 every day):
#   30 3 * * * AIWS_BACKUP_DIR=/var/backups/aiws AIWS_DATA_DIR=/srv/aiws/data /srv/aiws/scripts/backup.sh >> /var/log/aiws-backup.log 2>&1
set -euo pipefail
: "${AIWS_BACKUP_DIR:?AIWS_BACKUP_DIR is required}"
URL="${AIWS_DATABASE_URL:-postgres://aiws@127.0.0.1:${AIWS_PG_PORT:-54329}/${AIWS_DB:-aiws}}"
DATA="${AIWS_DATA_DIR:-.aiws-dev/data}"
KEEP=7
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$AIWS_BACKUP_DIR"
pg_dump --format=custom --no-owner --file="$AIWS_BACKUP_DIR/aiws-$STAMP.dump.part" "$URL"
mv "$AIWS_BACKUP_DIR/aiws-$STAMP.dump.part" "$AIWS_BACKUP_DIR/aiws-$STAMP.dump"
if [ -d "$DATA/attachments" ]; then
  tar -czf "$AIWS_BACKUP_DIR/attachments-$STAMP.tar.gz.part" -C "$DATA" attachments
  mv "$AIWS_BACKUP_DIR/attachments-$STAMP.tar.gz.part" "$AIWS_BACKUP_DIR/attachments-$STAMP.tar.gz"
fi

# Stamps sort chronologically; drop everything but the newest $KEEP of each kind.
for pattern in 'aiws-*.dump' 'attachments-*.tar.gz'; do
  find "$AIWS_BACKUP_DIR" -maxdepth 1 -name "$pattern" | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old"
  done
done
echo "backup written: $AIWS_BACKUP_DIR/aiws-$STAMP.dump"
