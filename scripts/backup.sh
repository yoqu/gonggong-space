#!/usr/bin/env bash
# Daily backup (spec §14): PostgreSQL custom-format dump + attachments tarball, newest 7 of each kept.
#   GONGGONG_BACKUP_DIR   where backups go (required)
#   GONGGONG_DATABASE_URL or GONGGONG_DB / GONGGONG_PG_PORT   same resolution as the server
#   GONGGONG_DATA_DIR     server data dir holding attachments/ (default .gonggong-dev/data)
# Cron example (03:30 every day):
#   30 3 * * * GONGGONG_BACKUP_DIR=/var/backups/gg GONGGONG_DATA_DIR=/srv/gonggong/data /srv/gonggong/scripts/backup.sh >> /var/log/gonggong-backup.log 2>&1
set -euo pipefail
: "${GONGGONG_BACKUP_DIR:?GONGGONG_BACKUP_DIR is required}"
URL="${GONGGONG_DATABASE_URL:-postgres://gonggong@127.0.0.1:${GONGGONG_PG_PORT:-54329}/${GONGGONG_DB:-gonggong}}"
DATA="${GONGGONG_DATA_DIR:-.gonggong-dev/data}"
KEEP=7
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$GONGGONG_BACKUP_DIR"
pg_dump --format=custom --no-owner --file="$GONGGONG_BACKUP_DIR/gonggong-$STAMP.dump.part" "$URL"
mv "$GONGGONG_BACKUP_DIR/gonggong-$STAMP.dump.part" "$GONGGONG_BACKUP_DIR/gonggong-$STAMP.dump"
if [ -d "$DATA/attachments" ]; then
  tar -czf "$GONGGONG_BACKUP_DIR/attachments-$STAMP.tar.gz.part" -C "$DATA" attachments
  mv "$GONGGONG_BACKUP_DIR/attachments-$STAMP.tar.gz.part" "$GONGGONG_BACKUP_DIR/attachments-$STAMP.tar.gz"
fi

# Stamps sort chronologically; drop everything but the newest $KEEP of each kind.
for pattern in 'gonggong-*.dump' 'attachments-*.tar.gz'; do
  find "$GONGGONG_BACKUP_DIR" -maxdepth 1 -name "$pattern" | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old"
  done
done
echo "backup written: $GONGGONG_BACKUP_DIR/gonggong-$STAMP.dump"
