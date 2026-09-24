#!/usr/bin/env bash
# Self-signed dev certificate for localhost, 127.0.0.1 and this machine's LAN IPv4 addresses (plan D18). Usage: scripts/dev-cert.sh [out-dir]
set -euo pipefail
dir="${1:-.aiws-dev/tls}"
mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
lan=$(node -p 'Object.values(os.networkInterfaces()).flat().filter(a => a.family === "IPv4" && !a.internal).map(a => ",IP:" + a.address).join("")')
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
  -keyout "$dir/key.pem" -out "$dir/cert.pem" -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1$lan" 2>/dev/null
chmod 600 "$dir/key.pem"
echo "AIWS_TLS_CERT=$dir/cert.pem AIWS_TLS_KEY=$dir/key.pem"
openssl x509 -in "$dir/cert.pem" -noout -fingerprint -sha256 | sed 's/.*=/sha256:/'
