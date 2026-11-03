#!/usr/bin/env bash
# Daily backup (spec §14): PostgreSQL custom-format dump + attachments tarball, newest of each of the last 7 days kept.
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

# Deploys also take backups, so several can land on one day; keep the newest of each of the last $KEEP days.
# Stamps sort chronologically.
for pattern in 'gonggong-*.dump' 'attachments-*.tar.gz'; do
  days=0
  last=''
  find "$GONGGONG_BACKUP_DIR" -maxdepth 1 -name "$pattern" | sort -r | while read -r file; do
    day="$(basename "$file" | grep -oE '[0-9]{8}-' | head -1)"
    if [ "$day" != "$last" ] && [ "$days" -lt "$KEEP" ]; then
      last="$day"
      days=$((days + 1))
    else
      rm -f "$file"
    fi
  done
done
echo "backup written: $GONGGONG_BACKUP_DIR/gonggong-$STAMP.dump"
