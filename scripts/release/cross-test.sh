#!/usr/bin/env bash
# Daemon tests off macOS (plan D16): `cargo test --workspace` on Linux (Docker, host arch), and the Windows test
# binaries cross-compiled (they cannot run here). Usage: scripts/release/cross-test.sh [linux|windows]...
set -euo pipefail
source "$(dirname "$0")/lib.sh"
out="$ROOT/dist/cross-test"

linux() {
  local target
  target="$(docker_arch)-unknown-linux-gnu"
  echo "== cargo test --workspace ($target, Debian bullseye container)"
  builder "$out/linux" "
    (cd tools/mock-agent && npm install --no-audit --no-fund --silent)
    git config --global user.name aiws-test && git config --global user.email test@aiws.local
    cargo test --workspace --locked --target $target 2>&1 | tee /out/cargo-test.log"
}

windows() {
  echo "== cargo test --no-run (x86_64-pc-windows-gnu, mingw-w64)"
  builder "$out/windows" '
    cargo test --workspace --locked --no-run --target x86_64-pc-windows-gnu --message-format=json-render-diagnostics \
      | sed -n "s/.*\"executable\":\"\([^\"]*\.exe\)\".*/\1/p" > /tmp/exes
    xargs -a /tmp/exes cp -t /out
    ls -l /out'
}

targets=("$@")
[ $# -gt 0 ] || targets=(linux windows)
for t in "${targets[@]}"; do "$t"; done
