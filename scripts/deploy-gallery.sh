#!/usr/bin/env bash
# Build the read-only gallery and deploy it to Vercel: scripts/deploy-gallery.sh --preview|--prod
set -euo pipefail
cd "$(dirname "$0")/.."

builds=(hogwarts 6eb28d127e london paris)

case "${1:-}" in
  --preview) target=() ;;
  --prod) target=(--prod) ;;
  *) echo "usage: $0 --preview|--prod" >&2; exit 2 ;;
esac

for id in "${builds[@]}"; do
  [[ -f "data/builds/$id.json" ]] || { echo "missing build $id: run server/.venv/bin/python -m brickyard.showcase $id" >&2; exit 1; }
  [[ -f "data/thumbnails/$id.png" ]] || echo "warning: no thumbnail for $id yet; open it once in the local app" >&2
done

[[ -f web/.vercel/project.json ]] || (cd web && vercel link --yes --scope h-company --project brickyard)
(cd web && npm run build:gallery)
server/.venv/bin/brickyard-gallery web/.vercel/output/static "${builds[@]}"
echo '{"version": 3}' > web/.vercel/output/config.json
(cd web && vercel deploy --prebuilt ${target[@]+"${target[@]}"})
