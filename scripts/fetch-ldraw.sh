#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d .ldraw.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
curl -fL -o "$tmp/complete.zip" https://library.ldraw.org/library/updates/complete.zip
unzip -q "$tmp/complete.zip" -d "$tmp"
test -f "$tmp/ldraw/LDConfig.ldr"
rm -rf ldraw
mv "$tmp/ldraw" ldraw
echo "LDraw library in $(pwd)/ldraw ($(ls ldraw/parts | wc -l | tr -d ' ') parts)"
