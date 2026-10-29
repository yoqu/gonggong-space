#!/usr/bin/env bash
# Publishes an assembled dist/<version> (scripts/release.sh --assemble), as the Jenkins release job does:
#   scripts/release/publish.sh github <version>        draft release with every asset, then published as latest
#   scripts/release/publish.sh server <version> <url>  each file through the admin upload (POST
#                                                      /api/admin/daemon-release/files) as GONGGONG_ADMIN_ACCOUNT /
#                                                      GONGGONG_ADMIN_PASSWORD; the notes last, once the release exists
# Every step can run again: uploads replace what is there.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

where="${1:-}" v="${2:-}"
[[ $v =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 github|server <version> [<server-url>]" >&2; exit 2; }
out="$ROOT/dist/$v"
cd "$out"
[ -f SHA256SUMS ] || { echo "error: $out is not assembled (scripts/release.sh --assemble)" >&2; exit 1; }
shopt -s nullglob
files=(gonggong-"$v"-* gg-cast-"$v"-* Gonggong_"$v"_*)

case "$where" in
  github)
    repo="${GONGGONG_GITHUB_REPO:-yoqu/gonggong-space}" tag="v$v"
    if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
      gh release create "$tag" --repo "$repo" --draft --verify-tag --title "共工空间 $tag" \
        --notes-file "$( [ -f RELEASE_NOTES.md ] && echo RELEASE_NOTES.md || echo /dev/null)"
    fi
    # github/manifest.json and github/latest.json upload as manifest.json and latest.json.
    printf '%s\0' "${files[@]}" SHA256SUMS github/manifest.json github/latest.json |
      xargs -0 -P 4 -I{} gh release upload "$tag" {} --repo "$repo" --clobber
    gh release edit "$tag" --repo "$repo" --draft=false --latest
    echo "published $tag: https://github.com/$repo/releases/tag/$tag"
    ;;
  server)
    server="${3:?server url}"
    server="${server%/}"
    : "${GONGGONG_ADMIN_PASSWORD:?GONGGONG_ADMIN_PASSWORD is required}"
    jar="$(mktemp)"
    trap 'rm -f "$jar"' EXIT
    # Body built from the environment and sent on stdin: kept out of `ps`.
    GONGGONG_ADMIN_ACCOUNT="${GONGGONG_ADMIN_ACCOUNT:-admin}" node -e \
      'const e = process.env; process.stdout.write(JSON.stringify({ account: e.GONGGONG_ADMIN_ACCOUNT, password: e.GONGGONG_ADMIN_PASSWORD }))' |
      curl -sS --fail-with-body -c "$jar" -H 'content-type: application/json' -o /dev/null "$server/api/auth/login" --data @-
    upload() {
      curl -sS --fail-with-body -b "$jar" -o /dev/null --retry 3 --retry-all-errors \
        -F "file=@$1" "$server/api/admin/daemon-release/files" && echo "ok   $1"
    }
    export -f upload
    export jar server
    printf '%s\0' "${files[@]}" | xargs -0 -P 4 -I{} bash -c 'upload "$1"' _ {}
    [ ! -f RELEASE_NOTES.md ] || upload RELEASE_NOTES.md
    ;;
  *) echo "usage: $0 github|server <version> [<server-url>]" >&2; exit 2 ;;
esac
