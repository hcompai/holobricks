<h1 align="center">
  <img src="docs/brick.png" alt="" width="64" align="absmiddle" hspace="8" />
  Brickyard
</h1>

<p align="center">Watch Holo build LEGO models step by step.</p>

![Brickyard showing the Paris diorama](docs/brickyard.jpg)

- **Chat** to describe a model; Holo, a sagent agent, writes a Python build script, and every run rebuilds the model, streams the new steps and shows Holo the render.
- **Every brick is checked**: a run places the bricks that fit and names each one that does not by its script line.
  Checks use bounding boxes; they do not certify LEGO connections or physical stability.
- **Replay** the steps, browse the parts list, download the `.ldr`.
- **Shop bricks**: copy a ready-made request into HoloTab, which can import the saved parts list on BrickLink and prepare carts for you to review and pay. Includes a HoloTab install link; no extension integration or API key is required.
- **Catalog-checked inventory**: construction and shopping verify every part/color pair against BrickLink's
  Known colors. Unverified combinations are reported with repair choices; only complete verified inventories
  produce canonical BrickLink XML. See [SHOPPING.md](SHOPPING.md) for freshness and availability limits.
- **Share** a build film (MP4 + GIF) from the timeline or download menu, with an optional H Company logo for Holo builds.

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
| `HAI_ROOT` | unset: Holo is unavailable; new builds return an error instead of substituting a demo |
| `HAI_API_KEY`, `HAI_BASE_URL` | for Holo: your key, and `https://api.hcompany.ai/v1/models` |
| `LINKUP_API_KEY` | for Holo's image search |
| `HOLO_MODEL` | `holo4-27b` |
| `BRICKYARD_PORT` | `8000`, on 127.0.0.1 only (no auth) |
| `BRICKYARD_DATA`, `BRICKYARD_LDRAW` | `./data`, `./ldraw` |
| `BRICKYARD_CHROME` | the Chrome or Chromium found on the machine, for renders |

The chat's **New build** action always requests Holo. If this server is not configured for Holo, the prompt stays
in the composer and an error is shown; no construction is created. The scripted cottage remains available for
development only through an explicit `POST /api/builds` with `{"prompt":"demo","builder":"demo"}`.
Continuing a saved Holo build also requires Holo; an unavailable engine never falls back to the cottage.

## Holo, for now

Live building runs on your machine only. The Vercel site is a read-only gallery of finished builds.

```
your tab + headless Chrome  <── steps, renders ──>  brickyard server  ── starts ──>  sagent (hai venv), agent/holo.py
(viewers of web/dist)                               (FastAPI, :8000)                  │ edits build.py in data/workspaces/<build>
                                                          ▲                           │ shell: bricks run / look / parts
                                                          └────── HTTP tools API ─────┘
```

- Holo is a sagent Forest agent with the managed sandbox tools (`shell`, `write_file`, `search_replace`, `view_image`, ...) and a compactor. Its tool calls are shell commands and file edits: it writes `build.py` and runs `bricks run`, which rebuilds the model on the server from the first changed step, with the render attached (`@@attach`).
- `bricks run` places every brick that fits and names each one that does not (collisions, unknown parts) by its script line; the rest of the model is published. Floating bricks are placed and listed as a note. A script that stops leaves the model as it was. Support is checked over each complete step, independently of Python call order; this does not validate the physical order of assembly within a step.
- Every run also checks each part/color pair against BrickLink's Known colors and reports the unverified ones as problems, with the verified choices; `bricks colors <part>` lists them ahead of time, and `bricks check` audits the current inventory. `bricks run` exits 1 on any problem. When Holo exits, the server checks the inventory once more and marks the build as an error if it is not verified. BOM, gallery and shopping exports all require a complete verified inventory, bound to the current revision. Cold lookups use the public catalog; cached evidence is reused for 24 hours. Catalog checks verify recorded part/color combinations, not current seller stock or delivered prices.
- For references it has `web_search` (Linkup pages, then image URLs), `web_fetch` and `view_image`: it downloads the photos it wants into its workspace with `curl` and looks at them, all through the build. The user's photos are saved in `references/` and stay in its view after compaction.
- Renders come from a viewer: the server keeps a hidden Chrome on each build that asks for renders (until its run ends, or 10 idle minutes), so it renders whether or not your tab is open. It serves `web/dist`: rebuild it (`npm run build`) after web changes.
- Its workspace keeps `notes.md` (its working memory), the reference photos, and `showcase/` (`agent/showcase`: the showcase renders and sources).
- Viewers fetch complete, content-versioned snapshots instead of reconstructing geometry from partial events.
  A five-second foreground poll repairs missed events and recovers pending render requests. Background/finished
  tabs release event-stream connections; the managed headless renderer remains active. The canvas stays hidden
  until every asset for its revision has loaded and drawn, or shows a recoverable error. Asset requests expire after
  12 seconds; failed cache entries can retry. Agent images must match the exact geometry fingerprint, even for
  same-count edits, and cannot replace the live scene with an obsolete revision. Exported views use adaptive contours
  to avoid darkening small white surfaces; `look` also reports the stored LDraw color codes.
- sagent comes from a local hai checkout recent enough for Linkup's `include_images`: set `HAI_ROOT` to it, with its venv synced (`cd hai && uv sync`).

```bash
export HAI_ROOT=~/code/hai HAI_BASE_URL=https://api.hcompany.ai/v1/models
export HAI_API_KEY=$(grep '^HAI_API_KEY=' $HAI_ROOT/.env | cut -d= -f2- | tr -d '"')
export LINKUP_API_KEY=$(grep '^LINKUP_API_KEY=' $HAI_ROOT/.env | cut -d= -f2- | tr -d '"')
server/.venv/bin/brickyard
```

| To change | Edit |
| --- | --- |
| model, reasoning effort, step and time budget, tools | `agent/holo.yaml` |
| how Holo builds: principles, workflow, the build script API, parts, colors | `agent/holo.j2` |
| the build script functions | `server/brickyard/script.py` (document them in `agent/holo.j2`) |
| the icon | `scripts/brick-icon.py`, rendered with `blender -b -P scripts/brick-icon.py -- /tmp/brick.png`, then resized (`sips -Z`) and compressed (`pngquant`) into `docs/brick.png` (128 px), `web/public/brick.png` (64 px) and `web/public/brick-touch.png` (180 px, on white) |

Each request leaves `data/workspaces/<build>/runs/<time>.log` (what Holo did, as the terminal shows it) and `<time>.jsonl` (the full trajectory, reasoning included). The next request on the build replays these trajectories, so Holo continues the conversation. Try the tools by hand from a workspace: `BRICKYARD_BUILD=<build> ../../../server/.venv/bin/bricks run`.

Construction regression checks run without inference calls or user builds:

```bash
cd server
uv run pytest -q
uv run ruff check .
cd ../web
npm run build
cd ..
# Uses HAI's installed runtime and the server's pytest dependency, without modifying the HAI environment.
"$HAI_ROOT/.venv/bin/python" -c 'import site; from pathlib import Path; site.addsitedir(str(next(Path("server/.venv/lib").glob("python*/site-packages")))); import pytest; raise SystemExit(pytest.main(["-c", "agent/pytest.ini", "agent/tests", "-q"]))'
```

The agent tests build the real `agent/holo.yaml` with fake inference and resume a stopped run's history.

## Showcases and gallery

Paris, London and Hogwarts are scripted in `server/brickyard/showcase` and pass the same checks as Holo's bricks. Bag End (`6eb28d127e`) is a Holo build: its script, `agent/showcase/bag-end.py`, is printed in full in Holo's prompt as the worked example.

```bash
server/.venv/bin/python -m brickyard.showcase paris                            # or london, hogwarts
curl -fo agent/showcase/paris.png localhost:8000/api/builds/paris/sheet.png     # the render Holo learns from
server/.venv/bin/python scripts/hogwarts-sheet.py                              # Hogwarts' render: four close-ups
scripts/deploy-gallery.sh --preview                                             # or --prod
```

Open a regenerated showcase once in the app to refresh its thumbnail before deploying.

## Build films

Choose **Export film** in the timeline (or the download menu): bricks drop in step by step, the camera cranes up with the model, then the finished build takes a full turn and holds. The caption shows the build's name over the current step, and counts the pieces; Holo builds can carry the H Company logo.

With Chrome and ffmpeg on the server, the dialog renders a 1080p, 60 fps MP4 (H.264, CRF 18) and a GIF under 15 MB (X's limit), with progress and cancellation. The static gallery has no server, so it makes a 640 px GIF in the browser instead.

Every frame is a pure function of the build, the options, its index and its sample count: the server's headless Chrome runs the same film code as the browser, averaging jittered renders per frame for antialiasing and soft shadows, then ambient occlusion and tone mapping. Samples per frame are measured to fit a time budget (15 minutes by default), and drop one at a time if rendering falls behind.

```bash
brickyard-film hogwarts --aspect 16:9 --seconds 20  # Hogwarts-build.mp4 + .gif
brickyard-film --help                               # fps, samples, --minutes, --clicks, --dof
```

The CLI drives a running server (`BRICKYARD_URL`, default `http://127.0.0.1:8000`). Films replay a frozen copy of the saved steps, not the agent's working history; missing parts fail the film rather than show a partial model. Only Holo builds may carry the H Company logo.

## Tests

```bash
cd server && uv run pytest -q && uv run ruff check .
cd web && npm ci && npx playwright install chromium && npm test && npm run build
```

The browser tests use offline geometry and mocked build APIs, including a decoded in-browser GIF, the server film flow with cancellation/retry, a live snapshot, missing parts and file sharing. The server tests render a tiny film end to end when Chrome, ffmpeg and the built web app are present.
