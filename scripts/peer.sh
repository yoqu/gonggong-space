#!/usr/bin/env bash
# Run a command in this worktree's copy on the peer machine (docs/domains/双机构建.md):
#   scripts/peer.sh <command…>   sync the working tree (gitignored files stay out), then run it there, exit code kept
#   scripts/peer.sh --ping        exit 0 when the peer is set up and reachable
#   scripts/peer.sh --dir         the copy's directory on the peer, relative to its home
# GG_PEER_SEND: git-ignored paths to send as well (space separated), e.g. a frontend build the command embeds.
# Exits 75 when the peer is off (GG_PEER=off), unreachable or not set up, so callers can fall back to running locally.
# Each machine's ~/.config/gonggong/peer.env (scripts/peer-setup.sh) holds its main checkout, PATH and role; copies
# live in ~/gg-peer/<host>-<worktree> as worktrees of the peer's checkout, so they share its Postgres and pnpm store.
set -euo pipefail
peer="${GG_PEER:-gg-peer}"
[ "$peer" != off ] || exit 75
top="$(git rev-parse --show-toplevel)"
env_file='$HOME/.config/gonggong/peer.env'
ssh_peer() { ssh -o BatchMode=yes -o ConnectTimeout=3 "$peer" "$@"; }

[ $# -gt 0 ] || { echo "usage: scripts/peer.sh <command…> | --ping" >&2; exit 2; }
name="$(scutil --get LocalHostName 2>/dev/null || hostname -s)-$(basename "$top")"
dir="gg-peer/$name"
[ "$1" != --dir ] || { echo "$dir"; exit 0; }
prepare="[ -f $env_file ] || exit 75; . $env_file"
[ "$1" = --ping ] || prepare+="; [ -e ~/$dir/.git ] || git -C \"\$GG_REPO\" worktree add -q --detach ~/$dir >&2"
rc=0
ssh_peer "$prepare" 2>/dev/null || rc=$?
case $rc in 0) ;; 75 | 255) echo "peer $peer: unreachable or not set up (scripts/peer-setup.sh)" >&2 && exit 75 ;; *) exit $rc ;; esac
[ "$1" != --ping ] || exit 0
# Git-ignored paths are not sent; the root .gitignore's are not deleted there either (macOS's openrsync does not
# protect a receiver's files by the nested .gitignore files), so the peer keeps its own node_modules, target, builds.
rsync -a --delete -e "ssh -o BatchMode=yes" --filter=':- .gitignore' --exclude-from="$top/.gitignore" \
  --exclude=.git "$top/" "$peer:$dir/"
for path in ${GG_PEER_SEND:-}; do
  [ ! -e "$top/$path" ] || rsync -a --delete -e "ssh -o BatchMode=yes" "$top/$path/" "$peer:$dir/$path/"
done

# Without SSH_CLIENT a bash the command starts does not source ~/.bashrc, which may put another Node first.
remote="unset SSH_CLIENT SSH2_CLIENT; . $env_file; cd ~/$dir || exit 1
lock=pnpm-lock.yaml h=\"\$(shasum \$lock)\"
[ \"\$(cat node_modules/.peer-lock 2>/dev/null)\" = \"\$h\" ] ||
  { pnpm install --frozen-lockfile --prefer-offline >&2 && echo \"\$h\" > node_modules/.peer-lock; } || exit 1
exec $(printf '%q ' "$@")"
# A terminal gets one there too, so Ctrl-C stops the remote command rather than only this ssh.
tty=()
[ -t 0 ] && [ -t 1 ] && tty=(-t)
exec ssh -o BatchMode=yes ${tty[@]+"${tty[@]}"} "$peer" "bash -c $(printf '%q' "$remote")"
