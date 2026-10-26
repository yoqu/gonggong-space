#!/usr/bin/env bash
# One-command client release (docs/plan/发布与平台说明.md):
#   scripts/release/ship.sh <version> [--daemon-only] bump, tag, push and build; the fast path skips desktop and GitHub
#   scripts/release/ship.sh verify <version> <server> [--daemon-only] check downloads and desktop updates when requested
# Write docs/release-notes/v<version>.md and the CHANGELOG entry (`## v<version> — <date>`) first; they are committed
# with the version bump. Then, without waiting on each other: GitHub Actions builds the Windows desktop installer from
# the pushed tag while this machine runs scripts/release.sh (its Docker builds beside the macOS ones). The assets go to
# a draft release in parallel; once Windows is done its installer is fetched into dist/<version>, the full latest.json
# uploaded and the release published. dist/<version> is then complete for `client_release_publish` (dir), which puts
# it on the space in one go. Every step checks what is already done, so a failed run can simply be started again.
# scripts/release.sh reads its usual environment (TAURI_SIGNING_PRIVATE_KEY, APPLE_NOTARY_PROFILE,
# GONGGONG_SKIP_DOCKER_CAST…) and needs Docker running.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

repo="${GONGGONG_GITHUB_REPO:-yoqu/gonggong-space}"
# Proxies a Bot's environment injects break git pushes and gh (Proxy CONNECT aborted).
direct() { env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u ALL_PROXY -u all_proxy "$@"; }
step() { echo "== $(date +%H:%M:%S) $*"; }

valid() { [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: not a version: $1" >&2; exit 2; }; }

verify_daemon() {
  local v="$1" server="${2%/}" sums="$ROOT/dist/$1/SHA256SUMS"
  local ok=1 prefix platform suffix name label expected actual
  [ -f "$sums" ] || { echo "FAIL daemon checksums: $sums not found"; return 1; }
  for prefix in gonggong gg-cast; do
    label=gg
    [ "$prefix" = gonggong ] || label=gg-cast
    for platform in macos-aarch64 macos-x86_64 linux-x86_64 linux-aarch64 windows-x86_64; do
      suffix=""
      [[ $platform == windows-* ]] && suffix=.exe
      name="$prefix-$v-$platform$suffix"
      expected="$(awk -v file="$name" '$2 == file { print $1 }' "$sums")"
      if [ -z "$expected" ]; then
        echo "FAIL $label $name: missing from SHA256SUMS"
        ok=0
        continue
      fi
      if ! actual="$(curl -sSfL --connect-timeout 10 --max-time 300 "$server/downloads/$name" |
        shasum -a 256 | cut -d' ' -f1)"; then
        echo "FAIL $label $name: download failed"
        ok=0
      elif [ "$actual" != "$expected" ]; then
        echo "FAIL $label $name: SHA-256 mismatch"
        ok=0
      else
        echo "ok   $label $platform"
      fi
    done
  done
  [ "$ok" = 1 ]
}

verify() {
  local v="$1" server="${2%/}" ok=1 platform body
  verify_daemon "$v" "$server" || ok=0
  for platform in darwin/aarch64 windows/x86_64; do
    body="$(curl -sS "$server/api/desktop-update/$platform/0.0.0" || true)"
    if node -e 'const r = JSON.parse(process.argv[1]); process.exit(r.version === process.argv[2] && r.signature ? 0 : 1)' \
      "$body" "$v" 2>/dev/null; then
      echo "ok   desktop $platform → $v"
    else
      echo "FAIL desktop $platform: $body"
      ok=0
    fi
  done
  [ "$ok" = 1 ]
}

if [ "${1:-}" = verify ]; then
  { [ $# -eq 3 ] || { [ $# -eq 4 ] && [ "${4:-}" = --daemon-only ]; }; } ||
    { echo "usage: $0 verify <version> <server-url> [--daemon-only]" >&2; exit 2; }
  valid "$2"
  if [ "${4:-}" = --daemon-only ]; then verify_daemon "$2" "$3"; else verify "$2" "$3"; fi
  exit
fi
daemon_only=""
if [ $# -eq 2 ] && [ "$2" = --daemon-only ]; then daemon_only=1; fi
[ $# -eq 1 ] || [ -n "$daemon_only" ] ||
  { echo "usage: $0 <version> [--daemon-only] | verify <version> <server-url> [--daemon-only]" >&2; exit 2; }
v="$1"
valid "$v"
tag="v$v"
out="$ROOT/dist/$v"
notes="docs/release-notes/$tag.md"
cd "$ROOT"

[ "$(git branch --show-current)" = main ] || { echo "error: release from main" >&2; exit 1; }
[ -f "$notes" ] || { echo "error: write $notes first" >&2; exit 1; }
grep -q "^## $tag " CHANGELOG.md || { echo "error: add a '## $tag — <date>' entry to CHANGELOG.md first" >&2; exit 1; }
direct git fetch -q gitlab main
git merge-base --is-ancestor gitlab/main HEAD || { echo "error: main is behind gitlab/main, pull first" >&2; exit 1; }
# Only the release's own files may be changed (the bump too, when a run is started again): anything else would ship
# uncommitted.
release_files=(CHANGELOG.md "$notes" Cargo.lock crates/gonggong/Cargo.toml apps/desktop/src-tauri/Cargo.toml
  apps/desktop/src-tauri/tauri.conf.json)
stray="$(git status --porcelain --untracked-files=no -- . "${release_files[@]/#/:!}")"
[ -z "$stray" ] || { echo "error: uncommitted changes besides the notes and CHANGELOG:" >&2; echo "$stray" >&2; exit 1; }

if [ "$(gonggong_version)" != "$v" ]; then
  step "bump to $v"
  sed -i '' "1,/^version = /s/^version = \".*\"/version = \"$v\"/" crates/gonggong/Cargo.toml apps/desktop/src-tauri/Cargo.toml
  sed -i '' "s/^  \"version\": \".*\",/  \"version\": \"$v\",/" apps/desktop/src-tauri/tauri.conf.json
  cargo update -q --workspace --offline
fi
git add "${release_files[@]}"
git diff --cached --quiet || git commit -qm "chore(release): ${tag}——版本号、CHANGELOG 与更新说明"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git tag "$tag"
step "push main and $tag"
direct git push -q gitlab HEAD:main
direct git push -q origin HEAD:main "$tag"

if [ -n "$daemon_only" ]; then
  step "build daemon fast channel (scripts/release.sh --daemon-only)"
  bash scripts/release.sh --daemon-only --allow-dirty
  echo "next: client_release_publish with dir=dist/$v, kind: \"daemon\""
  echo "then: $0 verify $v <server-url> --daemon-only"
  exit
fi

if ! direct gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  direct gh release create "$tag" --repo "$repo" --draft --verify-tag --title "共工空间 $tag" --notes-file "$notes"
fi
assets="$(direct gh release view "$tag" --repo "$repo" --json assets -q '.assets[].name')"
win="Gonggong_${v}_x64-setup.exe"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if ! grep -qx "$win.sig" <<< "$assets"; then
  step "start the Windows desktop build"
  direct gh workflow run desktop-windows.yml --repo "$repo" --ref "$tag" -f tag="$tag"
fi

step "build (scripts/release.sh)"
# The tree holds the bump commit and, at most, untracked files unrelated to the release.
bash scripts/release.sh --allow-dirty

step "upload to the draft release"
cd "$out"
shopt -s nullglob
files=(gonggong-"$v"-* gg-cast-"$v"-* Gonggong_"$v"_*.dmg Gonggong_"$v"_*.app.tar.gz Gonggong_"$v"_*.app.tar.gz.sig
  SHA256SUMS github/manifest.json)
printf '%s\0' "${files[@]}" |
  direct xargs -0 -P 4 -I{} gh release upload "$tag" {} --repo "$repo" --clobber

if ! grep -qx "$win.sig" <<< "$assets"; then
  step "wait for the Windows desktop build"
  run=""
  for _ in $(seq 30); do
    run="$(direct gh run list --repo "$repo" --workflow desktop-windows.yml --event workflow_dispatch -L 20 \
      --json databaseId,headBranch,createdAt \
      -q "[.[] | select(.headBranch == \"$tag\" and .createdAt >= \"$started\")] | last | .databaseId // empty")"
    [ -n "$run" ] && break
    sleep 10
  done
  [ -n "$run" ] || { echo "error: the Windows build did not start (gh run list --workflow desktop-windows.yml)" >&2; exit 1; }
  direct gh run watch "$run" --repo "$repo" --exit-status --interval 30 > /dev/null ||
    { echo "error: the Windows build failed: gh run view $run --repo $repo --log-failed" >&2; exit 1; }
fi
direct gh release download "$tag" --repo "$repo" --pattern "$win" --pattern "$win.sig" --dir . --clobber
for f in "$win" "$win.sig"; do
  size="$(direct gh release view "$tag" --repo "$repo" --json assets -q ".assets[] | select(.name == \"$f\") | .size")"
  [ "$(wc -c < "$f" | tr -d ' ')" = "$size" ] || { echo "error: $f is not the release asset's size ($size)" >&2; exit 1; }
done

step "publish the release"
# The Windows job merges its entry into whatever latest.json the release had; write the full feed here instead.
node -e '
  const fs = require("fs")
  const [file, sig, url] = process.argv.slice(1)
  const feed = JSON.parse(fs.readFileSync(file, "utf8"))
  feed.platforms["windows-x86_64"] = { signature: fs.readFileSync(sig, "utf8").trim(), url }
  fs.writeFileSync(file, JSON.stringify(feed, null, 2))
' github/latest.json "$win.sig" "https://github.com/$repo/releases/download/$tag/$win"
direct gh release upload "$tag" github/latest.json --repo "$repo" --clobber
direct gh release edit "$tag" --repo "$repo" --draft=false --latest
step "released $tag: https://github.com/$repo/releases/tag/$tag"
echo "next: client_release_publish with dir=dist/$v, then $0 verify $v <server-url>"
