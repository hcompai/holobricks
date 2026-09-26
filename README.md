# Brickyard

Watch an agent build Lego models from real LDraw parts, step by step, in the browser.

![Garden Cottage](docs/iso.jpg)

Holo's lighthouse (138 pieces, 23 steps, 8 min), as Holo itself sees it through `look`:

![Holo lighthouse](docs/holo-lighthouse.png)

```
web (Vite + React + three.js)                         server (FastAPI)
┌ header: name · pieces · steps · Download ┐         ┌ Build = pieces (LDraw transforms) + steps + chat
│ Chat | Library  │ Model | Parts          │◀─ SSE ──┤ Builder protocol ◀── demo builder (scripted)
│                 │ three.js LDrawLoader   │         │ LDraw library: sizes measured from geometry
│                 │ timeline ▶ 1× 2× 4×    │─ fetch ▶│ /api/parts/<part>?color → one packed MPD
└─────────────────┴────────────────────────┘         └ /api/builds/<id>/download.ldr with STEP lines
```

## Run

```bash
scripts/fetch-ldraw.sh                              # 145 MB official parts library into ./ldraw
cd server && uv sync && cd ..
cd web && npm install && npm run build && cd ..
server/.venv/bin/brickyard                          # http://127.0.0.1:8000
```

Frontend hot reload: `cd web && npm run dev` (http://127.0.0.1:5173, proxies `/api` to the server).

## Builders

A builder turns a chat request into steps through a `Session`:

```python
class MyBuilder:
    name = "mine"

    async def run(self, session: Session, request: str) -> None:
        await session.say("Laying the base.")
        await session.step("Base", [place("3811.dat", 0, 0, 0, color=2)])
```

`place(part, x, y, z, color, rotation)` puts any LDraw part on stud `(x, y)` at plate height `z`; footprints and
heights come from the part geometry, so all ~25k parts work without a catalog. Register builders in
`server/brickyard/builders/__init__.py`.

| Builder | What it does |
| --- | --- |
| `holo` | Holo (`holo4-27b`) in a tool loop: `add_bricks`, `remove_bricks`, `look`, `find_parts`, `list_pieces`, `set_name`. Bricks are validated (bounds, overlaps, floating); `look` returns a 4-view render from the open viewer. Reasoning streams live into the chat. |
| `demo` | Scripted cottage, no model needed. |

Holo needs a key: `HOLO_API_KEY=... server/.venv/bin/brickyard` (`HAI_API_KEY` also works). Optional: `HOLO_MODEL`,
`HOLO_BASE_URL`.

## Tests

```bash
cd server && uv run pytest -q && uv run ruff check .
cd web && npm run typecheck
```
