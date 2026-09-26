# Brickyard

<img src="docs/brick.png" alt="The Brickyard brick" width="120" align="right" />

Watch Holo build LEGO models from real LDraw parts, one instruction step at a time.

![Brickyard showing the Paris diorama](docs/brickyard.jpg)

- **Chat** to describe a model; Holo, a sagent agent, writes a Python build script, and every run rebuilds the model, streams the new steps and shows Holo the render.
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
| `HAI_ROOT` | unset: new builds use a scripted demo instead of Holo |
| `HAI_API_KEY`, `HAI_BASE_URL` | for Holo: your key, and `https://api.hcompany.ai/v1/models` |
| `HOLO_MODEL` | `holo4-27b` |
| `BRICKYARD_PORT` | `8000`, on 127.0.0.1 only (no auth) |
| `BRICKYARD_DATA`, `BRICKYARD_LDRAW` | `./data`, `./ldraw` |
| `BRICKYARD_CHROME` | the Chrome or Chromium found on the machine, for renders |

## Holo, for now

Live building runs on your machine only. The Vercel site is a read-only gallery of finished builds.

```
your tab + headless Chrome  <── steps, renders ──>  brickyard server  ── starts ──>  sagent (hai venv), agent/holo.py
(viewers of web/dist)                               (FastAPI, :8000)                  │ edits build.py in data/workspaces/<build>
                                                          ▲                           │ shell: bricks run / reference / parts
                                                          └────── HTTP tools API ─────┘
```

- Holo is a sagent Forest agent with the managed sandbox tools (`shell`, `write_file`, `search_replace`, `view_image`, ...). Its tool calls are shell commands and file edits: it writes `build.py` and runs `bricks run`, which rebuilds the model on the server and prints the problems by line, with the render attached (`@@attach`).
- Renders come from a viewer: the server opens a headless Chrome on the build for each request, so it renders whether or not your tab is open. It serves `web/dist`: rebuild it (`npm run build`) after web changes.
- Its workspace keeps `notes.md` (its memory, fed back with each request), the reference photos, and `showcase/` (`agent/showcase`: the showcase renders and sources).
- sagent comes from a local hai checkout: set `HAI_ROOT` to it, with its venv synced (`cd hai && uv sync`).

```bash
export HAI_ROOT=~/code/hai HAI_BASE_URL=https://api.hcompany.ai/v1/models
export HAI_API_KEY=$(grep '^HAI_API_KEY=' $HAI_ROOT/.env | cut -d= -f2- | tr -d '"')
server/.venv/bin/brickyard
```

| To change | Edit |
| --- | --- |
| model, reasoning effort, step and time budget, tools | `agent/holo.yaml` |
| how Holo builds: principles, workflow, the build script API, parts, colors | `agent/holo.j2` |
| the build script functions | `server/brickyard/script.py` (document them in `agent/holo.j2`) |
| the icon | `scripts/brick-icon.py`, rendered with `blender -b -P scripts/brick-icon.py -- docs/brick.png` |

Each request leaves `data/workspaces/<build>/runs/<time>.log` (what Holo did, as the terminal shows it) and `<time>.jsonl` (the full trajectory, reasoning included). Try the tools by hand from a workspace: `BRICKYARD_BUILD=<build> ../../../server/.venv/bin/bricks run`.

## Showcases and gallery

Paris, London and Hogwarts are scripted in `server/brickyard/showcase` and pass the same checks as Holo's bricks.

```bash
server/.venv/bin/python -m brickyard.showcase paris                            # or london, hogwarts
curl -fo agent/showcase/paris.png localhost:8000/api/builds/paris/sheet.png     # the render Holo learns from
scripts/deploy-gallery.sh --preview                                             # or --prod
```

Open a regenerated showcase once in the app to refresh its thumbnail before deploying.

## Tests

```bash
cd server && uv run pytest -q && uv run ruff check .
cd web && npm run typecheck
```
