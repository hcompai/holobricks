# HoloBricks internals

Setup, architecture, deploy and the toolkit's checks. The [main README](../README.md) is the tour.

- [Features in detail](#features-in-detail)
- [How it works](#how-it-works)
- [Run](#run)
- [Accounts and the public library](#accounts-and-the-public-library)
- [Where to change things](#where-to-change-things)
- [Showcases and deploy](#showcases-and-deploy)
- [Tests](#tests)
- [Assembly plans](#assembly-plans)
- [Recovery checkpoints](#recovery-checkpoints)
- [Keeping the browser available](#keeping-the-browser-available)

## Features in detail

- **Chat** to describe a model, with photos if you like. Holo writes a Python build script on a hosted Workstation, and every revision it shares appears in 3D. Ask for changes at any time, even while Holo builds: a message reaches it at once and Holo folds it in at its next step, without stopping. A build whose session ended takes them as a remix, from a copy. **Stop** (shown while the composer is empty) makes Holo wrap up with an answer, and the build stays open.
- **Every brick is checked**: a run places the bricks that fit and names each one that does not by its script line. Checks use bounding boxes and supported stud connections; they do not certify strength or stability.
- **Replay** the steps on the timeline, browse the Parts tab, and from **Share** download the `.ldr` or a PNG, or make a GIF of the build (8 seconds by default, up to 30).
- **Building instructions** (Share, or the Get the bricks sheet): a PDF with a cover, then each step split into layers from the bottom up, one page each, the new pieces outlined in a render framed on the model so far and pictured in a parts callout, and the whole parts list at the end. It is drawn in the browser, so it includes your edits; large models take a while (the Grand Rex makes about 250 pages).
- **Get the bricks**: one sheet with BrickLink carts through HoloTab (it imports the verified parts list and prepares carts for you to review and pay), a Pick a Brick list with its price, and the instructions. See [SHOPPING.md](../SHOPPING.md).
- **Edit** by hand: choose **Edit**, click a piece (the one under the pointer is outlined), Shift-click to add more or Shift-drag a box around the pieces you see (Shift-Option-drag takes hidden ones too), then move them a stud or a plate, turn them a quarter about their middle, recolor them from the LDraw palette, duplicate them beside themselves (⌘D) or delete them; undo, redo and reset. The **?** button or key lists every shortcut. Edits are saved in this browser per build and revision, and the `.ldr` download includes them. The builder never sees them: the Parts tab counts the edited model's parts without BrickLink verification, shopping stays off while a model is edited, edits are hidden while the builder works, and a new revision leaves them to discard.
- **Walk** through the model like in Minecraft: choose **Walk**, click the model, then WASD or the arrows to move and the mouse to look. You stand on the bricks and step up one brick at a time; Space jumps, W twice sprints, Space twice flies (Space up, Shift down), and arches, doors and plants let you through. Esc releases the mouse, Esc again leaves.
- **Import a build**: the Your builds section of the home page imports a model file (what `brickyard-gallery` exports, or a session's `model.json.gz`) as your public build, after a confirmation. `/api/imports` checks every piece and part, recomputes the revision and `.ldr`, keeps the chat's text without its images, and marks the parts list unverified. Imported builds show under Your builds too.

## How it works

```
browser: this web app                  Agents API (agp.eu.hcompany.ai)          Workstation
  start a session, send messages ───>  Holo (holo4-27b)    ──── shell ────>   bricks run, from the toolkit
  long-poll its events          <───   model.json.gz        <── share_files ──  model.json.gz
  answer `look` with a GPU render ──>  the image, as the tool result
```

- The app talks to the Agents API with the `hai-agents` SDK (`web/src/agent.ts`). A build is a session of the agent `brickyard`; the home page lists them, and the browser keeps each one's name, piece count and thumbnail in localStorage.
- The first message attaches the toolkit, `web/public/brickyard.tgz`: the `bricks` CLI, its Python package, the catalog snapshot and the showcases. Holo's first call runs `.brickyard/setup.sh`, which installs it and fetches LDraw and the connector data; a second call waits for the first. `BRICKYARD_MINUTES`, the session's time limit, starts the clock each `bricks run` reports.
- `bricks run` rebuilds the model from `build.py` and writes `model.json.gz`: the steps and pieces, the LDraw parts they use, the `.ldr`, and the verified parts list and shopping XML (or why they could not be verified). Holo shares it with `share_files`; the browser downloads it and shows it.
- `look` is a custom tool: the browser renders the shared revision on your GPU and returns the image. Keep the tab open while Holo builds; it waits for the render.

## Run

```bash
scripts/fetch-ldraw.sh                        # LDraw parts library into ./ldraw (145 MB)
python3 scripts/fetch-connectors.py           # pinned LDCad stud/socket data for assembly plans
cd server && uv sync && cd ..
REBRICKABLE_API_KEY=... server/.venv/bin/brickyard-catalog   # data/rebrickable.json.gz, valid 30 days
server/.venv/bin/brickyard-prices                             # web/public/pick-a-brick.json (--locale en-US for another store)
server/.venv/bin/python scripts/pack-toolkit.py               # web/public/brickyard.tgz and LDConfig.ldr
cd web && npm install
vercel link --yes --scope h-company --project brickyard && vercel env pull .env.local   # the server's secrets
npm run dev                                                                            # http://127.0.0.1:5173
```

HoloBricks is open to H Company: everything sits behind a sign-in with an `@hcompany.ai` Google account on the H portal. Export the showcases for local use with
`BRICKYARD_DATA=<data dir> server/.venv/bin/brickyard-gallery web/public hogwarts 6eb28d127e london paris`.

Try the toolkit by hand: in a folder with a `build.py`, run `<repo>/server/.venv/bin/bricks run` (`--help` lists the tools).

## Accounts and the public library

```
browser ──same tab──▶ portal ──Google──▶ portal sets its access token cookie
portal ──redirect──▶ GET /api/session: who is it? mint a 30-day "HoloBricks <email> <time>" key ──▶ back where the user was
browser ──key──▶ Agents API (Holo builds, sessions listed per user)
browser ──POST /api/builds (pass + key)──▶ snapshot of the session ──▶ Vercel Blob (public)
signed in ──GET /api/builds (pass + key)──▶ the public library
```

- `web/api/` holds the Vercel functions; `web/scripts/build-api.mjs` bundles them, and `npm run dev` serves them too. Deployed, `/?public=<id>` and `/?showcase=<id>` go to `/api/preview`: the app's page, with that build's name, piece count, author and cover in its link preview.
- The portal's cookie never reaches a local dev server, so there the portal sends a one-time code instead (PKCE, RFC 8252); it only redirects to `127.0.0.1`, where `localhost` forwards.
- Every library read needs a pass: signed out, only link previews show a build's name and cover. A session is its owner's to publish, stop and change; a teammate who opens its link sees it read only, to remix.
- Signing in again revokes the previous key. The key lives in the browser's local storage; the pass, signed with `BRICKYARD_SECRET`, names its holder to the functions.
- An imported build has no session, so it lives only in the library: **Make private** moves its entry to `private/<owner>/`, out of the public listing, listed (`GET /api/builds?mine=1`) and opened only for its owner. **Delete** removes its entry and files. Sessions cannot be deleted through the Agents API: deleting one (`DELETE /api/projects?id=&source=session`) unpublishes it and records it under `removed/<scope>/`, which `GET /api/projects` lists so the library leaves it out; the platform keeps its chat until the session ends. Deleting a fork removes its files and name, and removes the session it started. Deleting a build while Holo builds it cancels its session first, so Holo stops. Owners rename, publish, make private and delete their builds from the ⋯ on their cards, or from Share in the build.
- Publishing copies the session's model, transcript and images, so a public build stands on its own, even if its session is deleted. Only its author can rename, publish, make private, unpublish or delete a build. The emails in `BRICKYARD_ADMINS` can take anyone's build out of the public library to moderate it, but never delete it: it becomes private, kept for its owner.
- Server environment: `BRICKYARD_SECRET`, `BRICKYARD_ADMINS`, and `BLOB_READ_WRITE_TOKEN` from the `brickyard-library` Blob store.

## Where to change things

| To change | Edit |
| --- | --- |
| model, step and time budget, idle timeout, the `look` tool | `web/src/agent.ts` |
| how Holo builds: workflow, the build script API, parts, colors | `agent/holo.md` |
| the build script functions | `server/brickyard/script.py` (document them in `agent/holo.md`) |
| the Workstation setup | `setup.sh`, then `scripts/pack-toolkit.py` |
| the icon | `scripts/brick-icon.py`, rendered with `blender -b -P scripts/brick-icon.py -- /tmp/brick.png`, then resized (`sips -Z`) and compressed (`pngquant`) into `docs/brick.png` (128 px), `web/public/brick.png` (64 px) and `web/public/brick-touch.png` (180 px, on white) |

## Showcases and deploy

Paris, London and Hogwarts are scripted in `server/brickyard/showcase` and pass the same checks as Holo's bricks. Bag End (`6eb28d127e`) is a Holo build: its script, `agent/showcase/bag-end.py`, is printed in full in Holo's prompt as the worked example.

```bash
server/.venv/bin/python -m brickyard.showcase paris   # or london, hogwarts: regenerates data/builds/paris.json
scripts/deploy.sh --preview                           # or --prod
```

Every push to master that passes CI deploys to production (the `deploy` job in `.github/workflows/ci.yml`, secrets `VERCEL_TOKEN` and `REBRICKABLE_API_KEY`); run CI by hand on master from the Actions tab, or deploy from a laptop as above.

`deploy.sh` exports the showcases into `web/public/gallery`, rebuilds the catalog snapshot once it is 20 days old (that needs `REBRICKABLE_API_KEY`), packs the toolkit, builds the app and its functions, and deploys them to the Vercel project `brickyard`. It keeps both on the GitHub release `deploy-data`: a laptop deploy uploads them, and CI, which has no showcase data, downloads them. `bricks run` and shopping packages refuse a snapshot after 30 days, so each deploy stays valid for at least 10: redeploy within that.

## Tests

```bash
cd server && uv run pytest -q && uv run ruff check . && cd ..
cd web && npm ci && npx playwright install chromium && npm test && npm run build
```

The server tests run the toolkit offline, with explicit catalog facts. The browser tests mock the Agents API and render real geometry: a build that shares models and asks for renders, the home page's builds, shopping and the GIF export.

## Assembly plans

`python3 scripts/fetch-connectors.py` installs the pinned LDCad shadow library (CC BY-SA 4.0;
Roland Melkert and contributors). `BRICKYARD_SHADOW` can select another installed library. LDraw
geometry alone is not connector evidence. The independent assembly checker resolves supported
round studs and round/square sockets, rejects disconnected models, and checks straight insertion
corridors against conservative envelopes from the full part meshes. It never uses the viewer's
clipped footprint as a collision proof. Scaled/mirrored placements, nonorthogonal rotations and
unsupported joint dependencies are unverified, not silently accepted.

`bricks assembly` reports assembly findings (`bricks run` leaves them out to stay fast) and searches an order by accessible
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
cause conservative false rejections. Unsupported connections must gain a validated rule before the
checker accepts them; they cannot be waived by a visual review. Keep models supported during assembly.

## Recovery checkpoints

New toolkit runs include a versioned recovery checkpoint in the authenticated `model.json.gz`
attachment: the shared geometry and the last script that produced it. A failed script edit preserves
that source. Sharing the model stores the checkpoint with the Agents API; unshared edits and other
Workstation files are not covered. No private reasoning is included. Publishing and gallery exports
omit the recovery source.

After installing the toolkit in a fresh Workstation, `bricks restore files/recovery-model.json.gz`
restores the model and `build.py` without executing it. It rejects mismatched revisions and an existing
workspace. Restore is not assembly verification. Models from older toolkits may lack a checkpoint.

Ended sessions offer **Continue from saved version** when they have a checkpoint, or **Try again with
same request** otherwise. Recovery downloads every original reference before creating a new session,
submits its inputs with creation, and preserves the original session. It copies user requests, not
private reasoning. The new session's `groupId` points to the source, so an accepted attempt can be
found after a lost response. Recovery is user-triggered and creation is not automatically retried.
The current toolkit is used; temporary files, arbitrary dependencies and unshared edits are not
restored. A legacy retry starts over and may produce a different model. If a remix or recovery failed
before its first share, its original starting-model attachment is carried into the retry; a missing
starting model blocks creation rather than silently dropping that input.

## Keeping the browser available

HoloBricks keeps answering `look` for running sessions on any page of the app, warns before leaving,
keeps the screen awake while the tab shows, and asks before signing out. Keep the tab open: a
suspended or closed browser cannot render.
The browser's leave warning is best-effort and cannot prevent a crash or suspension. This is not a
background rendering service and does not automatically pause the session clock.

Interrupted builds show a plain-language message with technical details collapsed under the recovery
action. Activity labels follow the session's working/render-request state rather than rotating claims
about construction progress.

### Build animations

Before the first pieces appear, the viewer follows Holo's observed reading, setup, reference and naming phases: a subject sketch, part silhouettes in LDraw colors, photos actually attached or opened/shared, and the assigned name. Part search results replace the initial examples. Later work stays in the chat, leaving the model available to orbit and walk through.

Shared revisions reveal changed pieces individually, by assembly step and then bottom-up LDraw layer, with a short settling drop. Unchanged pieces stay placed. Forward timeline playback uses the same reveal; scrubbing backward, editing, walking and reduced-motion preferences show settled pieces immediately. Placement has pause, resume, skip and timeline speed controls. Quiet part-specific sounds are on by default after a browser gesture; the mute choice persists.

Holo's inspection views, library thumbnails, PNGs, GIFs and instruction PDFs render completed geometry. Placement never changes model data or the user's camera for an inspection.

For an account-free animation preview:

```sh
cd web
npm ci
npm run dev
```

Open `/dev/thinking.html` on the local server. It uses the actual viewer and waiting components with illustrative packed geometry, a small standalone palette and credited sample photos. Switch phases, change the subject, replay placement and try the speed/mute controls. This entry and its sample assets are excluded from the production build; a real Holo run still needs the toolkit and sign-in described above.

### Model history and forks

**History** lists saved models as V1, V2, and so on. Assembly steps remain inside each model; they
are not versions. Repeated shares of the same piece revision and assembly steps keep their number.
History is read from immutable authenticated session attachments, on demand, with no new datastore.
A missing or invalid attachment blocks numbering until it can be retrieved again.

Only **Latest** takes edits. Earlier versions are read-only previews, including after reopening their
`?build=…&version=N` URL. **Fork** immediately saves and opens a separate private copy of that snapshot.
It is already in the Library and survives reloads before any message is sent. The ordinary chat's
**Send** starts Holo on that copy. Its starting model is V1, and subsequent changes become V2,
V3, etc. The original history remains intact. Each model has one Library card; versions do not add cards.
The fork keeps a link to its source version. A fork copies the model, not the old conversation; references
for the new request use the existing attachment button. There is no extra fork form or chat mode.

Copies use the existing Blob store and app authentication, with owner-scoped, unguessable paths that
are never returned to the browser. No new service or secret is required. The existing app signing
secret also derives the storage scope and must remain stable to retain access to saved copies.
The copy keeps one `?fork=…` URL and Library card after its Holo session starts. The seed and source
reference also travel as a session attachment, so the initial model survives failed setup.
Copy retries reuse the same identity. An ambiguous Holo start is not automatically retried; another
Send checks the same operation for acceptance. Preview never
changes the model used to answer Holo's render requests. A downloaded preview remains viewable if
live polling loses its connection. Published copies expose the fork name, not private history or
ancestry. Public and showcase snapshots can be forked but do not expose their author's session history.
Browser-only hand edits keep their existing draft behaviour; they enter a new fork when explicitly copied.
