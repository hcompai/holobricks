#!/bin/sh
# Install the toolkit where this script is, put `bricks` on the PATH and the showcases in BUILD_DIR: sh setup.sh [BUILD_DIR]
set -eu
build=$(cd "${1:-.}" && pwd)
cd "$(dirname "$0")"
[ -f ldraw/LDConfig.ldr ] || sh scripts/fetch-ldraw.sh >/dev/null &
[ -d shadow ] || python3 scripts/fetch-connectors.py >/dev/null &
(cd server && uv sync --frozen --no-dev -q)
wait
test -f ldraw/LDConfig.ldr && test -f shadow/LICENSE.md && test -f data/rebrickable.json.gz
sudo=$([ -w /usr/local/bin ] || echo sudo)
printf '#!/bin/sh\nexec %s "$@"\n' "$(pwd)/server/.venv/bin/bricks" | $sudo tee /usr/local/bin/bricks >/dev/null
$sudo chmod +x /usr/local/bin/bricks
ln -sfn "$(pwd)/agent/showcase" "$build/showcase"
echo "Brickyard is ready: bricks works on the build in the directory it runs in."
