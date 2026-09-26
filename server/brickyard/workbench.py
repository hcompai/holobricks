"""The stateful model an agent edits: a build script rebuilt into validated steps, part search, and renders."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import sys
import tempfile
from dataclasses import dataclass, field

import httpx
from pydantic import BaseModel, ValidationError

from brickyard import ldraw, reference
from brickyard.model import FACINGS, ROTATIONS, Piece, Placement, bounds, grid, place, with_accessories
from brickyard.session import Session

STUD_HEIGHT = 4
EPS = 0.5
CELL = 4 * ldraw.STUD
PROBLEM_LIMIT = 12
SCRIPT_TIMEOUT_S = 60
BASEPLATE = "3811.dat"


class Brick(BaseModel):
    part: str
    x: int
    y: int
    z: int
    color: int
    rotation: int = 0
    label: str | None = None
    """How problems name the brick, like the script line that made it."""


@dataclass
class Picture:
    data: bytes
    mime: str
    title: str = ""
    url: str = ""
    """Where the image came from, for images found on the web."""


@dataclass
class Result:
    text: str
    note: str | None = None
    images: list[Picture] = field(default_factory=list)
    """Images the agent should see."""
    kind: str | None = None
    """What the images are, like `render`; an agent keeps only the latest images of each kind in context."""
    caption: str = ""
    problems: int = 0


def _overlap(a: tuple, b: tuple) -> tuple[float, float, float]:
    return tuple(min(a[1][k], b[1][k]) - max(a[0][k], b[0][k]) for k in range(3))  # type: ignore[return-value]


def _collides(a: tuple, b: tuple) -> bool:
    dx, dy, dz = _overlap(a, b)
    return dx > EPS and dz > EPS and dy > STUD_HEIGHT + EPS


def _touches(a: tuple, b: tuple) -> bool:
    """Stacked with no gap: one's bottom meets the other's top surface or stud tops."""
    dx, _, dz = _overlap(a, b)
    if dx <= EPS or dz <= EPS:
        return False
    return any(abs(lower[0][1] + s - upper[1][1]) < 1 for upper, lower in ((a, b), (b, a)) for s in (0, STUD_HEIGHT))


def _cells(box: tuple) -> list[tuple[int, int]]:
    xs = range(int(box[0][0] // CELL), int(box[1][0] // CELL) + 1)
    return [(cx, cz) for cx in xs for cz in range(int(box[0][2] // CELL), int(box[1][2] // CELL) + 1)]


def _top(box: tuple) -> int:
    """Plate height of a box's top surface; studs, when there are any, add less than a plate."""
    return math.floor((-box[0][1] + EPS) / ldraw.PLATE)


def _where(p: Placement | Piece) -> str:
    x, y, z, rotation = grid(p)
    facing = next((f for f, m in FACINGS.items() if m == tuple(p.rot)), None)
    turn = f" facing={facing}" if facing else f" rot={rotation}" if rotation else ""
    return f"{p.part.removesuffix('.dat')} at x={x} y={y} z={z}{turn}"


def _first(lines: list[str]) -> str:
    extra = len(lines) - PROBLEM_LIMIT
    return "\n".join(lines[:PROBLEM_LIMIT] + ([f"... and {extra} more like these."] if extra > 0 else []))


def part_line(part: str) -> str:
    info = ldraw.info(part)
    w, d = info.footprint
    height = f"{info.plates} plate" + ("s" if info.plates != 1 else "")
    return f"{part.removesuffix('.dat')}: {info.title} | W={w} along x, D={d} along y | {height} tall"


class Workbench:
    def __init__(self, session: Session):
        self.session = session
        self._indexed: dict[int, tuple[Piece, tuple]] = {}
        self._cells: dict[tuple[int, int], set[int]] = {}

    @property
    def pieces(self) -> list[Piece]:
        return self.session.build.pieces

    def _index(self) -> dict[int, tuple[Piece, tuple]]:
        """Each piece id with its piece and box, keeping the cell index in step with the build."""
        current = {p.id: p for p in self.pieces}
        for pid, (p, box) in list(self._indexed.items()):
            if current.get(pid) is not p:
                del self._indexed[pid]
                for cell in _cells(box):
                    self._cells[cell].discard(pid)
        for pid, p in current.items():
            if pid not in self._indexed:
                box = bounds(p)
                self._indexed[pid] = (p, box)
                for cell in _cells(box):
                    self._cells.setdefault(cell, set()).add(pid)
        return self._indexed

    def _check(
        self, bricks: list[Brick], mounted: list[Placement] = ()
    ) -> tuple[list[Placement], list[str], list[str]]:
        """Placements that fit, plus rejection and warning lines, for a batch checked against itself and the build.

        Mounted placements hang on a wall, so they only have to stay in bounds and clear of other pieces.
        """
        width, depth = self.session.build.width * ldraw.STUD, self.session.build.depth * ldraw.STUD
        indexed = self._index()
        batch: dict[tuple[int, int], list[tuple[tuple, str]]] = {}

        def near(box: tuple) -> list[tuple[tuple, int | str]]:
            ids = sorted({pid for cell in _cells(box) for pid in self._cells.get(cell, ())})
            own = {id(entry): entry for cell in _cells(box) for entry in batch.get(cell, [])}
            return [(indexed[pid][1], pid) for pid in ids] + list(own.values())

        def name(what: int | str) -> str:
            return what if isinstance(what, str) else f"#{what} {_where(indexed[what][0])}"

        accepted: list[tuple[Placement, tuple]] = []
        rejected, warnings = [], []
        candidates: list[tuple[str, Placement, bool]] = []
        for n, brick in enumerate(bricks, 1):
            label = f"{brick.label or f'brick {n}'} ({brick.part} at x={brick.x} y={brick.y} z={brick.z})"
            part = ldraw.resolve(brick.part)
            if part is None:
                rejected.append(f"{label}: unknown part; use find_parts")
            elif brick.color not in ldraw.colors():
                rejected.append(f"{label}: unknown color {brick.color}")
            elif brick.rotation not in ROTATIONS:
                rejected.append(f"{label}: rotation must be 0, 90, 180 or 270")
            elif brick.z < 0:
                rejected.append(f"{label}: below the baseplate")
            else:
                placement = place(part, brick.x, brick.y, brick.z, brick.color, brick.rotation)
                candidates.append((label, placement, brick.z > 0))
        for p in mounted:
            label = f"mounted {p.part.removesuffix('.dat')}"
            if ldraw.resolve(p.part) is None:
                rejected.append(f"{label}: unknown part")
            else:
                candidates.append((label, p, False))
        for label, placement, needs_support in candidates:
            box = bounds(placement)
            if box[0][0] < -EPS or box[0][2] < -EPS or box[1][0] > width + EPS or box[1][2] > depth + EPS:
                rejected.append(f"{label}: outside the {self.session.build.width}x{self.session.build.depth} baseplate")
                continue
            neighbors = near(box)
            hit = next(((other, what) for other, what in neighbors if _collides(box, other)), None)
            if hit:
                rejected.append(f"{label}: overlaps {name(hit[1])}, which fills up to z={_top(hit[0])}")
                continue
            if needs_support and not any(_touches(box, other) for other, _ in neighbors):
                warnings.append(f"{label}: floating, nothing directly under or above it")
            accepted.append((placement, box))
            for cell in _cells(box):
                batch.setdefault(cell, []).append((box, f"{label} of this step"))
        return [p for placement, _ in accepted for p in with_accessories(placement)], rejected, warnings

    async def add(
        self, title: str, bricks: list[dict], mounted: list[Placement] = (), key: str | None = None
    ) -> Result:
        """Check the bricks and place the ones that fit as one step; a keyed step with problems keeps an empty key."""
        try:
            parsed = [Brick.model_validate(b) for b in bricks]
        except ValidationError as e:
            return Result(f"Invalid bricks in '{title}': {e.errors(include_url=False)}", problems=len(bricks))
        if not parsed and not mounted:
            return Result("No bricks given.")
        placements, rejected, warnings = await asyncio.to_thread(self._check, parsed, list(mounted))
        problems = len(rejected) + len(warnings)
        lines = []
        if placements:
            step = await self.session.step(title, placements, "" if key and problems else key)
            new = [p for p in self.pieces if p.step == step.index]
            lines.append(f"Step {step.index + 1} '{title}': placed {len(new)} pieces as #{new[0].id}-#{new[-1].id}.")
        if rejected:
            lines.append(f"Rejected {len(rejected)}, not placed:\n" + _first(rejected))
        if warnings:
            lines.append("Placed but check:\n" + _first(warnings))
        note = f"Added {len(placements)} pieces: {title}" if placements else f"Rejected every brick of '{title}'"
        return Result("\n".join(lines), note=note, problems=problems)

    async def run_script(self, code: str) -> Result:
        """Rebuild the model from `code`: steps up to the first changed one stay, the rest are rebuilt and checked."""
        build = self.session.build
        build.script = code
        fixed = self._fixed()
        out = await _execute(code, await asyncio.to_thread(self._taken, fixed))
        printed = f"\nThe script printed:\n{out['printed']}" if out.get("printed") else ""
        if "error" in out:
            self.session.store.save(build)
            return Result(f"The script stopped, so the model did not change.\n{out['error']}{printed}", problems=1)
        steps = out["steps"]
        keys = [_digest(s) for s in steps]
        old = [s.key for s in build.steps[fixed:]]
        same = 0
        while same < min(len(old), len(keys)) and old[same] == keys[same]:
            same += 1
        await self.session.rewind(fixed + same)
        source = code.splitlines()
        problems, reports = 0, []
        for s, key in zip(steps[same:], keys[same:], strict=True):
            bricks = [b | {"label": _line(source, b["line"])} for b in s["bricks"]]
            result = await self.add(s["title"], bricks, key=key)
            if result.problems:
                problems += result.problems
                reports.append(result.text)
        problems += len(out["notes"])
        reports += out["notes"]
        kept = (
            ""
            if not same
            else f"kept step {fixed + 1}, "
            if same == 1
            else f"kept steps {fixed + 1} to {fixed + same}, "
        )
        lines = [f"Ran the script: {kept}rebuilt {len(steps) - same} steps."]
        lines += ["Problems, by script line:", *reports] if reports else ["No problems: every brick fits and rests."]
        lines.append("Steps: pieces, then where they sit in studs (x, y) and plates (z, bottom to top):")
        lines.append(await asyncio.to_thread(self.describe))
        pieces = sum(p.part != BASEPLATE for p in self.pieces)
        seen = await self.look(f"Ran the script: {pieces} pieces" + (f", {problems} problems" if problems else ""))
        return Result(
            "\n".join(lines) + printed + "\n" + seen.text,
            note=seen.note,
            images=seen.images,
            kind=seen.kind,
            caption=seen.caption,
            problems=problems,
        )

    def _fixed(self) -> int:
        """How many steps were built before the script; it builds on them and never changes them."""
        return next((s.index for s in self.session.build.steps if s.key is not None), len(self.session.build.steps))

    def brief(self) -> str:
        """The model as a new request finds it: its steps, and the script behind them."""
        lines = ["Steps:", self.describe()]
        fixed, script = self._fixed(), self.session.build.script
        if fixed > 1:
            lines.append(f"Steps 1-{fixed} were built before the script; it builds on them and cannot change them.")
        lines += ["The build script:", _numbered(script)] if script else ["No build script yet."]
        return "\n".join(lines)

    def _taken(self, steps: int) -> list[list[int]]:
        """(x, y, w, d, z, height) on the grid of every piece in the first `steps` steps, except the baseplate."""
        s, out = ldraw.STUD, []
        for p, (lo, hi) in self._index().values():
            if p.step < steps and p.part != BASEPLATE:
                x, y, z = round(lo[0] / s), round(lo[2] / s), round(-hi[1] / ldraw.PLATE)
                w, d = round(hi[0] / s) - x, round(hi[2] / s) - y
                out.append([x, y, max(1, w), max(1, d), z, max(1, _top((lo, hi)) - z)])
        return out

    async def look(self, note: str = "Looked at the model") -> Result:
        png = await self.session.render()
        summary = await asyncio.to_thread(self.summary)
        if png is None:
            return Result(f"No viewer is open, so no image this time.\n{summary}", note=f"{note} (no viewer open)")
        await self.session.say(note, role="tool")
        caption = "The render: 3/4 front-right, 3/4 back-left, front, and top (back at the top)."
        return Result(summary, images=[Picture(png, "image/png")], kind="render", caption=caption)

    async def find_reference(self, query: str) -> Result:
        try:
            photos = await reference.search(query)
        except (httpx.HTTPError, ValueError) as e:
            return Result(f"Reference search failed ({e}). Build from what you know.")
        if not photos:
            return Result(f"No photos for '{query}'. Try a more common name, or build from what you know.")
        titles = "; ".join(p.title for p in photos)
        await self.session.say(f"Found reference photos for '{query}': {titles}", role="tool")
        return Result(
            f"Found {len(photos)} photos from Wikipedia for '{query}'.",
            images=[Picture(p.data, p.mime, p.title, p.url) for p in photos],
            kind="reference",
            caption=f"Reference photos for '{query}'.",
        )

    async def find_parts(self, query: str) -> Result:
        hits = await asyncio.to_thread(lambda: [part_line(p) for p in ldraw.search(query)])
        text = "\n".join(hits) if hits else f"No parts match '{query}'. Try fewer or simpler words."
        return Result(text, note=f"Searched parts for '{query}'")

    async def rename(self, name: str) -> Result:
        await self.session.rename(name.strip()[:60] or "Untitled build")
        return Result(f"Build is now called '{self.session.build.name}'.")

    def summary(self) -> str:
        pieces = [p for p in self.pieces if p.part != BASEPLATE]
        if not pieces:
            return "The baseplate is empty."
        boxes = [grid(p) for p in pieces]
        indexed = self._index()
        top = max(_top(indexed[p.id][1]) for p in pieces)
        xs, ys = [b[0] for b in boxes], [b[1] for b in boxes]
        return (
            f"{len(pieces)} pieces in {len(self.session.build.steps)} steps, spanning x {min(xs)}-{max(xs)}, "
            f"y {min(ys)}-{max(ys)}, up to plate height {top}."
        )

    def describe(self) -> str:
        """One line per step: its pieces and the studs and plate heights they span."""
        indexed = self._index()
        boxes: dict[int, list[tuple]] = {}
        for p in self.pieces:
            boxes.setdefault(p.step, []).append(indexed[p.id][1])
        s, lines = ldraw.STUD, []
        for step in self.session.build.steps:
            if step.index not in boxes:
                continue
            los, his = [b[0] for b in boxes[step.index]], [b[1] for b in boxes[step.index]]
            x = f"{round(min(v[0] for v in los) / s)}-{round(max(v[0] for v in his) / s) - 1}"
            y = f"{round(min(v[2] for v in los) / s)}-{round(max(v[2] for v in his) / s) - 1}"
            z = f"{max(0, round(min(-v[1] for v in his) / ldraw.PLATE))}-{max(map(_top, boxes[step.index]))}"
            n = len(boxes[step.index])
            lines.append(f"{step.index + 1} {step.title}: {n} piece{'s' * (n != 1)}, x {x}, y {y}, z {z}")
        return "\n".join(lines) or "No pieces yet."


def _numbered(script: str) -> str:
    return "\n".join(f"{n:>4}  {line}" for n, line in enumerate(script.splitlines(), 1))


def _line(source: list[str], n: int) -> str | None:
    return f"line {n} `{source[n - 1].strip()[:70]}`" if 0 < n <= len(source) else None


def _digest(step: dict) -> str:
    bricks = [{k: v for k, v in b.items() if k != "line"} for b in step["bricks"]]
    return hashlib.sha256(json.dumps([step["title"], bricks], sort_keys=True).encode()).hexdigest()[:16]


async def _execute(code: str, taken: list[list[int]]) -> dict:
    """Run a build script in a fresh process with an empty environment and a time limit."""
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        "-m",
        "brickyard.script",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={"BRICKYARD_LDRAW": str(ldraw.LDRAW)},
        cwd=tempfile.gettempdir(),
    )
    job = json.dumps({"code": code, "taken": taken}).encode()
    try:
        out, err = await asyncio.wait_for(process.communicate(job), SCRIPT_TIMEOUT_S)
    except TimeoutError:
        return {"error": f"The script ran for over {SCRIPT_TIMEOUT_S} s; look for a loop that never ends."}
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
    if process.returncode:
        return {"error": f"The script runner crashed: {err.decode(errors='replace')[-500:]}"}
    return json.loads(out)
