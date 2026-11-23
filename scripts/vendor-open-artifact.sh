#!/usr/bin/env bash
# Copies the open-artifact packages we use, at one pinned commit, into vendor/open-artifact/ (plan 产物容器 §7).
# A pinned copy rather than `git subtree`: we keep 22 of its 46 packages, and subtree pulls would conflict on every
# package we dropped. Upgrading = rerun with a newer commit, `npm install` there, then replay PATCHES.md.
# Usage: scripts/vendor-open-artifact.sh <commit>
set -euo pipefail
cd "$(dirname "$0")/.."

commit="${1:?usage: scripts/vendor-open-artifact.sh <commit>}"
repo=https://github.com/JimLiu/open-artifact
packages=(
  runtime protocol editor-kit export-kit ui canvas-engine live-store design-system-core
  dc # slides-core parses slide HTML with @open-artifact/dc/html
  slides-core slides-editor
  whiteboard-core whiteboard-editor
  motion-core motion-editor motion-stage motion-export motion-audio
  wasm-export wasm-wb-geom wasm-motion wasm-canvas
)

src="$(mktemp -d)"
trap 'rm -rf "$src"' EXIT
git clone --quiet "$repo" "$src"
git -C "$src" checkout --quiet "$commit"
full="$(git -C "$src" rev-parse HEAD)"

dest=vendor/open-artifact
rm -rf "$dest/packages" "$dest/test-artifacts"
mkdir -p "$dest/packages" "$dest/test-artifacts"
# Its lockfile too, so `npm install` keeps upstream's resolved versions and only prunes the packages dropped.
cp "$src/LICENSE" "$src/NOTICE" "$src/package-lock.json" "$dest/"
for p in "${packages[@]}"; do cp -R "$src/packages/$p" "$dest/packages/$p"; done
cp -R "$src/test-artifacts/slides" "$dest/test-artifacts/slides"

# Root manifest and tsconfig cut down to the packages kept; their own manifests stay untouched.
node "$(dirname "$0")/vendor-open-artifact-manifest.mjs" "$src" "$dest" "${packages[@]}"
echo "$full" >"$dest/UPSTREAM"
echo "vendored open-artifact $full into $dest; now run: (cd $dest && npm install) and replay PATCHES.md"
