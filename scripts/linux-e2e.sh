#!/usr/bin/env bash
# Linux daemon integration (plan D16). The server runs on this host (fresh DB, dev TLS certificate); the Linux
# `gonggong` build runs in a Debian bookworm container with Node 22, git and the mock ACP agent. The container binds
# with a one-time code over https (self-signed certificate), then the API drives two bot turns: in a group without
# a repo, and in a repo group cloned from a file:// bare repo copied into the container at the same path.
# Usage: bash scripts/linux-e2e.sh   (Docker, jq, Postgres from `pnpm db:up`; GONGGONG_LINUX_BIN reuses a build)
set -Eeuo pipefail
source "$(dirname "$0")/release/lib.sh"
PORT="${PORT:-8866}" DB=gonggong_linux_e2e PASS=linux-e2e-pass BOT=linuxbot
WORK="$(cd "$(mktemp -d)" && pwd -P)"
URL="https://127.0.0.1:$PORT" JAR="$WORK/cookies"
box=""

cleanup() {
  trap - ERR
  [ -z "$box" ] || docker rm -f "$box" >/dev/null
  lsof -ti "tcp:$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
}
trap cleanup EXIT
trap 'echo "FAILED — logs in $WORK"; tail -20 "$WORK/server.log" "$WORK/daemon.log" 2>/dev/null' ERR

api() {
  local method="$1" path="$2"
  shift 2
  curl -sS --fail-with-body --cacert "$WORK/tls/cert.pem" -b "$JAR" -c "$JAR" -H 'content-type: application/json' \
    -X "$method" "$URL$path" "$@"
}

# wait_for <what> <seconds> <command...>
wait_for() {
  local what="$1" left="$2"
  shift 2
  until "$@" >/dev/null 2>&1; do
    left=$((left - 1))
    [ "$left" -gt 0 ] || { echo "timed out waiting for $what" >&2; return 1; }
    sleep 1
  done
}

arch="$(docker_arch)"
if [ -z "${GONGGONG_LINUX_BIN:-}" ]; then
  echo "== building gonggong for $arch-unknown-linux-gnu"
  target="$arch-unknown-linux-gnu"
  builder "$WORK/bin" "cargo build -q --release --locked -p gonggong --target $target; cp /target/$target/release/gg /out/"
  GONGGONG_LINUX_BIN="$WORK/bin/gg"
fi
docker build -q -t gonggong-linux-e2e -f "$ROOT/scripts/release/e2e.Dockerfile" "$ROOT/tools/mock-agent" >/dev/null

echo "== server on $URL (db $DB)"
bash "$ROOT/scripts/pg.sh" reset "$DB"
bash "$ROOT/scripts/dev-cert.sh" "$WORK/tls" >/dev/null
(cd "$ROOT" && GONGGONG_DB=$DB GONGGONG_ADMIN_PASSWORD=admin-init GONGGONG_DATA_DIR="$WORK/data" PORT=$PORT \
  GONGGONG_TLS_CERT="$WORK/tls/cert.pem" GONGGONG_TLS_KEY="$WORK/tls/key.pem" \
  pnpm --filter @gonggong/server start > "$WORK/server.log" 2>&1 &)
wait_for server 60 api GET /api/health
api POST /api/auth/login -d '{"account":"admin","password":"admin-init"}' >/dev/null
api POST /api/auth/password -d "{\"oldPassword\":\"admin-init\",\"newPassword\":\"$PASS\"}" >/dev/null
me="$(api GET /api/me | jq -r .id)"
code="$(api POST /api/bind-codes -d '{}' | jq -r .code)"

git init -q --bare -b main "$WORK/repo.git"
git clone -q "$WORK/repo.git" "$WORK/seed" 2>/dev/null
echo '# linux e2e' > "$WORK/seed/README.md"
git -C "$WORK/seed" add . && git -C "$WORK/seed" -c user.name=e2e -c user.email=e2e@gonggong commit -qm init
git -C "$WORK/seed" push -q origin main

echo "== member machine: $(basename "$GONGGONG_LINUX_BIN") in a container"
box="$(docker create --add-host host.docker.internal:host-gateway \
  -e GONGGONG_LOG=info -e GONGGONG_NO_AUTO_UPGRADE=1 -e GONGGONG_ADAPTER_CMD='node /opt/mock-agent/agent.js' gonggong-linux-e2e \
  sh -ec "gg login --server https://host.docker.internal:$PORT --code $code; exec gg run")"
docker cp "$GONGGONG_LINUX_BIN" "$box:/usr/local/bin/gg" >/dev/null
COPYFILE_DISABLE=1 tar --no-xattrs -C / -cf - "${WORK#/}/repo.git" | docker cp - "$box:/" >/dev/null
docker start "$box" >/dev/null
docker logs -f "$box" > "$WORK/daemon.log" 2>&1 &

online() { api GET /api/machines | jq -e '.[0].online' ; }
wait_for "daemon online" 60 online
machine="$(api GET /api/machines | jq -c '.[0] | {id, os, arch, daemonVersion}')"
echo "machine: $machine"
[ "$(jq -r .os <<<"$machine")" = linux ]
grep -q "绑定成功" "$WORK/daemon.log"

bot="$(api POST /api/bots -d "{\"name\":\"$BOT\",\"ownerId\":\"$me\",\"agentKind\":\"claude\",\
\"machineId\":$(jq .id <<<"$machine"),\"systemPrompt\":\"\"}" | jq -r .id)"

# turn <group-id> <prompt> <expected text in the reply>
turn() {
  local group="$1" prompt="$2" want="$3"
  api POST "/api/groups/$group/messages" -d "{\"body\":\"@$BOT $prompt\",\"clientId\":\"e2e-$RANDOM$RANDOM\"}" >/dev/null
  done_() { api GET "/api/groups/$group/timeline" | jq -e '.runs[-1].status == "completed"'; }
  wait_for "run in $group" 120 done_
  reply="$(api GET "/api/groups/$group/timeline" | jq -r '[.messages[] | select(.kind == "bot")][-1].body')"
  echo "reply: $reply"
  grep -qF "$want" <<<"$reply"
}

echo "== turn in a group without a repo"
group="$(api POST /api/groups -d "{\"name\":\"Linux 无仓库\",\"kind\":\"group\",\"botIds\":[\"$bot\"]}" | jq -r .id)"
turn "$group" 'mock:sh uname -s && node --version' Linux

echo "== turn in a repo group (file:// clone inside the container)"
group="$(api POST /api/groups -d "{\"name\":\"Linux 仓库\",\"kind\":\"group\",\"botIds\":[\"$bot\"],\
\"repo\":{\"url\":\"file://$WORK/repo.git\",\"branch\":\"main\"}}" | jq -r .id)"
turn "$group" 'mock:sh cat README.md && git log --oneline -1' '# linux e2e'

echo "PASS linux-e2e ($arch, $(jq -r .daemonVersion <<<"$machine"))"
