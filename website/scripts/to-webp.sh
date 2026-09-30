#!/usr/bin/env bash
# Converts captured PNGs under public/screenshots to WebP (docs reference .webp) and removes the PNGs.
set -euo pipefail
cd "$(dirname "$0")/../public/screenshots"
for png in */*.png; do
  cwebp -quiet -q 90 -m 6 "$png" -o "${png%.png}.webp" && rm "$png"
done
