#!/bin/sh
# First start: create the data key and a self-signed certificate (shared with nginx) in the data volume.
set -eu
tls=/data/tls
if [ -z "${GONGGONG_DATA_KEY:-}" ]; then
  [ -f /data/data.key ] || (umask 077 && openssl rand -base64 32 > /data/data.key)
  GONGGONG_DATA_KEY="$(cat /data/data.key)"
  export GONGGONG_DATA_KEY
fi
if [ -z "${GONGGONG_TLS_CERT:-}" ]; then
  if [ ! -f "$tls/cert.pem" ]; then
    mkdir -p "$tls"
    host="$(echo "${GONGGONG_PUBLIC_URL:-https://localhost}" | sed -E 's#^[a-z]+://##; s#[:/].*$##')"
    case "$host" in *[!0-9.]*) san="DNS:$host" ;; *) san="IP:$host" ;; esac
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
      -keyout "$tls/key.pem" -out "$tls/cert.pem" -subj "/CN=$host" \
      -addext "subjectAltName=$san,DNS:localhost,IP:127.0.0.1" 2>/dev/null
    chmod 600 "$tls/key.pem"
  fi
  export GONGGONG_TLS_CERT="$tls/cert.pem" GONGGONG_TLS_KEY="$tls/key.pem"
fi
exec "$@"
