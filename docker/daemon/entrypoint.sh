#!/bin/sh
set -e
if [ "$*" = "gg run" ] && [ ! -s "${GONGGONG_HOME:-$HOME/.gonggong}/config.json" ]; then
  echo "本机还没有绑定：先执行 docker compose run --rm daemon gg login '<接入链接>'，再 docker compose up -d" >&2
  exit 1
fi
exec "$@"
