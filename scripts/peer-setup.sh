#!/usr/bin/env bash
# Set this Mac up as one of the two development machines (docs/domains/双机构建.md); safe to run again.
#   scripts/peer-setup.sh light|heavy <peer>.local
# light: the smaller machine (10.99.0.1), which hands the test suites heavy on memory (cargo, server) to the peer;
# heavy: the larger one (10.99.0.2), which hands the light ones (web, desktop, protocol) over instead.
set -euo pipefail
role="${1:-}" peer_host="${2:-}"
case "$role" in light) self_ip=10.99.0.1 peer_ip=10.99.0.2 ;; heavy) self_ip=10.99.0.2 peer_ip=10.99.0.1 ;; *)
  echo "usage: scripts/peer-setup.sh light|heavy <peer>.local" >&2
  exit 2
  ;;
esac
[ -n "$peer_host" ] || { echo "usage: scripts/peer-setup.sh light|heavy <peer>.local" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
# Same Node as the CI and release images (scripts/release/*Dockerfile).
node_version=24.15.0
pnpm_version="$(sed -nE 's/.*"packageManager": "pnpm@([^"]+)".*/\1/p' "$ROOT/package.json")"
brew() { HOMEBREW_NO_AUTO_UPDATE=1 /opt/homebrew/bin/brew "$@"; }

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm ls "$node_version" >/dev/null 2>&1 || nvm install "$node_version"
node_bin="$NVM_DIR/versions/node/v$node_version/bin"
[ "$("$node_bin/pnpm" --version 2>/dev/null)" = "$pnpm_version" ] ||
  PATH="$node_bin:$PATH" "$node_bin/npm" install -g "pnpm@$pnpm_version"

# rustup's proxies go first so rust-toolchain.toml decides the release (a Homebrew rustc would win otherwise).
cargo_bin="$HOME/.cargo/bin" # the official installer; Homebrew's rustup keeps its proxies in its own prefix
[ -x "$cargo_bin/rustup" ] || cargo_bin=/opt/homebrew/opt/rustup/bin
[ -x "$cargo_bin/rustup" ] || { echo "install rustup first: https://rustup.rs" >&2; exit 1; }
(cd "$ROOT" && "$cargo_bin/rustup" toolchain install >/dev/null &&
  "$cargo_bin/rustup" target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null)

# Tests call pg_dump and friends directly, so the PostgreSQL bin goes on PATH too.
pg_bin() {
  local d
  for d in "$(dirname "$(command -v pg_ctl 2>/dev/null || echo /none/x)")" /Applications/Postgres.app/Contents/Versions/latest/bin \
    /opt/homebrew/opt/postgresql@*/bin; do
    [ -x "$d/pg_dump" ] && echo "$d" && return
  done
  return 1
}
pg_bin >/dev/null || brew install postgresql@17

mkdir -p "$HOME/.config/gonggong"
cat >"$HOME/.config/gonggong/peer.env" <<EOF
# Written by scripts/peer-setup.sh: what scripts/peer.sh and check.sh need on this machine.
GG_ROLE=$role
GG_REPO=$ROOT
GG_CHECK_SLOTS=$([ "$role" = heavy ] && echo 2 || echo 1)
export PATH="$cargo_bin:$node_bin:$(pg_bin):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
EOF

# gg-peer: the Thunderbolt address when the cable answers within 100 ms, else the peer's name on the LAN.
config="$HOME/.ssh/config"
touch "$config"
block="# >>> gonggong peer
Match originalhost gg-peer exec \"ifconfig bridge0 2>/dev/null | grep -q 'inet $self_ip ' && ping -c1 -W 100 $peer_ip >/dev/null 2>&1\"
  HostName $peer_ip
Host gg-peer
  HostName $peer_host
  HostKeyAlias gg-peer
  Ciphers aes128-gcm@openssh.com
  Compression no
  ControlMaster auto
  ControlPath ~/.ssh/cm-%C
  ControlPersist 10m
  ServerAliveInterval 15
# <<< gonggong peer"
awk '/^# >>> gonggong peer/{skip=1} !skip{print} /^# <<< gonggong peer/{skip=0}' "$config" >"$config.tmp"
{ printf '%s\n\n' "$block"; cat "$config.tmp"; } >"$config"
rm "$config.tmp"
chmod 600 "$config"

ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new gg-peer true ||
  echo "warning: gg-peer is not reachable yet (Remote Login on, this machine's key in its authorized_keys?)" >&2
echo "✓ $role machine set up; peer: $peer_host"
if ! ifconfig bridge0 2>/dev/null | grep -q "inet $self_ip "; then
  echo "Thunderbolt: give this Mac a fixed address once (until then gg-peer goes through $peer_host):"
  echo "  sudo networksetup -setmanual \"Thunderbolt Bridge\" $self_ip 255.255.255.0"
fi
