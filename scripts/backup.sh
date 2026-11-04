#!/usr/bin/env bash
# Daily backup (spec §14): PostgreSQL custom-format dump + attachments tarball, newest 7 plus the newest of each of the last 7 backup days kept.
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

# Deploys also take backups, so a day can hold several. Keep the newest $KEEP (so recent pre-deploy snapshots
# survive the same day's later runs) plus the newest of each of the last $KEEP days that have backups.
# Dumps decide which stamps stay, so a kept dump never loses its attachments; files not named by this script are left alone.
kept=' '
n=0
days=0
last=''
while read -r stamp; do
  n=$((n + 1))
  newest=0
  if [ "${stamp%-*}" != "$last" ]; then
    last="${stamp%-*}"
    days=$((days + 1))
    newest=1
  fi
  if [ "$n" -le "$KEEP" ] || { [ "$newest" = 1 ] && [ "$days" -le "$KEEP" ]; }; then
    kept="$kept$stamp "
  fi
done < <(find "$GONGGONG_BACKUP_DIR" -maxdepth 1 -name 'gonggong-*.dump' |
  sed -nE 's#.*/gonggong-([0-9]{8}-[0-9]{6})\.dump$#\1#p' | sort -r)
find "$GONGGONG_BACKUP_DIR" -maxdepth 1 \( -name 'gonggong-*.dump' -o -name 'attachments-*.tar.gz' \) | while read -r file; do
  stamp="$(basename "$file" | sed -nE 's/^(gonggong|attachments)-([0-9]{8}-[0-9]{6})\.(dump|tar\.gz)$/\2/p')"
  if [ -n "$stamp" ] && [[ "$kept" != *" $stamp "* ]]; then
    rm -f "$file"
  fi
done
echo "backup written: $GONGGONG_BACKUP_DIR/gonggong-$STAMP.dump"
