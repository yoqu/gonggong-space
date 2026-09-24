#!/usr/bin/env bash
# Release builds of the aiws daemon (plan D16/D17).
#   scripts/release.sh [--only macos-aarch64,linux-x86_64,...,desktop] [--publish <server-url>]
# Writes dist/<version>/: aiws-<version>-<os>-<arch>[.exe], SHA256SUMS, manifest.json
# ({version, builds: {<os>-<arch>: {url, sha256}}}) and the macOS desktop .dmg (apps/desktop). URLs are
# /downloads/<file>, served by the server from AIWS_DATA_DIR/downloads, or AIWS_DOWNLOAD_BASE/<file> when set.
# --publish copies the builds into $AIWS_DATA_DIR/downloads (when set) and PUTs the manifest to
# <server-url>/api/admin/daemon-release as AIWS_ADMIN_ACCOUNT (default admin) / AIWS_ADMIN_PASSWORD;
# AIWS_CACERT trusts a self-signed server certificate.
# macOS builds need a macOS host with rustup targets; Linux (glibc ≥ 2.31) and Windows (mingw-w64) build in Docker.
set -euo pipefail
source "$(dirname "$0")/release/lib.sh"

only="" publish=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) only="$2"; shift 2 ;;
    --publish) publish="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

version="$(aiws_version)"
out="$ROOT/dist/$version"
rm -rf "$out" && mkdir -p "$out"
# <os>-<arch> as the daemon reports it (std::env::consts) → Rust target.
PLATFORMS=(
  macos-aarch64:aarch64-apple-darwin
  macos-x86_64:x86_64-apple-darwin
  linux-x86_64:x86_64-unknown-linux-gnu
  linux-aarch64:aarch64-unknown-linux-gnu
  windows-x86_64:x86_64-pc-windows-gnu
)
wanted() { [ -z "$only" ] || [[ ",$only," == *",$1,"* ]]; }
artifact() { echo "aiws-$version-$1$([[ $1 == windows-* ]] && echo .exe || true)"; }

docker_targets=()
for p in "${PLATFORMS[@]}"; do
  key="${p%%:*}" target="${p#*:}"
  wanted "$key" || continue
  if [[ $key == macos-* ]]; then
    [ "$(uname -s)" = Darwin ] || { echo "skip $key: needs a macOS host" >&2; continue; }
    echo "== $key ($target)"
    # The rustup toolchain has the cross targets; a Homebrew rustc earlier on PATH would not. `rustup run` (not the
    # bare toolchain binaries) also sets the library path rust-objcopy needs to find libLLVM when stripping.
    rustup="$(command -v rustup || echo /opt/homebrew/opt/rustup/bin/rustup)"
    (cd "$ROOT" && "$rustup" run stable cargo build -q --release --locked -p aiws --target "$target")
    cp "$ROOT/target/$target/release/aiws" "$out/$(artifact "$key")"
  else
    docker_targets+=("$key:$target")
  fi
done

if [ ${#docker_targets[@]} -gt 0 ]; then
  script=""
  for p in "${docker_targets[@]}"; do
    key="${p%%:*}" target="${p#*:}" exe=""
    [[ $key == windows-* ]] && exe=.exe
    script+="echo '== $key ($target)'; cargo build -q --release --locked -p aiws --target $target;"
    script+="cp /target/$target/release/aiws$exe /out/$(artifact "$key");"
  done
  builder "$out" "$script"
fi

# Desktop app (Tauri; only macOS is bundled in P1): `--only desktop` or a full release.
if [ -d "$ROOT/apps/desktop" ] && [ "$(uname -s)" = Darwin ] && wanted desktop; then
  echo "== desktop (.app/.dmg)"
  rm -rf "$ROOT/target/release/bundle"
  (cd "$ROOT" && pnpm --filter @aiws/desktop tauri build --bundles app,dmg)
  cp "$ROOT"/target/release/bundle/dmg/*.dmg "$out/"
fi

cd "$out"
builds="" sep=""
: > SHA256SUMS
for p in "${PLATFORMS[@]}"; do
  key="${p%%:*}" file="$(artifact "${p%%:*}")"
  [ -f "$file" ] || continue
  sum="$(sha256_of "$file")"
  echo "$sum  $file" >> SHA256SUMS
  builds+="$sep\"$key\":{\"url\":\"${AIWS_DOWNLOAD_BASE:-/downloads}/$file\",\"sha256\":\"$sum\"}" sep=","
done
echo "{\"version\":\"$version\",\"builds\":{$builds}}" > manifest.json
echo "== dist/$version"
ls -l "$out"

if [ -n "$publish" ]; then
  if [ -n "${AIWS_DATA_DIR:-}" ]; then
    mkdir -p "$AIWS_DATA_DIR/downloads"
    cp aiws-"$version"-* "$AIWS_DATA_DIR/downloads/"
  fi
  : "${AIWS_ADMIN_PASSWORD:?AIWS_ADMIN_PASSWORD is required to publish}"
  jar="$(mktemp)"
  trap 'rm -f "$jar"' EXIT
  curl=(curl -sS --fail-with-body -b "$jar" -c "$jar" -H 'content-type: application/json' ${AIWS_CACERT:+--cacert "$AIWS_CACERT"})
  "${curl[@]}" -o /dev/null "$publish/api/auth/login" \
    -d "{\"account\":\"${AIWS_ADMIN_ACCOUNT:-admin}\",\"password\":\"$AIWS_ADMIN_PASSWORD\"}"
  "${curl[@]}" -X PUT "$publish/api/admin/daemon-release" --data @manifest.json
  echo
  echo "published $version to $publish"
fi
