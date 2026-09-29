<h1 align="center">
  <img src="docs/brick.png" alt="" width="64" align="absmiddle" hspace="8" />
  Brickyard
</h1>

<p align="center">Watch Holo build LEGO models step by step.</p>

![Brickyard showing the Paris diorama](docs/brickyard.jpg)

- **Chat** to describe a model, with photos if you like. Holo writes a Python build script on a hosted Workstation, and every revision it shares appears in 3D.
- **Every brick is checked**: a run places the bricks that fit and names each one that does not by its script line.
  Checks use bounding boxes and supported stud connections; they do not certify strength or stability.
- **Replay** the steps, browse the parts list, download the `.ldr` or a PNG, export a GIF of the build.
- **Shop bricks**: copy a ready-made request into HoloTab, which imports the verified parts list on BrickLink and prepares carts for you to review and pay. See [SHOPPING.md](SHOPPING.md).
- **Follow up** on a finished build for an hour; **Stop** makes Holo wrap up with an answer, and the build stays open.

## How it works

```
browser: this web app                  Agents API (agp.eu.hcompany.ai)          Workstation
  start a session, send messages ───>  Holo (holo4-35b-a3b)  ──── shell ────>   bricks run, from the toolkit
  long-poll its events          <───   model.json.gz        <── share_files ──  model.json.gz
  answer `look` with a GPU render ──>  the image, as the tool result
```

- The app talks to the Agents API with the `hai-agents` SDK (`web/src/agent.ts`). A build is a session of the agent `brickyard`; the Library lists them, and the browser keeps each one's name, piece count and thumbnail in localStorage.
- The first message attaches the toolkit, `web/public/brickyard.tgz`: the `bricks` CLI, its Python package, the catalog snapshot and the showcases. Holo's first call runs `.brickyard/setup.sh`, which installs it and fetches LDraw and the connector data.
- `bricks run` rebuilds the model from `build.py` and writes `model.json.gz`: the steps and pieces, the LDraw parts they use, the `.ldr`, and the verified parts list and shopping XML (or why they could not be verified). Holo shares it with `share_files`; the browser downloads it and shows it.
- `look` is a custom tool: the browser renders the shared revision on your GPU and returns the image. Keep the tab open while Holo builds; it waits for the render.

## Run

```bash
scripts/fetch-ldraw.sh                        # LDraw parts library into ./ldraw (145 MB)
python3 scripts/fetch-connectors.py           # pinned LDCad stud/socket data for assembly plans
cd server && uv sync && cd ..
REBRICKABLE_API_KEY=... server/.venv/bin/brickyard-catalog   # data/rebrickable.json.gz, valid 30 days
server/.venv/bin/python scripts/pack-toolkit.py               # web/public/brickyard.tgz and LDConfig.ldr
cd web && npm install
VITE_HAI_API_KEY=$(grep '^HAI_API_KEY=' ~/code/hai/.env | cut -d= -f2- | tr -d '"') npm run dev   # http://localhost:5173
```

Without `VITE_HAI_API_KEY`, the app shows the showcases only. Export them for local use with
`BRICKYARD_DATA=<data dir> server/.venv/bin/brickyard-gallery web/public hogwarts 6eb28d127e london paris`.

| To change | Edit |
| --- | --- |
| model, step and time budget, idle timeout, the `look` tool | `web/src/agent.ts` |
| how Holo builds: workflow, the build script API, parts, colors | `agent/holo.md` |
| the build script functions | `server/brickyard/script.py` (document them in `agent/holo.md`) |
| the Workstation setup | `setup.sh`, then `scripts/pack-toolkit.py` |
| the icon | `scripts/brick-icon.py`, rendered with `blender -b -P scripts/brick-icon.py -- /tmp/brick.png`, then resized (`sips -Z`) and compressed (`pngquant`) into `docs/brick.png` (128 px), `web/public/brick.png` (64 px) and `web/public/brick-touch.png` (180 px, on white) |

Try the toolkit by hand: in a folder with a `build.py`, run `<repo>/server/.venv/bin/bricks run` (`--help` lists the tools).

## Showcases and deploy

Paris, London and Hogwarts are scripted in `server/brickyard/showcase` and pass the same checks as Holo's bricks. Bag End (`6eb28d127e`) is a Holo build: its script, `agent/showcase/bag-end.py`, is printed in full in Holo's prompt as the worked example.

```bash
server/.venv/bin/python -m brickyard.showcase paris   # or london, hogwarts: regenerates data/builds/paris.json
scripts/deploy.sh --preview                           # or --prod
```

`deploy.sh` packs the toolkit, exports the showcases into `web/public/gallery`, builds the app and deploys it to the Vercel project `brickyard`. The bundle is public, so it is built without an API key: the site shows the showcases, and building needs sign-in, which is not wired yet. Shopping packages expire with the catalog snapshot: rebuild it and redeploy at least every 30 days.

## Tests

```bash
cd server && uv run pytest -q && uv run ruff check . && cd ..
cd web && npm ci && npx playwright install chromium && npm test && npm run build
```

The server tests run the toolkit offline, with explicit catalog facts. The browser tests mock the Agents API and render real geometry: a build that shares models and asks for renders, the Library, shopping and the GIF export.

### Assembly plans

`python3 scripts/fetch-connectors.py` installs the pinned LDCad shadow library (CC BY-SA 4.0;
Roland Melkert and contributors). `BRICKYARD_SHADOW` can select another installed library. LDraw
geometry alone is not connector evidence. The independent assembly checker resolves supported
round studs and round/square sockets, rejects disconnected models, and checks straight insertion
corridors against conservative envelopes from the full part meshes. It never uses the viewer's
clipped footprint as a collision proof. Scaled/mirrored placements, nonorthogonal rotations and
unsupported joint dependencies are unverified, not silently accepted.

Every `bricks run` reports assembly findings. `bricks assembly` searches an order by accessible
removal, keeping the remainder connected, and reverses that order into assembly operations.
Connected cuts at articulation points can produce subassemblies; this is a bounded search, not a
complete solver. If it cannot find an order, Holo can submit `bricks assembly plan.json`:

```json
{
  "revision": "CURRENT_BUILD_REVISION",
  "root": "model",
  "groups": [
    {"id": "upper", "title": "Upper unit", "operations": [{"part": 2}, {"part": 3}]},
    {"id": "model", "title": "Main assembly", "operations": [{"part": 1}, {"assembly": "upper"}]}
  ]
}
```

IDs refer to physical instances in the current build, not catalog part numbers. Each instance is
introduced exactly once, each child assembly attached exactly once, and cycles/unused groups are
refused. All placements come from the immutable model snapshot. `approach`, when present, is the
unit vector **from the final position toward the outside** in LDraw coordinates; insertion follows
its opposite. The first unit has no direction. Accepted plans and reports are stored under the
build's `.brickyard-assembly/`.

**Scope of verification:** supported rigid stud/socket engagement, conservative straight insertion,
exact part accounting and reconstruction. This is not a physical test build or certification of
clutch force, structural strength, hand clearance, moving joints or flexible parts. Cavities may
cause conservative false rejections. Unsupported connections must gain a validated rule before a
manual is offered; they cannot be waived by a visual review. Keep models supported during assembly.
