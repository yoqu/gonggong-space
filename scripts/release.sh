#!/usr/bin/env bash
# Release builds of the gonggong daemon (plan D16/D17).
#   scripts/release.sh [--only macos-aarch64,linux-x86_64,...,desktop,desktop-windows | --daemon-only] [--build-only]
#                      [--publish <server-url>] [--github [--notes <file>]] [--allow-dirty]
#   scripts/release.sh --assemble [--publish …] [--github …]
# Split builds (Jenkins: macOS on a Mac, the rest on Linux): each machine runs --only <its part> --build-only, which
# stops once its files are in dist/<version>; with every part copied into one dist/<version>, --assemble writes
# SHA256SUMS and the manifests without building or deleting anything.
# desktop-windows cross-compiles the Windows installer in Docker (release/desktop-win.Dockerfile, cargo-xwin + NSIS).
# --daemon-only builds gg for all five platforms, with no desktop or GitHub work.
# Builds come from the working tree, so it must be clean (git status --porcelain empty) unless --allow-dirty.
# Writes dist/<version>/: gonggong-<version>-<os>-<arch>[.exe], SHA256SUMS, manifest.json
# ({version, builds: {<os>-<arch>: {url, sha256}}}) and the macOS desktop .dmg (apps/desktop). URLs are
# /downloads/<file>, served by the server from GONGGONG_DATA_DIR/downloads, or GONGGONG_DOWNLOAD_BASE/<file> when set.
# --publish copies the builds into $GONGGONG_DATA_DIR/downloads (when set) and PUTs the manifest to
# <server-url>/api/admin/daemon-release as GONGGONG_ADMIN_ACCOUNT (default admin) / GONGGONG_ADMIN_PASSWORD;
# GONGGONG_CACERT trusts a self-signed server certificate.
# GitHub Releases (GONGGONG_GITHUB_REPO, default yoqu/gonggong-space): github/manifest.json is the same manifest with
# absolute release download URLs (daemons whose server publishes no build check it), github/latest.json the Tauri
# updater feed of the desktop app (Gonggong_<v>_<arch>.app.tar.gz + .sig, signed with TAURI_SIGNING_PRIVATE_KEY /
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD; default ~/.tauri/gonggong.key, which has no password). --github then runs `gh release create v<version>` with every artifact and the
# notes file (--notes, else docs/release-notes/v<version>.md); its Markdown is copied to dist and embedded in both
# manifests. Missing notes warn but do not block publishing.
# The Windows desktop installer is built by .github/workflows/desktop-windows.yml, started here once the release is
# published (scripts/release/ship.sh starts it at the beginning instead); it adds its windows-x86_64 entry to latest.json.
# macOS builds need a macOS host with rustup targets; Linux (glibc ≥ 2.31) and Windows (mingw-w64) build in Docker.
set -euo pipefail
source "$(dirname "$0")/release/lib.sh"

only="" publish="" github="" notes="" allow_dirty="" daemon_only="" build_only="" assemble=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) only="$2"; shift 2 ;;
    --daemon-only) daemon_only=1; shift ;;
    --build-only) build_only=1; shift ;;
    --assemble) assemble=1; shift ;;
    --publish) publish="$2"; shift 2 ;;
    --github) github=1; shift ;;
    --allow-dirty) allow_dirty=1; shift ;;
    --notes)
      case "$2" in
        /*) notes="$2" ;;
        *) notes="$PWD/$2" ;;
      esac
      shift 2
      ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -n "$daemon_only" ]; then
  [ -z "$only" ] || { echo "error: --daemon-only cannot be combined with --only" >&2; exit 2; }
  [ -z "$github" ] || { echo "error: --daemon-only cannot be combined with --github" >&2; exit 2; }
  only="macos-aarch64,macos-x86_64,linux-x86_64,linux-aarch64,windows-x86_64"
fi
if [ -n "$assemble" ]; then
  [ -z "$only$daemon_only$build_only" ] ||
    { echo "error: --assemble cannot be combined with --only, --daemon-only or --build-only" >&2; exit 2; }
  only=none
fi

if [ -z "$allow_dirty" ] && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "error: the working tree has uncommitted changes (git status), commit or stash them, or pass --allow-dirty" >&2
  exit 1
fi

version="$(gonggong_version)"
out="$ROOT/dist/$version"
repo="${GONGGONG_GITHUB_REPO:-yoqu/gonggong-space}"
[ -n "$assemble" ] || rm -rf "$out"
mkdir -p "$out"
[ -n "$notes" ] || notes="$ROOT/docs/release-notes/v$version.md"
if [ -f "$notes" ]; then
  cp "$notes" "$out/RELEASE_NOTES.md"
  notes="$out/RELEASE_NOTES.md"
else
  echo "warning: release notes not found: ${notes:-docs/release-notes/v$version.md}; publishing without notes" >&2
  notes=""
fi
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

rustup="$(command -v rustup || echo /opt/homebrew/opt/rustup/bin/rustup)"
# Rustup's proxy shims honor rust-toolchain.toml and set the library path rust-objcopy needs to strip binaries;
# Homebrew's /opt/homebrew/bin holds standalone rustc/cargo instead, so skip it in favor of rustup's own bin dir.
rustup_bin() {
  local d
  for d in "$(dirname "$rustup")" "$HOME/.cargo/bin" /opt/homebrew/opt/rustup/bin /usr/local/opt/rustup/bin; do
    case "$d" in /opt/homebrew/bin | /usr/local/bin) continue ;; esac
    if [ -x "$d/cargo" ] && [ -x "$d/rustup" ]; then echo "$d"; return 0; fi
  done
  dirname "$("$rustup" which cargo)"
}
# Keep local gg, local Tauri, and peer x86_64 builds on one deployment target so native crates share build caches.
mac_deploy_target="${MACOSX_DEPLOYMENT_TARGET:-10.13}"

mac_targets=() docker_targets=()
for p in "${PLATFORMS[@]}"; do
  key="${p%%:*}"
  wanted "$key" || continue
  if [[ $key == macos-* ]]; then
    [ "$(uname -s)" = Darwin ] || { echo "skip $key: needs a macOS host" >&2; continue; }
    mac_targets+=("$p")
  else
    docker_targets+=("$p")
  fi
done

docker_builds() {
  local p key target exe script=""
  for p in "${docker_targets[@]}"; do
    key="${p%%:*}" target="${p#*:}" exe=""
    [[ $key == windows-* ]] && exe=.exe
    script+="echo '== $key ($target)'; cargo build -q --release --locked -p gonggong --target $target;"
    script+="cp /target/$target/release/gg$exe /out/$(artifact "$key");"
  done
  builder "$out" "$script"
}

# The Docker VM builds Linux and Windows while this host builds macOS and the desktop app: neither waits on the other.
docker_pid=""
docker_log="$(mktemp)"
if [ ${#docker_targets[@]} -gt 0 ]; then
  docker_builds > "$docker_log" 2>&1 &
  docker_pid=$!
fi
docker_done() {
  [ -n "$docker_pid" ] || return 0
  local rc=0
  wait "$docker_pid" || rc=$?
  docker_pid=""
  sed 's/^/[docker] /' "$docker_log"
  rm -f "$docker_log"
  [ "$rc" = 0 ] || { echo "error: the Docker builds failed" >&2; exit "$rc"; }
}

mac_desktop=""
[ -d "$ROOT/apps/desktop" ] && [ "$(uname -s)" = Darwin ] && wanted desktop && mac_desktop=1
rustup_proxy=""
if [ ${#mac_targets[@]} -gt 0 ] || [ -n "$mac_desktop" ]; then
  rustup_proxy="$(rustup_bin)"
fi
# tauri build would run beforeBuildCommand once per arch: the frontend is built once and both arches embed it.
no_frontend='{"build":{"beforeBuildCommand":""}}'
if [ -n "$mac_desktop" ]; then
  echo "== desktop frontend"
  (cd "$ROOT" && pnpm --filter @gonggong/desktop build)
fi

# With a peer Mac (scripts/peer.sh, docs/domains/双机构建.md) the x86_64 half compiles there at the same time: it holds
# no keys and only sends the binaries back, while bundling, signing and notarizing stay here.
peer_x86="" peer_gg="" peer_pid="" peer_log=""
if [ "$(uname -s)" = Darwin ] && { wanted macos-x86_64 || [ -n "$mac_desktop" ]; } &&
  "$ROOT/scripts/peer.sh" --ping 2>/dev/null; then
  peer_x86=1
  script="export MACOSX_DEPLOYMENT_TARGET=$mac_deploy_target"
  ! wanted macos-x86_64 || peer_gg=1 script+=" && cargo build -q --release --locked -p gonggong --target x86_64-apple-darwin"
  [ -z "$mac_desktop" ] || script+=" && pnpm --filter @gonggong/desktop tauri build --target x86_64-apple-darwin \
    --no-bundle --config '$no_frontend'"
  echo "== x86_64 on gg-peer"
  peer_log="$(mktemp)"
  (cd "$ROOT" && GG_PEER_SEND=apps/desktop/dist scripts/peer.sh bash -c "$script") >"$peer_log" 2>&1 &
  peer_pid=$!
fi
trap '[ -z "$docker_pid" ] || kill "$docker_pid" 2>/dev/null; [ -z "$peer_pid" ] || kill "$peer_pid" 2>/dev/null' EXIT
# Waits for the peer and fetches its x86_64 binaries; unreachable after all, the x86_64 half is built here.
peer_done() {
  [ -n "$peer_pid" ] || return 0
  local rc=0 rel=target/x86_64-apple-darwin/release dir
  wait "$peer_pid" || rc=$?
  peer_pid=""
  sed 's/^/[gg-peer] /' "$peer_log"
  rm -f "$peer_log"
  if [ "$rc" = 75 ]; then
    echo "gg-peer unavailable: building x86_64 here"
    peer_x86=""
    return 0
  fi
  [ "$rc" = 0 ] || { echo "error: the x86_64 build on gg-peer failed" >&2; exit "$rc"; }
  dir="$(cd "$ROOT" && scripts/peer.sh --dir)"
  mkdir -p "$ROOT/$rel"
  ssh -o BatchMode=yes "${GG_PEER:-gg-peer}" "cd $dir/$rel && find . -maxdepth 1 -type f ! -name '*.d' ! -name '*.rlib' \
    -print0 | tar --null -T - -cf -" | tar -xf - -C "$ROOT/$rel"
}

mac_build() { # Rust targets
  [ $# -gt 0 ] || return 0
  local t args=()
  for t in "$@"; do args+=(--target "$t"); done
  echo "== gg $*"
  # Put rustup's proxy dir first on PATH and drop RUSTC so cargo/rustc follow rust-toolchain.toml rather than
  # Homebrew's rust, and rustup's shim sets the library path rust-objcopy needs to find libLLVM when stripping.
  # One cargo for every target shares its job queue, so the CPU stays busy across both.
  (cd "$ROOT" && env -u RUSTC PATH="$rustup_proxy:$PATH" MACOSX_DEPLOYMENT_TARGET="$mac_deploy_target" \
    cargo build -q --release --locked -p gonggong "${args[@]}")
}
local_mac=()
for p in "${mac_targets[@]}"; do
  [ -n "$peer_x86" ] && [ "${p%%:*}" = macos-x86_64 ] || local_mac+=("${p#*:}")
done
mac_build ${local_mac[@]+"${local_mac[@]}"}

# Desktop app (Tauri, both macOS arches): `--only desktop` or a full release.
notarize_pids=()
if [ -n "$mac_desktop" ]; then
  echo "== desktop (.app/.dmg)"
  # The updater feed is signed: the app must carry the public key and the build the private one.
  conf="$ROOT/apps/desktop/src-tauri/tauri.conf.json"
  grep -q "\"version\": \"$version\"" "$conf" || { echo "error: $conf is not at version $version" >&2; exit 1; }
  if grep -q REPLACE_WITH_UPDATER_PUBKEY "$conf"; then
    echo "error: put the updater public key (tauri signer generate) into plugins.updater.pubkey of $conf" >&2
    exit 1
  fi
  # Defaults to the key `tauri signer generate -w ~/.tauri/gonggong.key` wrote.
  [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || [ ! -f "$HOME/.tauri/gonggong.key" ] || export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/gonggong.key"
  : "${TAURI_SIGNING_PRIVATE_KEY:?TAURI_SIGNING_PRIVATE_KEY (path or content) is required to sign the app update}"
  # Unset, Tauri prompts on a terminal even for a key without password.
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  # Tauri signs with APPLE_SIGNING_IDENTITY (the keychain's Developer ID
  # when unset) and notarizes when APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH or APPLE_ID/APPLE_PASSWORD/
  # APPLE_TEAM_ID are set.
  : "${APPLE_SIGNING_IDENTITY:=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)}"
  if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    export APPLE_SIGNING_IDENTITY
    echo "signing with $APPLE_SIGNING_IDENTITY"
  else
    unset APPLE_SIGNING_IDENTITY
    echo "warning: no Developer ID Application certificate, the app is signed ad hoc" >&2
  fi
  # Apple silicon and Intel get one app each (not universal): every download and update stays half the size.
  # tauri build compiles and bundles; tauri bundle only bundles the binaries the peer compiled.
  for arch in aarch64 x86_64; do
    cmd=build
    if [ "$arch" = x86_64 ]; then
      peer_done
      [ -z "$peer_x86" ] || cmd=bundle
    fi
    echo "== desktop $arch ($cmd)"
    bundle="$ROOT/target/$arch-apple-darwin/release/bundle"
    rm -rf "$bundle"
    # Drop RUSTC and put rustup's proxy dir first on PATH (not the inner toolchain bin): pnpm drops DYLD_* under SIP,
    # so only rustup's shim restores the library path rust-objcopy needs while still following rust-toolchain.toml.
    (cd "$ROOT" && env -u RUSTC PATH="$rustup_proxy:$PATH" MACOSX_DEPLOYMENT_TARGET="$mac_deploy_target" \
      pnpm --filter @gonggong/desktop tauri "$cmd" --target "$arch-apple-darwin" --bundles app,dmg --config "$no_frontend")
    # ASCII names: GitHub release assets do not keep the Chinese product name.
    dmg="$out/Gonggong_${version}_$arch.dmg"
    cp "$bundle"/dmg/*.dmg "$dmg"
    cp "$bundle"/macos/*.app.tar.gz "$out/Gonggong_${version}_$arch.app.tar.gz"
    cp "$bundle"/macos/*.app.tar.gz.sig "$out/Gonggong_${version}_$arch.app.tar.gz.sig"
    # Tauri notarizes the .app only; a downloaded .dmg is checked by Gatekeeper too, so notarize and staple it as well.
    # APPLE_NOTARY_PROFILE: a `xcrun notarytool store-credentials` keychain profile instead of the API key variables;
    # the .app inside the .dmg is notarized with it. Both arches wait on Apple at the same time.
    if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
      (xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
        --issuer "$APPLE_API_ISSUER" --wait && xcrun stapler staple "$dmg") &
      notarize_pids+=($!)
    elif [ -n "${APPLE_NOTARY_PROFILE:-}" ]; then
      (xcrun notarytool submit "$dmg" --keychain-profile "$APPLE_NOTARY_PROFILE" --wait && xcrun stapler staple "$dmg") &
      notarize_pids+=($!)
    fi
  done
fi

peer_done
[ -n "$peer_x86" ] || [ -z "$peer_gg" ] || mac_build x86_64-apple-darwin
for p in "${mac_targets[@]}"; do
  cp "$ROOT/target/${p#*:}/release/gg" "$out/$(artifact "${p%%:*}")"
done
for pid in ${notarize_pids[@]+"${notarize_pids[@]}"}; do
  wait "$pid" || { echo "error: notarizing a .dmg failed" >&2; exit 1; }
done

# Windows installer (NSIS), cross-compiled with cargo-xwin; signed for the updater like the macOS one, not Authenticode.
if wanted desktop-windows && [ "$only" != "" ]; then
  echo "== desktop (Windows installer)"
  grep -q "\"version\": \"$version\"" "$ROOT/apps/desktop/src-tauri/tauri.conf.json" ||
    { echo "error: tauri.conf.json is not at version $version" >&2; exit 1; }
  [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || [ ! -f "$HOME/.tauri/gonggong.key" ] ||
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/gonggong.key")"
  : "${TAURI_SIGNING_PRIVATE_KEY:?TAURI_SIGNING_PRIVATE_KEY (key content) is required to sign the app update}"
  export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  docker_build -q -t gonggong-desktop-win:1.98 -f "$ROOT/scripts/release/desktop-win.Dockerfile" \
    "$ROOT/scripts/release" >/dev/null
  nsis=/target/x86_64-pc-windows-msvc/release/bundle/nsis
  in_container gonggong-desktop-win:1.98 "$out" "pnpm install --frozen-lockfile --filter '@gonggong/desktop...' \
      --filter '@gonggong/web...'; rm -rf $nsis
    pnpm --filter @gonggong/desktop tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
    cp $nsis/*-setup.exe /out/Gonggong_${version}_x64-setup.exe
    cp $nsis/*-setup.exe.sig /out/Gonggong_${version}_x64-setup.exe.sig" \
    -e TAURI_SIGNING_PRIVATE_KEY -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
    -v gonggong-desktop-win-target:/target -v gonggong-desktop-win-registry:/usr/local/cargo/registry \
    -v gonggong-desktop-win-pnpm:/root/.local/share/pnpm
fi

docker_done

if [ -n "$build_only" ]; then
  echo "== dist/$version (build only)"
  ls -l "$out"
  exit 0
fi

cd "$out"
shopt -s nullglob
: > SHA256SUMS
for file in gonggong-"$version"-*; do
  echo "$(sha256_of "$file")  $file" >> SHA256SUMS
done
# entries <artifact-fn> <url-base>: the manifest's {<os>-<arch>: {url, sha256}} of the files built.
entries() {
  local p key file json="" sep=""
  for p in "${PLATFORMS[@]}"; do
    key="${p%%:*}" file="$("$1" "$key")"
    [ -f "$file" ] || continue
    json+="$sep\"$key\":{\"url\":\"$2/$file\",\"sha256\":\"$(sha256_of "$file")\"}" sep=","
  done
  echo "{$json}"
}
manifest() {
  node "$ROOT/scripts/release/manifest.mjs" release "$version" "$notes" \
    "$(entries artifact "$1")"
}
manifest "${GONGGONG_DOWNLOAD_BASE:-/downloads}" > manifest.json
gh_base="https://github.com/$repo/releases/download/v$version"
mkdir -p github
manifest "$gh_base" > github/manifest.json
# Tauri updater feed: one darwin-<arch> entry per desktop build made.
platforms="" sep=""
for file in Gonggong_"$version"_*.app.tar.gz; do
  arch="${file#Gonggong_"$version"_}" arch="${arch%.app.tar.gz}"
  platforms+="$sep\"darwin-$arch\":{\"signature\":\"$(tr -d '\n' < "$file.sig")\",\"url\":\"$gh_base/$file\"}" sep=","
done
win="Gonggong_${version}_x64-setup.exe"
if [ -f "$win.sig" ]; then
  platforms+="$sep\"windows-x86_64\":{\"signature\":\"$(tr -d '\n' < "$win.sig")\",\"url\":\"$gh_base/$win\"}" sep=","
fi
if [ -n "$platforms" ]; then
  node "$ROOT/scripts/release/manifest.mjs" updater "$version" "$notes" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "{$platforms}" > github/latest.json
fi
echo "== dist/$version"
ls -l "$out" "$out/github"

if [ -n "$publish" ]; then
  if [ -n "${GONGGONG_DATA_DIR:-}" ]; then
    mkdir -p "$GONGGONG_DATA_DIR/downloads"
    cp gonggong-"$version"-* "$GONGGONG_DATA_DIR/downloads/"
  fi
  : "${GONGGONG_ADMIN_PASSWORD:?GONGGONG_ADMIN_PASSWORD is required to publish}"
  jar="$(mktemp)"
  trap 'rm -f "$jar"' EXIT
  curl=(curl -sS --fail-with-body -b "$jar" -c "$jar" -H 'content-type: application/json' ${GONGGONG_CACERT:+--cacert "$GONGGONG_CACERT"})
  # Body built from the environment and sent on stdin: safe for any password and kept out of `ps`.
  GONGGONG_ADMIN_ACCOUNT="${GONGGONG_ADMIN_ACCOUNT:-admin}" GONGGONG_ADMIN_PASSWORD="$GONGGONG_ADMIN_PASSWORD" node -e \
    'const e = process.env; process.stdout.write(JSON.stringify({ account: e.GONGGONG_ADMIN_ACCOUNT, password: e.GONGGONG_ADMIN_PASSWORD }))' |
    "${curl[@]}" -o /dev/null "$publish/api/auth/login" --data @-
  "${curl[@]}" -X PUT "$publish/api/admin/daemon-release" --data @manifest.json
  echo
  echo "published $version to $publish"
fi

if [ -n "$github" ]; then
  [ -f github/latest.json ] || echo "warning: no desktop build, the release has no app update feed (latest.json)" >&2
  # github/manifest.json and github/latest.json upload as manifest.json and latest.json.
  if [ -n "$notes" ]; then
    gh release create "v$version" gonggong-"$version"-* Gonggong_"$version"_* SHA256SUMS \
      github/*.json --repo "$repo" --title "共工空间 v$version" --notes-file "$notes"
  else
    gh release create "v$version" gonggong-"$version"-* Gonggong_"$version"_* SHA256SUMS \
      github/*.json --repo "$repo" --title "共工空间 v$version" --notes "本版本未提供具体更新说明。"
  fi
  echo "released v$version on github.com/$repo"
  gh workflow run desktop-windows.yml --repo "$repo" --ref "v$version" -f tag="v$version"
  echo "started the Windows desktop build (gh run list --repo $repo --workflow desktop-windows.yml)"
fi
