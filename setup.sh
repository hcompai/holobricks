#!/bin/sh
# Install the toolkit where this script is, put `bricks` on the PATH and the showcases in BUILD_DIR: sh setup.sh [BUILD_DIR]
# BRICKYARD_MINUTES, the session's time limit, starts the clock that `bricks run` reports.
set -eu
build=$(cd "${1:-.}" && pwd)
cd "$(dirname "$0")"
lock=$(pwd)/.setup.lock
# A lock whose setup was killed outright is free again; one still writing its pid is taken.
dead() { [ -f "$lock/pid" ] && ! kill -0 "$(cat "$lock/pid")" 2>/dev/null; }
if ! mkdir "$lock" 2>/dev/null; then
  echo "Another setup is running; waiting for it to finish."
  until mkdir "$lock" 2>/dev/null; do
    if dead; then rm -rf "$lock"; else sleep 2; fi
  done
fi
echo $$ > "$lock/pid"
trap 'rm -rf "$lock"' EXIT
trap 'exit 1' INT TERM
if [ -n "${BRICKYARD_MINUTES:-}" ] && [ ! -f "$build/.brickyard-clock" ]; then
  printf '{"started": %s, "minutes": %s}\n' "$(date +%s)" "$BRICKYARD_MINUTES" > "$build/.brickyard-clock"
fi
sudo=$([ -w /usr/local/bin ] || echo sudo)
printf '#!/bin/sh\nkill -0 "$(cat "%s/pid" 2>/dev/null)" 2>/dev/null && { echo "Brickyard is still installing: poll its setup until it prints Brickyard is ready." >&2; exit 1; }\nexec "%s" "$@"\n' \
  "$lock" "$(pwd)/server/.venv/bin/bricks" | $sudo tee /usr/local/bin/bricks >/dev/null
$sudo chmod +x /usr/local/bin/bricks
echo "Installing Brickyard: downloading the LDraw parts library (145 MB), then indexing it; this takes a few minutes."
[ -f ldraw/LDConfig.ldr ] || sh scripts/fetch-ldraw.sh >/dev/null &
[ -d shadow ] || python3 scripts/fetch-connectors.py >/dev/null &
(cd server && uv sync --frozen --no-dev -q)
wait
test -f ldraw/LDConfig.ldr && test -f shadow/LICENSE.md && test -f data/rebrickable.json.gz
server/.venv/bin/python -c 'from brickyard import ldraw; ldraw.exists("3001.dat"); ldraw.catalog()'
ln -sfn "$(pwd)/agent/showcase" "$build/showcase"
echo "Brickyard is ready: bricks works on the build in the directory it runs in."
