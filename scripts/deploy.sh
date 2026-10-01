#!/usr/bin/env bash
# Build the web app with the toolkit and the showcases, and deploy it to Vercel: scripts/deploy.sh --preview|--prod
# Pushes to master that pass CI deploy to production, and so does a weekly run that keeps the catalog snapshot fresh:
# the deploy job in .github/workflows/ci.yml runs this with CI set.
set -euo pipefail
cd "$(dirname "$0")/.."

builds=(hogwarts 6eb28d127e london paris)
data=${BRICKYARD_DATA:-data}
# The GitHub release holding what a deploy needs beyond git: the exported showcases and the catalog snapshot.
release=deploy-data

case "${1:-}" in
  --preview) target=() ;;
  --prod) target=(--prod) ;;
  *) echo "usage: $0 --preview|--prod" >&2; exit 2 ;;
esac
vercel=()
[[ -n "${VERCEL_TOKEN:-}" ]] && vercel=(--token "$VERCEL_TOKEN")

mkdir -p data
if [[ -n "${CI:-}" ]]; then
  gh release download "$release" --dir data --clobber
  rm -rf web/public/gallery && tar xzf data/gallery.tgz -C web/public
else
  for id in "${builds[@]}"; do
    [[ -f "$data/builds/$id.json" ]] || { echo "missing build $id: run server/.venv/bin/python -m brickyard.showcase $id" >&2; exit 1; }
  done
  BRICKYARD_DATA=$data server/.venv/bin/brickyard-gallery web/public "${builds[@]}"
  (cd web && node scripts/thumbnails.mjs)
  tar czf data/gallery.tgz -C web/public gallery
  gh release upload "$release" data/gallery.tgz --clobber
fi

# The toolkit refuses a catalog snapshot after 30 days, so each deploy ships one with at least 10 left.
catalog=${BRICKYARD_CATALOG:-data/rebrickable.json.gz}
server/.venv/bin/brickyard-catalog --out "$catalog" --max-age 20
[[ "$catalog" -ef data/rebrickable.json.gz ]] || cp "$catalog" data/rebrickable.json.gz
gh release upload "$release" data/rebrickable.json.gz --clobber
server/.venv/bin/python scripts/pack-toolkit.py
# web/public/pick-a-brick.json: today's Pick a Brick prices for the estimate, else the last table fetched.
if server/.venv/bin/brickyard-prices; then
  gh release upload "$release" web/public/pick-a-brick.json --clobber
else
  echo "warning: Pick a Brick did not answer; deploying the last price table" >&2
  gh release download "$release" --pattern pick-a-brick.json --dir web/public --clobber
fi
# A project token cannot link; CI names the project with VERCEL_ORG_ID and VERCEL_PROJECT_ID instead.
[[ -f web/.vercel/project.json || -n "${VERCEL_PROJECT_ID:-}" ]] || (cd web && vercel link --yes --scope h-company --project brickyard ${vercel[@]+"${vercel[@]}"})
(cd web && npm run build)
rm -rf web/.vercel/output && mkdir -p web/.vercel/output
cp -R web/dist web/.vercel/output/static
(cd web && node scripts/build-api.mjs .vercel/output)
(cd web && vercel deploy --prebuilt ${target[@]+"${target[@]}"} ${vercel[@]+"${vercel[@]}"})
