#!/bin/sh
# Installs gg (the gonggong daemon) for this user, binds this machine and keeps it running in the background.
# Usage: sh install.sh --code XXXX-XXXX --agent claude|codex|gemini|codebuddy|pi|deepseek [--server URL] [--no-service]
# Never needs sudo: gg goes to ~/.local/bin.
set -eu

SERVER='{{SERVER}}'
CODE=''
AGENT=''
PLATFORM=''
SERVICE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --code) CODE="$2"; shift 2 ;;
    --agent) AGENT="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --no-service) SERVICE=0; shift ;;
    *) echo "install.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

fail() { echo "install.sh: $*" >&2; exit 1; }
[ -n "$CODE" ] || fail "missing --code (the 接入码 XXXX-XXXX from the web page)"
[ -n "$AGENT" ] || fail "missing --agent (claude, codex, gemini, codebuddy, pi or deepseek)"
command -v curl >/dev/null 2>&1 || fail "curl is required"

if [ -z "$PLATFORM" ]; then
  case "$(uname -s)" in
    Darwin) os=macos ;;
    Linux) os=linux ;;
    *) fail "unsupported system $(uname -s): on Windows use the desktop app" ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=aarch64 ;;
    x86_64 | amd64) arch=x86_64 ;;
    *) fail "unsupported CPU $(uname -m)" ;;
  esac
  PLATFORM="$os-$arch"
fi

# Never take a machine away from another server (e.g. the desktop app's binding): the user decides that.
config="${GONGGONG_HOME:-$HOME/.gonggong}/config.json"
if [ -f "$config" ]; then
  bound=$(sed -n 's/.*"server": *"\([^"]*\)".*/\1/p' "$config" | head -n 1)
  if [ -n "$bound" ] && [ "$bound" != "$SERVER" ]; then
    fail "this machine is already bound to $bound (gg or the desktop app); not changing it. Ask the user before re-binding it to $SERVER"
  fi
fi

echo "==> Looking up gg for $PLATFORM on $SERVER"
build=$(curl -fsSL "$SERVER/api/install/gg?platform=$PLATFORM") || fail "no gg build for $PLATFORM on $SERVER"
url=$(printf '%s' "$build" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
sha=$(printf '%s' "$build" | sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p')
[ -n "$url" ] && [ -n "$sha" ] || fail "unexpected answer from $SERVER: $build"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

bin="$HOME/.local/bin"
# A rerun (say, after the agent's command timed out while gg waited for a web confirmation) keeps the same gg.
if [ -x "$bin/gg" ] && [ "$(sha256 "$bin/gg")" = "$sha" ]; then
  echo "==> $bin/gg is already installed and up to date"
else
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  echo "==> Downloading $url"
  curl -fsSL -o "$tmp/gg" "$url" || fail "download failed: $url"
  got=$(sha256 "$tmp/gg")
  [ "$got" = "$sha" ] || fail "sha256 mismatch: expected $sha, got $got (not installed)"
  mkdir -p "$bin"
  mv "$tmp/gg" "$bin/gg"
  chmod 755 "$bin/gg"
  echo "==> Installed $bin/gg"
fi

"$bin/gg" login --server "$SERVER" --code "$CODE" --create-bot "$AGENT"
if [ "$SERVICE" = 1 ]; then
  "$bin/gg" service install
fi
"$bin/gg" status
