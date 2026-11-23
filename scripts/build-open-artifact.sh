#!/usr/bin/env bash
# Builds open-artifact editors with their own Vite configs (plan 产物容器 §7) into vendor/open-artifact/dist/editors/<type>/
# (git-ignored: a 2.7 MB minified bundle per editor, rebuilt from the vendored source).
# Not into the official plugin's editor/ folder yet: syncBuiltinPlugins stores a plugin folder in the database and caps
# it at PLUGIN_MAX_BYTES (5 MB); slides is 3.5 MB before its editor (docs/plan/产物容器-S0-spike.md §6).
# Usage: scripts/build-open-artifact.sh [slides|whiteboard|motion]...   (default: slides)
set -euo pipefail
cd "$(dirname "$0")/../vendor/open-artifact"

node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' ||
  { echo "✗ open-artifact needs Node ≥ 22.18 (have $(node --version))" >&2; exit 1; }
[ -d node_modules ] || npm ci --no-audit --no-fund

for type in "${@:-slides}"; do
  case "$type" in
    slides | whiteboard | motion) ;;
    *) echo "✗ unknown editor: $type" >&2; exit 1 ;;
  esac
  node node_modules/vite/bin/vite.js build --config "packages/$type-editor/vite.config.ts" \
    --outDir "$PWD/dist/editors/$type" --emptyOutDir --logLevel warn
  echo "✓ $type → vendor/open-artifact/dist/editors/$type ($(du -sh "dist/editors/$type" | cut -f1))"
done
