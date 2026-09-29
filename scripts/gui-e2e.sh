#!/usr/bin/env bash
# Linux desktop-preview e2e (plan 结果预览 B5). Builds gg and gg-cast in the gg-cast build image (Docker host arch),
# then runs e2e/gui-preview.spec.ts through e2e/gui.config.ts in one Linux container: Postgres, the server with its own
# LiveKit (downloaded on first use), the web dev server, a daemon with the mock agent, a Tk app on an Xvfb virtual
# display, headless Chromium. Usage: bash scripts/gui-e2e.sh   (Docker; Playwright's traces land in dist/gui-e2e/)
set -Eeuo pipefail
source "$(dirname "$0")/release/lib.sh"
out="$ROOT/dist/gui-e2e"
rm -rf "$out"

echo "== building gg and gg-cast"
cast_builder "$out/bin" "" "cargo build -q -j 4 --locked -p gonggong; cargo build -q -j 4 --release --locked \
  --manifest-path crates/gg-cast/Cargo.toml; cp /target/debug/gg /target/release/gg-cast /out/"
docker build -q -t gonggong-gui-e2e -f "$ROOT/scripts/release/gui-e2e.Dockerfile" "$ROOT/scripts/release" >/dev/null

echo "== e2e"
pg=/usr/lib/postgresql/15/bin
id=$(docker create gonggong-gui-e2e bash -eo pipefail -c "
  git config --global user.name gonggong-test && git config --global user.email test@gonggong.local
  mkdir -p /out target/debug && mv /prebuilt/gg target/debug/gg
  pnpm install --frozen-lockfile --silent
  (cd tools/mock-agent && npm install --no-audit --no-fund --silent)
  # initdb refuses root.
  su postgres -c 'mkdir -p /tmp/pg && $pg/initdb -D /tmp/pg -U gonggong --auth=trust -E UTF8 >/dev/null \
    && $pg/pg_ctl -D /tmp/pg -l /tmp/pg.log -o \"-p 54329 -k /tmp\" -w start >/dev/null \
    && $pg/createdb -h /tmp -p 54329 -U gonggong gonggong_e2e'
  GONGGONG_E2E_PREBUILT=1 GG_CAST_BIN=/prebuilt/gg-cast pnpm exec playwright test -c e2e/gui.config.ts --reporter=list \
    || { cp -r test-results /out/; exit 1; }")
rc=0
source_tar | docker cp - "$id:/src" >/dev/null
docker cp "$out/bin/." "$id:/prebuilt" >/dev/null
docker start -a "$id" || rc=$?
docker cp "$id:/out/." "$out" >/dev/null 2>&1 || true
docker rm -f "$id" >/dev/null
[ "$rc" = 0 ] && echo "PASS gui-e2e"
exit "$rc"
