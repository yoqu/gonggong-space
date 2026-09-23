#!/usr/bin/env bash
# Project-local PostgreSQL cluster for dev/test (port 54329), never touches system services.
set -euo pipefail
# Git worktrees share the main checkout's cluster (one Postgres per machine on $PORT).
ROOT="$(cd "$(dirname "$0")/.." && cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
DATA="$ROOT/.aiws-dev/pg"
PORT="${AIWS_PG_PORT:-54329}"
case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      mkdir -p "$DATA"
      initdb -D "$DATA" -U aiws --auth=trust -E UTF8 >/dev/null
    fi
    if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
      pg_ctl -D "$DATA" -l "$ROOT/.aiws-dev/pg.log" -o "-p $PORT -k /tmp" -w start >/dev/null
    fi
    for db in aiws aiws_test; do
      psql -h /tmp -p "$PORT" -U aiws -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || createdb -h /tmp -p "$PORT" -U aiws "$db"
    done
    echo "postgres ready on :$PORT"
    ;;
  reset)
    # Recreate a throwaway database, e.g. `pg.sh reset aiws_e2e`.
    "$0" start >/dev/null
    dropdb -h /tmp -p "$PORT" -U aiws --if-exists --force "$2"
    createdb -h /tmp -p "$PORT" -U aiws "$2"
    ;;
  stop) pg_ctl -D "$DATA" -w stop >/dev/null && echo stopped ;;
  *) echo "usage: pg.sh start|stop"; exit 1 ;;
esac
