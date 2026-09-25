#!/usr/bin/env bash
# Release rehearsal (plan D17), macOS host: builds every artifact with scripts/release.sh, publishes the manifest to
# a local server (fresh DB), and checks that a daemon of an older version (this source stamped 0.0.1) downloads,
# verifies and installs the published macOS build, then reconnects reporting the new version.
# Usage: bash scripts/release/rehearse.sh [--only <os-arch,...>]   (Docker, jq, Postgres from `pnpm db:up`)
set -Eeuo pipefail
source "$(dirname "$0")/lib.sh"
PORT="${PORT:-8867}" DB=gonggong_release_rehearsal PASS=rehearsal-pass
WORK="$(cd "$(mktemp -d)" && pwd -P)"
URL="http://127.0.0.1:$PORT" JAR="$WORK/cookies"
version="$(gonggong_version)" key="macos-$(uname -m | sed 's/arm64/aarch64/')"
daemon_pid=""

cleanup() {
  trap - ERR
  [ -z "$daemon_pid" ] || kill "$daemon_pid" 2>/dev/null || true
  lsof -ti "tcp:$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
}
trap cleanup EXIT
trap 'echo "FAILED — logs in $WORK"; tail -20 "$WORK/server.log" "$WORK/daemon.log" 2>/dev/null' ERR

api() {
  local method="$1" path="$2"
  shift 2
  curl -sS --fail-with-body -b "$JAR" -c "$JAR" -H 'content-type: application/json' -X "$method" "$URL$path" "$@"
}

wait_for() {
  local what="$1" left="$2"
  shift 2
  until "$@" >/dev/null 2>&1; do
    left=$((left - 1))
    [ "$left" -gt 0 ] || { echo "timed out waiting for $what" >&2; return 1; }
    sleep 1
  done
}

echo "== old daemon (0.0.1) from this source"
mkdir -p "$WORK/old/crates" "$WORK/member"
cp -R "$ROOT/crates/gonggong" "$WORK/old/crates/"
cp "$ROOT/Cargo.lock" "$WORK/old/"
printf '[workspace]\nresolver = "3"\nmembers = ["crates/gonggong"]\n' > "$WORK/old/Cargo.toml"
sed -i '' 's/^version = ".*"$/version = "0.0.1"/' "$WORK/old/crates/gonggong/Cargo.toml"
(cd "$WORK/old" && CARGO_TARGET_DIR="$ROOT/target/rehearsal" cargo build -q -p gonggong)
cp "$ROOT/target/rehearsal/debug/gg" "$WORK/member/gg"
"$WORK/member/gg" --version

echo "== server on $URL (db $DB)"
bash "$ROOT/scripts/pg.sh" reset "$DB"
(cd "$ROOT" && GONGGONG_DB=$DB GONGGONG_ADMIN_PASSWORD=admin-init GONGGONG_DATA_DIR="$WORK/data" PORT=$PORT \
  pnpm --filter @gonggong/server start > "$WORK/server.log" 2>&1 &)
wait_for server 60 api GET /api/health
api POST /api/auth/login -d '{"account":"admin","password":"admin-init"}' >/dev/null
api POST /api/auth/password -d "{\"oldPassword\":\"admin-init\",\"newPassword\":\"$PASS\"}" >/dev/null

echo "== build and publish $version"
GONGGONG_DATA_DIR="$WORK/data" GONGGONG_ADMIN_PASSWORD=$PASS bash "$ROOT/scripts/release.sh" --publish "$URL" "$@"
[ "$(api GET /api/admin/daemon-release | jq -r .version)" = "$version" ]
want="$(jq -r ".builds[\"$key\"].sha256" "$ROOT/dist/$version/manifest.json")"

echo "== old daemon binds and upgrades itself"
code="$(api POST /api/bind-codes -d '{}' | jq -r .code)"
export GONGGONG_HOME="$WORK/member/home" GONGGONG_LOG=info
"$WORK/member/gg" login --server "$URL" --code "$code"
"$WORK/member/gg" run > "$WORK/daemon.log" 2>&1 &
daemon_pid=$!
upgraded() { api GET /api/machines | jq -e ".[0].online and .[0].daemonVersion == \"$version\""; }
wait_for "daemon $version online" 180 upgraded
[ "$(sha256_of "$WORK/member/gg")" = "$want" ]
"$WORK/member/gg" --version
echo "PASS release rehearsal: 0.0.1 → $version via $key build (sha256 $want)"
