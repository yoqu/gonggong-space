#!/usr/bin/env bash
# Release builds of the gonggong daemon (plan D16/D17).
#   scripts/release.sh [--only macos-aarch64,linux-x86_64,...,desktop] [--publish <server-url>]
# Writes dist/<version>/: gonggong-<version>-<os>-<arch>[.exe], gg-cast-<version>-<os>-<arch>[.exe] (the desktop
# preview publisher, crates/gg-cast, downloaded by daemons on their first live preview), SHA256SUMS, manifest.json
# ({version, builds: {<os>-<arch>: {url, sha256}}, cast: {…same}}) and the macOS desktop .dmg (apps/desktop). URLs are
# /downloads/<file>, served by the server from GONGGONG_DATA_DIR/downloads, or GONGGONG_DOWNLOAD_BASE/<file> when set.
# --publish copies the builds into $GONGGONG_DATA_DIR/downloads (when set) and PUTs the manifest to
# <server-url>/api/admin/daemon-release as GONGGONG_ADMIN_ACCOUNT (default admin) / GONGGONG_ADMIN_PASSWORD;
# GONGGONG_CACERT trusts a self-signed server certificate.
# macOS builds need a macOS host with rustup targets; Linux (glibc ≥ 2.31) and Windows (mingw-w64) build in Docker.
# gg-cast links libwebrtc's prebuilt archives: on Linux and Windows (MSVC, through cargo-xwin) it builds in the image
# of release/cast.Dockerfile, natively for the Docker host's Linux arch and emulated (`--platform`) for the other.
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

version="$(gonggong_version)"
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
artifact() { echo "gonggong-$version-$1$([[ $1 == windows-* ]] && echo .exe || true)"; }
cast_artifact() { echo "gg-cast-$version-$1$([[ $1 == windows-* ]] && echo .exe || true)"; }
# libwebrtc ships MSVC archives only.
cast_target() { [[ $1 == windows-* ]] && echo x86_64-pc-windows-msvc || echo "$2"; }
# Linking libwebrtc takes GBs of memory per job; Docker VMs often have a few.
CAST=(-j 4 --release --locked --manifest-path crates/gg-cast/Cargo.toml)

rustup="$(command -v rustup || echo /opt/homebrew/opt/rustup/bin/rustup)"
# mac_cast <key> <target>: gg-cast for a macOS target, into $out.
mac_cast() {
  local webrtc
  webrtc="$(webrtc_prebuilt "$2")"
  (cd "$ROOT" && LK_CUSTOM_WEBRTC="$webrtc" RUSTC="$("$rustup" which --toolchain stable rustc)" \
    "$rustup" run stable cargo build -q "${CAST[@]}" --target "$2")
  cp "$ROOT/crates/gg-cast/target/$2/release/gg-cast" "$out/$(cast_artifact "$1")"
}

docker_targets=()
for p in "${PLATFORMS[@]}"; do
  key="${p%%:*}" target="${p#*:}"
  wanted "$key" || continue
  if [[ $key == macos-* ]]; then
    [ "$(uname -s)" = Darwin ] || { echo "skip $key: needs a macOS host" >&2; continue; }
    echo "== $key ($target)"
    # The rustup toolchain has the cross targets; a Homebrew rustc earlier on PATH would not. `rustup run` (not the
    # bare toolchain binaries) also sets the library path rust-objcopy needs to find libLLVM when stripping.
    # `rustup run` leaves PATH alone, so cargo would still spawn a Homebrew rustc that lacks the cross target.
    export RUSTC="$("$rustup" which --toolchain stable rustc)"
    (cd "$ROOT" && "$rustup" run stable cargo build -q --release --locked -p gonggong --target "$target")
    cp "$ROOT/target/$target/release/gg" "$out/$(artifact "$key")"
    mac_cast "$key" "$target"
  else
    docker_targets+=("$key:$target")
  fi
done

if [ ${#docker_targets[@]} -gt 0 ]; then
  script=""
  for p in "${docker_targets[@]}"; do
    key="${p%%:*}" target="${p#*:}" exe=""
    [[ $key == windows-* ]] && exe=.exe
    script+="echo '== $key ($target)'; cargo build -q --release --locked -p gonggong --target $target;"
    script+="cp /target/$target/release/gg$exe /out/$(artifact "$key");"
  done
  builder "$out" "$script"
  host="linux-$(docker_arch)"
  for p in "${docker_targets[@]}"; do
    key="${p%%:*}" target="$(cast_target "${p%%:*}" "${p#*:}")" exe="" build=build platform=""
    [[ $key == windows-* ]] && exe=.exe build=xwin\ build
    [[ $key == linux-* && $key != "$host" ]] && platform="linux/${key#linux-}"
    echo "== gg-cast $key ($target${platform:+, emulated})"
    cast_builder "$out" "$platform" "cargo $build -q ${CAST[*]} --target $target; \
      cp /target/$target/release/gg-cast$exe /out/$(cast_artifact "$key")"
  done
fi

# Desktop app (Tauri; only macOS is bundled in P1): `--only desktop` or a full release.
if [ -d "$ROOT/apps/desktop" ] && [ "$(uname -s)" = Darwin ] && wanted desktop; then
  echo "== desktop (.app/.dmg)"
  rm -rf "$ROOT/target/release/bundle"
  # The app bundles gg-cast (Tauri externalBin, placed beside its executable) instead of downloading it. Only here,
  # so everyday desktop builds do not need libwebrtc.
  arch="$(uname -m | sed s/arm64/aarch64/)"
  [ -f "$out/$(cast_artifact "macos-$arch")" ] || mac_cast "macos-$arch" "$arch-apple-darwin"
  mkdir -p "$ROOT/apps/desktop/src-tauri/binaries"
  cp "$out/$(cast_artifact "macos-$arch")" "$ROOT/apps/desktop/src-tauri/binaries/gg-cast-$arch-apple-darwin"
  # TCC keys its grants (屏幕录制, 辅助功能) to the signature: an ad-hoc one changes every build and loses them, a
  # Developer ID one keeps them across builds. Tauri signs with APPLE_SIGNING_IDENTITY (the keychain's Developer ID
  # when unset) and notarizes when APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH or APPLE_ID/APPLE_PASSWORD/
  # APPLE_TEAM_ID are set.
  : "${APPLE_SIGNING_IDENTITY:=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)}"
  if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    export APPLE_SIGNING_IDENTITY
    echo "signing with $APPLE_SIGNING_IDENTITY"
  else
    unset APPLE_SIGNING_IDENTITY
    echo "warning: no Developer ID Application certificate, the app is signed ad hoc (permissions reset on update)" >&2
  fi
  # Host-only build: drop the macOS builds' RUSTC, whose rust-objcopy loses its library path through pnpm (SIP strips
  # DYLD_* on the way) and so could not strip the binary.
  (cd "$ROOT" && env -u RUSTC pnpm --filter @gonggong/desktop tauri build --bundles app,dmg \
    --config '{"bundle":{"externalBin":["binaries/gg-cast"]}}')
  cp "$ROOT"/target/release/bundle/dmg/*.dmg "$out/"
fi

cd "$out"
: > SHA256SUMS
# entries <artifact-fn>: the manifest's {<os>-<arch>: {url, sha256}} of the files built; adds them to SHA256SUMS.
entries() {
  local p key file sum json="" sep=""
  for p in "${PLATFORMS[@]}"; do
    key="${p%%:*}" file="$("$1" "$key")"
    [ -f "$file" ] || continue
    sum="$(sha256_of "$file")"
    echo "$sum  $file" >> SHA256SUMS
    json+="$sep\"$key\":{\"url\":\"${GONGGONG_DOWNLOAD_BASE:-/downloads}/$file\",\"sha256\":\"$sum\"}" sep=","
  done
  echo "{$json}"
}
builds="$(entries artifact)" cast="$(entries cast_artifact)"
echo "{\"version\":\"$version\",\"builds\":$builds,\"cast\":$cast}" > manifest.json
echo "== dist/$version"
ls -l "$out"

if [ -n "$publish" ]; then
  if [ -n "${GONGGONG_DATA_DIR:-}" ]; then
    mkdir -p "$GONGGONG_DATA_DIR/downloads"
    cp gonggong-"$version"-* gg-cast-"$version"-* "$GONGGONG_DATA_DIR/downloads/"
  fi
  : "${GONGGONG_ADMIN_PASSWORD:?GONGGONG_ADMIN_PASSWORD is required to publish}"
  jar="$(mktemp)"
  trap 'rm -f "$jar"' EXIT
  curl=(curl -sS --fail-with-body -b "$jar" -c "$jar" -H 'content-type: application/json' ${GONGGONG_CACERT:+--cacert "$GONGGONG_CACERT"})
  "${curl[@]}" -o /dev/null "$publish/api/auth/login" \
    -d "{\"account\":\"${GONGGONG_ADMIN_ACCOUNT:-admin}\",\"password\":\"$GONGGONG_ADMIN_PASSWORD\"}"
  "${curl[@]}" -X PUT "$publish/api/admin/daemon-release" --data @manifest.json
  echo
  echo "published $version to $publish"
fi
