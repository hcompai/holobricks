# Brickyard

Watch Holo build LEGO models from real LDraw parts, one instruction step at a time.

![Brickyard showing the Paris diorama](docs/brickyard.jpg)

- **Chat** to describe a model; Holo plans, builds, looks at its renders and fixes what is off.
- **Every brick is checked**: on the baseplate, no overlaps, resting on something.
- **Replay** the steps, browse the parts list, download the `.ldr`.

Gallery for the H team: [brickyard-h-company.vercel.app](https://brickyard-h-company.vercel.app) (Vercel login).

## Run

```bash
scripts/fetch-ldraw.sh                        # LDraw parts library into ./ldraw (145 MB)
cd server && uv sync && cd ..
cd web && npm install && npm run build && cd ..
server/.venv/bin/brickyard                    # http://127.0.0.1:8000
```

Hot reload: `cd web && npm run dev` (http://127.0.0.1:5173).

| Variable | Default |
| --- | --- |
| `HOLO_API_KEY` or `HAI_API_KEY` | unset: new builds use a scripted demo |
| `HOLO_MODEL`, `HOLO_BASE_URL` | `holo4-27b` on `api.hcompany.ai` |
| `BRICKYARD_PORT` | `8000`, on 127.0.0.1 only (no auth) |
| `BRICKYARD_DATA`, `BRICKYARD_LDRAW` | `./data`, `./ldraw` |

## Showcases and gallery

Paris, London and Hogwarts are scripted in `server/brickyard/showcase` with the same checked tools Holo uses.

```bash
server/.venv/bin/python -m brickyard.showcase paris   # or london, hogwarts
scripts/deploy-gallery.sh --preview                   # or --prod
```

Open a regenerated showcase once in the app to refresh its thumbnail before deploying.

## Tests

```bash
cd server && uv run pytest -q && uv run ruff check .
cd web && npm run typecheck
```
