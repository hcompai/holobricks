#!/usr/bin/env bash
# Build the web app with the toolkit and the showcases, and deploy it to Vercel: scripts/deploy.sh --preview|--prod
set -euo pipefail
cd "$(dirname "$0")/.."

builds=(hogwarts 6eb28d127e london paris)
data=${BRICKYARD_DATA:-data}

case "${1:-}" in
  --preview) target=() ;;
  --prod) target=(--prod) ;;
  *) echo "usage: $0 --preview|--prod" >&2; exit 2 ;;
esac

for id in "${builds[@]}"; do
  [[ -f "$data/builds/$id.json" ]] || { echo "missing build $id: run server/.venv/bin/python -m brickyard.showcase $id" >&2; exit 1; }
  [[ -f "$data/thumbnails/$id.png" ]] || echo "warning: no thumbnail for $id yet" >&2
done

server/.venv/bin/python scripts/pack-toolkit.py
server/.venv/bin/brickyard-prices   # web/public/pick-a-brick.json: today's Pick a Brick prices for the estimate
BRICKYARD_DATA=$data server/.venv/bin/brickyard-gallery web/public "${builds[@]}"
[[ -f web/.vercel/project.json ]] || (cd web && vercel link --yes --scope h-company --project brickyard)
(cd web && npm run build)
rm -rf web/.vercel/output && mkdir -p web/.vercel/output
cp -R web/dist web/.vercel/output/static
(cd web && node scripts/build-api.mjs .vercel/output)
echo '{"version": 3}' > web/.vercel/output/config.json
(cd web && vercel deploy --prebuilt ${target[@]+"${target[@]}"})
