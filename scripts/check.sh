#!/usr/bin/env bash
# Pre-push self-check: typecheck + lint, then only the tests named after the change (Jenkins still runs everything).
# Usage: scripts/check.sh [--all] [base]   base defaults to origin/main; uncommitted and untracked files count too.
# web/server run the changed test files and those whose name contains a changed file's name or its feature/module
# directory; the daemon filters by module. A change with no namesake test, or outside src, runs the whole suite.
set -euo pipefail
cd "$(dirname "$0")/.."

all=false
[ "${1:-}" = "--all" ] && { all=true; shift; }
base="$(git merge-base HEAD "${1:-origin/main}")"
changed="$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)"

web=false desktop=false server=false protocol=false cargo=false tools=false
for f in $changed; do
  case "$f" in
    docs/* | *.md | e2e/* | videos/* | website/*) ;;
    apps/web/*) web=true desktop=true ;; # desktop imports web's src through @web
    apps/desktop/src-tauri/*) cargo=true ;;
    apps/desktop/*) desktop=true ;;
    apps/server/*) server=true ;;
    packages/protocol/*) all=true ;; # every side speaks the protocol, the daemon through its fixtures
    crates/* | Cargo.toml | Cargo.lock | rust-toolchain.toml | rustfmt.toml) cargo=true ;;
    tools/*.mjs) tools=true ;;
    tools/*) cargo=true ;; # the daemon's tests drive tools/mock-agent and tools/mcp-echo
    *) all=true ;; # lockfile, root config, scripts: no telling what they reach
  esac
done
$all && web=true desktop=true server=true protocol=true cargo=true tools=true

run() { echo "▶ $*"; "$@"; }

# Most test files boot the whole app, so the import graph would pick nearly all of them: match by name instead.
pick_tests() {
  local pkg=$1 f key keys picked="" hit index
  index="$(find "$pkg/src" "$pkg/test" \( -name '*.test.ts' -o -name '*.test.tsx' \) 2>/dev/null \
    | awk '{ n = $0; sub(/.*\//, "", n); n = tolower(n); gsub(/[-_]/, "", n); print n, $0 }')"
  for f in $(grep "^$pkg/" <<<"$changed"); do
    [ -f "$f" ] || continue
    case "$f" in
      *.test.ts | *.test.tsx) picked+="$f"$'\n'; continue ;;
      "$pkg"/src/*) ;;
      *) return ;; # test support, config, dependencies
    esac
    keys="$(sed -nE 's#.*/(modules|features)/([^/]+)/.*#\2#p' <<<"$f") $(basename "$f" | cut -d. -f1)"
    hit=""
    for key in $(tr 'A-Z' 'a-z' <<<"$keys" | tr -d '_-'); do
      case "$key" in index | types | utils | service | routes | schema | client | app | main) continue ;; esac
      [ ${#key} -gt 4 ] && key="${key%s}" # artifacts/ → artifactCanvas.test.tsx
      [ ${#key} -ge 4 ] && hit+="$(awk -v k="$key" 'index($1, k) { print $2 }' <<<"$index")"$'\n'
    done
    [ -n "$(tr -d '\n' <<<"$hit")" ] || return
    picked+="$hit"
  done
  grep -v '^$' <<<"$picked" | sort -u | sed "s#^$pkg/##"
}

vitest_suite() { # package dir, name
  local files
  if $all || ! files="$(pick_tests "$1")" || [ -z "$files" ]; then
    run pnpm --filter "$2" test
  else
    # shellcheck disable=SC2086
    run pnpm --filter "$2" exec vitest run $files
  fi
}

# Daemon modules: src/<m>.rs, src/<m>/…, tests/it/<m>.rs; test names start with the module path.
rust_filters() {
  local f m out=""
  for f in $changed; do
    case "$f" in
      crates/gonggong/src/lib.rs | crates/gonggong/src/main.rs) return ;;
      crates/gonggong/src/* | crates/gonggong/tests/it/*.rs) ;;
      crates/* | Cargo.toml | Cargo.lock | rust-toolchain.toml | rustfmt.toml | apps/desktop/src-tauri/* | tools/*) return ;;
      *) continue ;;
    esac
    m="${f#crates/gonggong/src/}"
    m="${m#crates/gonggong/tests/it/}"
    m="${m%%/*}"
    m="${m%.rs}"
    [ "$m" = main ] && return
    out+="$m "
  done
  echo "$out"
}

# Internal hosts and addresses stay out of the public repository; the patterns live in the git-ignored
# .internal-patterns (copied from the internal ops repository), so the list itself is not published either.
if [ -f .internal-patterns ]; then
  patterns="$(grep -v -e '^#' -e '^$' .internal-patterns)"
  if leaks="$(git grep --untracked -I -n -i -E -e "$(paste -sd'|' - <<<"$patterns")" -- . ':!.internal-patterns')"; then
    echo "✗ internal addresses in the repository (move them to the internal ops repository):" >&2
    echo "$leaks" | cut -c1-200 >&2
    exit 1
  fi
fi
run pnpm typecheck
run pnpm lint
$tools && run node --test tools/*.test.mjs
$protocol && run pnpm --filter @gonggong/protocol test
$desktop && run pnpm --filter @gonggong/desktop test
$web && vitest_suite apps/web @gonggong/web
$server && vitest_suite apps/server @gonggong/server
# Bot shells export provider config, git identity and proxies, which the daemon's tests must not see.
$cargo && run env -u CODEX_CONFIG -u MODEL_PROVIDER -u GG_PROVIDER_KEY \
  -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL \
  -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy cargo test --workspace \
  -- $($all || rust_filters)
echo "✓ check passed"
