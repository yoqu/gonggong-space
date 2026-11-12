#!/bin/sh
set -e
# gg runs from the volume so an upgrade started on the web survives a rebuilt container; a newer image's gg wins.
bin="$HOME/.local/bin"
image="$(/opt/gonggong/gg --version | cut -d' ' -f2)"
current="$([ -x "$bin/gg" ] && "$bin/gg" --version | cut -d' ' -f2 || true)"
if [ "$image" != "$current" ] && [ "$(printf '%s\n%s\n' "$current" "$image" | sort -V | tail -n1)" = "$image" ]; then
  mkdir -p "$bin"
  cp /opt/gonggong/gg "$bin/.gg.new" && mv "$bin/.gg.new" "$bin/gg"
fi
if [ "$*" = "gg run" ] && [ ! -s "${GONGGONG_HOME:-$HOME/.gonggong}/config.json" ]; then
  # First start: bind with the 接入链接 from .env; once bound the volume keeps the config and this is skipped.
  if [ -n "$GONGGONG_BIND_URL" ]; then
    # Unattended: nobody is watching for a web confirmation, so an expired code fails and is generated again.
    gg login --code-only "$GONGGONG_BIND_URL"
  else
    echo "本机还没有绑定：在 .env 里写上 GONGGONG_BIND_URL='<接入链接>' 后 docker compose up -d，或先执行 docker compose run --rm daemon gg login '<接入链接>'" >&2
    exit 1
  fi
fi
exec "$@"
