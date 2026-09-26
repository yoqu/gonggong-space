#!/usr/bin/env bash
# Project-local PostgreSQL cluster for dev/test (port 54329), never touches system services.
set -euo pipefail
# Git worktrees share the main checkout's cluster (one Postgres per machine on $PORT).
ROOT="$(cd "$(dirname "$0")/.." && cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
DATA="$ROOT/.gonggong-dev/pg"
PORT="${GONGGONG_PG_PORT:-54329}"
# Postgres.app and Homebrew's keg-only postgresql@N don't put their bin on PATH.
if ! command -v pg_ctl >/dev/null; then
  candidates=(/Applications/Postgres.app/Contents/Versions/latest/bin)
  command -v brew >/dev/null && candidates+=("$(brew --prefix)"/opt/postgresql@*/bin)
  for dir in "${candidates[@]}"; do
    [ -x "$dir/pg_ctl" ] && PATH="$dir:$PATH" && break
  done
fi
if ! command -v pg_ctl >/dev/null; then
  echo "PostgreSQL not found: install it first (macOS: Postgres.app or brew install postgresql@17; Debian/Ubuntu: sudo apt install postgresql and add /usr/lib/postgresql/<N>/bin to PATH)" >&2
  exit 1
fi
case "${1:-start}" in
  start)
    # A failed first initdb leaves an empty directory behind; PG_VERSION marks a real cluster.
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"
      initdb -D "$DATA" -U gonggong --auth=trust -E UTF8 >/dev/null
    fi
    if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
      pg_ctl -D "$DATA" -l "$ROOT/.gonggong-dev/pg.log" -o "-p $PORT -k /tmp" -w start >/dev/null
    fi
    for db in gonggong gonggong_test; do
      psql -h /tmp -p "$PORT" -U gonggong -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || createdb -h /tmp -p "$PORT" -U gonggong "$db"
    done
    echo "postgres ready on :$PORT"
    ;;
  reset)
    # Recreate a throwaway database, e.g. `pg.sh reset gonggong_e2e`.
    "$0" start >/dev/null
    dropdb -h /tmp -p "$PORT" -U gonggong --if-exists --force "$2"
    createdb -h /tmp -p "$PORT" -U gonggong "$2"
    ;;
  stop) pg_ctl -D "$DATA" -w stop >/dev/null && echo stopped ;;
  *) echo "usage: pg.sh start|stop"; exit 1 ;;
esac
