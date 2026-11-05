#!/bin/sh
set -e
if [ "$*" = "gg run" ] && [ ! -s "${GONGGONG_HOME:-$HOME/.gonggong}/config.json" ]; then
  # First start: bind with the 接入链接 from .env; once bound the volume keeps the config and this is skipped.
  if [ -n "$GONGGONG_BIND_URL" ]; then
    gg login "$GONGGONG_BIND_URL"
  else
    echo "本机还没有绑定：在 .env 里写上 GONGGONG_BIND_URL='<接入链接>' 后 docker compose up -d，或先执行 docker compose run --rm daemon gg login '<接入链接>'" >&2
    exit 1
  fi
fi
exec "$@"
