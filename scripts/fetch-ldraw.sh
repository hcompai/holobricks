#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
curl -fL -o "$tmp/complete.zip" https://library.ldraw.org/library/updates/complete.zip
unzip -q "$tmp/complete.zip" -d "$tmp"
rm -rf ldraw
mv "$tmp/ldraw" ldraw
rm -rf "$tmp"
echo "LDraw library in $(pwd)/ldraw ($(ls ldraw/parts | wc -l | tr -d ' ') parts)"
