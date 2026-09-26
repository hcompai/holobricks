#!/usr/bin/env bash
# Build the read-only gallery and deploy it to Vercel: scripts/deploy-gallery.sh [--preview]
set -euo pipefail
cd "$(dirname "$0")/.."

builds=(
  38cbc874d1 # Hogwarts
  f9a4460bb1 # Westminster
  7710ea5076 # Place Saint-Germain-des-Prés
  2022dadb04 # Holo: Tower Bridge
  4b297daed0 # Holo: Cozy Village Square
  a176bde93b # Holo: Red and White Lighthouse
)

[[ -f web/.vercel/project.json ]] || (cd web && vercel link --yes --scope h-company --project brickyard)
(cd web && npm run build:gallery)
server/.venv/bin/brickyard-gallery web/.vercel/output/static "${builds[@]}"
echo '{"version": 3}' > web/.vercel/output/config.json
if [[ "${1:-}" == "--preview" ]]; then
  (cd web && vercel deploy --prebuilt)
else
  (cd web && vercel deploy --prebuilt --prod)
fi
