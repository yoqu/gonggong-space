#!/usr/bin/env bash
# Regenerates website/public/screenshots/web/*.png against an isolated stack:
# database gonggong_docs, server :8795, web :5195, daemons with their own GONGGONG_HOME under $DOCS_DIR.
# Never touches the dev database, ~/.gonggong or processes it did not start.
# Usage: bash website/scripts/shots-web.sh [shot-name ...]   (SHOTS_KEEP=1 leaves the stack running afterwards)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DOCS_DIR="${DOCS_DIR:-/tmp/gg-docs}"
SERVER_PORT=8795
WEB_PORT=5195
export GG_DOCS_ADMIN_PASSWORD="${GG_DOCS_ADMIN_PASSWORD:-xinghe-init-2026}"
# The demo repo is shown under a plausible remote URL; git rewrites it to the local bare repo everywhere.
export GG_DOCS_REPO_URL="https://git.xinghe.dev/xinghe/todo-app.git"

rm -rf "$DOCS_DIR" && mkdir -p "$DOCS_DIR/logs"
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="url.file://$DOCS_DIR/git/todo-app.git.insteadOf"
export GIT_CONFIG_VALUE_0="$GG_DOCS_REPO_URL"

# Job control: each background job gets its own process group, so cleanup stops pnpm and everything below it.
set -m
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill -- "-$p" 2>/dev/null || true; done
  [ -f "$DOCS_DIR/daemons.pid" ] && xargs kill <"$DOCS_DIR/daemons.pid" 2>/dev/null || true
  # The daemons got a copy of the Codex login; don't leave it behind.
  rm -rf "$DOCS_DIR"/machines/*/codex
}
trap cleanup EXIT

bash "$ROOT/scripts/pg.sh" start >/dev/null
bash "$ROOT/scripts/pg.sh" reset gonggong_docs
(cd "$ROOT" && cargo build -q -p gonggong)
bash "$ROOT/website/scripts/shots-repo.sh" "$DOCS_DIR/git"

(cd "$ROOT" && PORT=$SERVER_PORT GONGGONG_DB=gonggong_docs GONGGONG_ADMIN_PASSWORD="$GG_DOCS_ADMIN_PASSWORD" \
  GONGGONG_DATA_DIR="$DOCS_DIR/data" GONGGONG_PREVIEW_PORTS=41500-41599 \
  exec pnpm --filter @gonggong/server start) >"$DOCS_DIR/logs/server.log" 2>&1 &
pids+=($!)
(cd "$ROOT" && WEB_PORT=$WEB_PORT GONGGONG_SERVER="http://127.0.0.1:$SERVER_PORT" \
  exec pnpm --filter @gonggong/web dev --strictPort) >"$DOCS_DIR/logs/web.log" 2>&1 &
pids+=($!)

for url in "http://127.0.0.1:$SERVER_PORT/api/health" "http://127.0.0.1:$WEB_PORT"; do
  for _ in $(seq 120); do curl -sf "$url" >/dev/null && break; sleep 1; done
  curl -sf "$url" >/dev/null || { echo "not up: $url (logs in $DOCS_DIR/logs)" >&2; exit 1; }
done

DOCS_DIR="$DOCS_DIR" node "$ROOT/website/scripts/shots-web.mjs" "$@"
bash "$ROOT/website/scripts/to-webp.sh"
if [ "${SHOTS_KEEP:-}" = 1 ]; then echo "stack kept running; Ctrl-C to stop"; wait; fi
