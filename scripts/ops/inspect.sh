#!/usr/bin/env bash
# Weekly read-only inspection of a production server: prints a Markdown report to stdout.
# Run as root on the server. Reads connection settings from the server env file; never writes to the database.
#   GG_ENV_FILE      server env (default /etc/gonggong/server.env)
#   GG_UNIT          systemd unit (default gonggong)
#   GG_BACKUP_DIR    backups from backup.sh (default /var/backups/gonggong)
#   GG_NGINX_LOG     nginx access log of the public site (optional; skipped when missing)
#   GG_PSQL          psql binary (default: psql on PATH)
#   GG_SINCE         log window (default "7 days ago")
#   GG_STATE_DIR     where the previous snapshot is kept (default /var/lib/gonggong-inspect)
set -uo pipefail
ENV_FILE="${GG_ENV_FILE:-/etc/gonggong/server.env}"
UNIT="${GG_UNIT:-gonggong}"
BACKUP_DIR="${GG_BACKUP_DIR:-/var/backups/gonggong}"
NGINX_LOG="${GG_NGINX_LOG:-}"
PSQL="${GG_PSQL:-psql}"
SINCE="${GG_SINCE:-7 days ago}"
STATE_DIR="${GG_STATE_DIR:-/var/lib/gonggong-inspect}"
set -a; . "$ENV_FILE"; set +a
DATA="${GONGGONG_DATA_DIR:?}"
mkdir -p "$STATE_DIR"
PREV="$STATE_DIR/last.env"
[ -f "$PREV" ] && . "$PREV" 2>/dev/null
NOW_STATE=""
keep() { NOW_STATE+="$1=$2"$'\n'; }
delta() {
  local prev="${!1:-}"
  [ -n "$prev" ] && echo " (上次 ${INSPECTED_AT:-时间未知}：$prev)"
}
sql() { "$PSQL" "$GONGGONG_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -P pager=off "$@"; }

keep INSPECTED_AT "$(date '+%FT%T%z')"
echo "# 共工线上巡检 $(date '+%F %T %Z')"

echo; echo "## 服务"
systemctl show "$UNIT" -p ActiveState -p SubState -p NRestarts -p ActiveEnterTimestamp -p MemoryCurrent | sed 's/^/- /'
health=$(curl -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 10 "${GONGGONG_PUBLIC_URL}/api/health")
echo "- 公网健康检查 /api/health：$health"
starts=$(journalctl -u "$UNIT" --since "$SINCE" --no-pager -o cat | grep -c '^Started \|Started Gonggong' || true)
echo "- 窗口内启动次数（含部署）：$starts"

echo; echo "## 日志（$SINCE 起）"
LOG=$(mktemp); trap 'rm -f "$LOG"' EXIT
journalctl -u "$UNIT" --since "$SINCE" --no-pager -o cat > "$LOG"
errors=$(grep -c '^\[error\]' "$LOG" || true)
warns=$(grep -c '^\[warn\]' "$LOG" || true)
keep LOG_ERRORS "$errors"
echo "- [error] $errors 条$(delta LOG_ERRORS)，[warn] $warns 条"
echo "- 错误归类 Top 10（取 message/msg/首行）："
awk '/^\[(error|warn)\]/{lvl=$1; first=$0; sig=""; n=0; next}
     lvl!="" && n<15 {n++; if (match($0,/msg: .*/)) sig=substr($0,RSTART,120); else if (sig=="" && match($0,/(message|code): .*/)) sig=substr($0,RSTART,120)}
     lvl!="" && (n>=15 || /^\]/) {if (sig=="") sig=substr(first,1,120); print lvl" "sig; lvl=""}' "$LOG" \
  | sed -E 's/[0-9a-f]{8}-[0-9a-f-]{27}/<uuid>/g' | sort | uniq -c | sort -rn | head -10 | sed 's/^/    /'
fatal=$(grep -cE 'uncaughtException|unhandledRejection|FATAL|JavaScript heap out of memory|ECONNREFUSED.*5432|too many clients' "$LOG" || true)
gitfail=$(grep -c '^fatal: ' "$LOG" || true)
echo "- 崩溃/致命类关键字：$fatal；git 失败（fatal:）：$gitfail"

if [ -n "$NGINX_LOG" ] && [ -f "$NGINX_LOG" ]; then
  echo; echo "## 网关（最近 7 天，$NGINX_LOG）"
  cutoff=$(date -d '7 days ago' '+%s')
  NG=$(mktemp); trap 'rm -f "$LOG" "$NG"' EXIT
  cat "$NGINX_LOG" "$NGINX_LOG.1" 2>/dev/null | awk -v c="$cutoff" '{
      split(substr($4,2),a,/[\/:]/); m=index("JanFebMarAprMayJunJulAugSepOctNovDec",a[2]);
      t=mktime(a[3]" "((m+2)/3)" "a[1]" "a[4]" "a[5]" "a[6]); if (t>=c) print }' > "$NG"
  total=$(wc -l < "$NG"); s5=$(awk '$9 ~ /^5/' "$NG" | wc -l)
  keep NGINX_5XX "$s5"
  echo "- 请求 $total，5xx $s5$(delta NGINX_5XX)"
  echo "- 5xx 路径 Top 5："
  awk '$9 ~ /^5/ {split($7,p,"?"); gsub(/[0-9a-f]{8}-[0-9a-f-]{27}/,"<id>",p[1]); print $9" "p[1]}' "$NG" | sort | uniq -c | sort -rn | head -5 | sed 's/^/    /'
fi

echo; echo "## 数据库"
db_bytes=$(sql -At -c "select pg_database_size(current_database())")
keep DB_BYTES "$db_bytes"
echo "- 库大小：$(numfmt --to=iec "$db_bytes")$(delta DB_BYTES | sed -E 's/([0-9]+)\)/\1 字节)/')"
sql -At -F ' | ' <<'SQL' | sed 's/^/- /'
begin transaction read only;
select 'connections ' || count(*) || ' / max ' || current_setting('max_connections') from pg_stat_activity;
select 'idle in transaction > 5min: ' || count(*) from pg_stat_activity where state like 'idle in transaction%' and now() - state_change > interval '5 minutes';
select 'queries running > 1min: ' || count(*) from pg_stat_activity where state = 'active' and now() - query_start > interval '1 minute' and pid <> pg_backend_pid();
select 'runs stuck (running/awaiting > 6h): ' || count(*) from runs where status in ('running','awaiting_approval','awaiting_answer') and coalesce(started_at, created_at) < now() - interval '6 hours';
select 'runs queued/offline_wait > 1d: ' || count(*) from runs where status in ('queued','offline_wait') and created_at < now() - interval '1 day';
select 'runs last 7d: ' || count(*) || ', interrupted ' || count(*) filter (where status = 'interrupted') || ', expired ' || count(*) filter (where status = 'expired') from runs where created_at > now() - interval '7 days';
select 'migrations applied: ' || count(*) from drizzle.__drizzle_migrations;
rollback;
SQL
echo "- 最大的 8 张表："
sql -At -F '|' <<'SQL' | awk -F'|' '{printf "    %-32s %s（死元组 %s）\n",$1,$2,$3}'
select relname, pg_size_pretty(pg_total_relation_size(relid)), n_dead_tup from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 8;
SQL

echo; echo "## 文件存储"
data_kb=$(du -sk "$DATA" | cut -f1)
keep DATA_KB "$data_kb"
echo "- 数据目录 $DATA：$(numfmt --to=iec $((data_kb * 1024)))$(delta DATA_KB | sed -E 's/([0-9]+)\)/\1 KB)/')"
du -sh "$DATA"/* 2>/dev/null | sort -rh | sed 's/^/    /'
echo "- 备份 $BACKUP_DIR："
latest=$(ls -t "$BACKUP_DIR"/gonggong-*.dump 2>/dev/null | head -1)
if [ -n "$latest" ]; then
  age_h=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))
  echo "    最新 $(basename "$latest")（$(du -h "$latest" | cut -f1)，${age_h} 小时前），共 $(ls "$BACKUP_DIR"/gonggong-*.dump | wc -l) 份，总 $(du -sh "$BACKUP_DIR" | cut -f1)"
  pg_restore --list "$latest" > /dev/null 2>&1 && echo "    最新 dump 可读（pg_restore --list 通过）" || echo "    ⚠ 最新 dump 读不出目录"
else
  echo "    ⚠ 没有找到备份"
fi
[ -f /var/log/gonggong-backup.log ] && echo "    备份日志最后一行：$(tail -1 /var/log/gonggong-backup.log)"

echo; echo "## 服务器资源"
echo "- 负载：$(cut -d' ' -f1-3 /proc/loadavg)，CPU $(nproc) 核，运行 $(uptime -p)"
free -h | awk 'NR==2{print "- 内存：已用 "$3" / "$2"，可用 "$7} NR==3{print "- Swap：已用 "$3" / "$2}'
root_pct=$(df --output=pcent / | tail -1 | tr -dc 0-9)
keep DISK_PCT "$root_pct"
echo "- 根分区：$(df -h --output=used,size,pcent / | tail -1)$(delta DISK_PCT)；inode $(df --output=ipcent / | tail -1)"
echo "- 内存占用 Top 5 进程："
ps -eo rss,comm --sort=-rss | head -6 | tail -5 | awk '{printf "    %s %dM\n",$2,$1/1024}'
host=$(echo "$GONGGONG_PUBLIC_URL" | sed -E 's#https?://([^/:]+).*#\1#')
exp=$(echo | timeout 10 openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
[ -n "$exp" ] && echo "- TLS 证书到期：$exp（剩 $(( ($(date -d "$exp" +%s) - $(date +%s)) / 86400 )) 天）"

printf '%s' "$NOW_STATE" > "$PREV"
