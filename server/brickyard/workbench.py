"""The stateful model an agent edits: a build script rebuilt into validated steps, part search, and renders."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from brickyard import assembly, catalog, ldraw
from brickyard.model import (
    FACINGS,
    ROTATIONS,
    Box,
    Camera,
    Piece,
    Placement,
    bounds,
    footprint,
    grid,
    place,
    with_accessories,
)
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

        Mounted placements hang on a wall, so they only have to stay at x, y >= 0 and clear of other pieces.
        """
        indexed = self._index()
        batch: dict[tuple[int, int], list[tuple[tuple, str]]] = {}

        def near(box: tuple) -> list[tuple[tuple, int | str]]:
            ids = sorted({pid for cell in _cells(box) for pid in self._cells.get(cell, ())})
            own = {id(entry): entry for cell in _cells(box) for entry in batch.get(cell, [])}
            return [(indexed[pid][1], pid) for pid in ids] + list(own.values())

        def name(what: int | str) -> str:
            return what if isinstance(what, str) else f"#{what} {_where(indexed[what][0])}"

        accepted: list[tuple[Placement, tuple, str, bool]] = []
        rejected, warnings = [], []
        candidates: list[tuple[str, Placement, bool]] = []
        for n, brick in enumerate(bricks, 1):
            label = f"{brick.label or f'brick {n}'} ({brick.part} at x={brick.x} y={brick.y} z={brick.z})"
            part = ldraw.resolve(brick.part)
            if part is None:
                rejected.append(f"{label}: unknown part; use bricks parts")
            elif brick.color not in ldraw.colors():
                rejected.append(f"{label}: unknown color {brick.color}")
            elif brick.rotation not in ROTATIONS:
                rejected.append(f"{label}: rotation must be 0, 90, 180 or 270")
            elif brick.z < 0:
                rejected.append(f"{label}: below the ground")
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
            if box[0][0] < -EPS or box[0][2] < -EPS:
                rejected.append(f"{label}: x and y start at 0")
                continue
            neighbors = near(box)
            hit = next(((other, what) for other, what in neighbors if _collides(box, other)), None)
            if hit:
                rejected.append(f"{label}: overlaps {name(hit[1])}, which fills up to z={_top(hit[0])}")
                continue
            accepted.append((placement, box, label, needs_support))
            for cell in _cells(box):
                batch.setdefault(cell, []).append((box, f"{label} of this step"))

        # A step is a batch: later lines may support earlier ones. Seed contact paths at the ground or
        # earlier steps, so two touching bricks floating together cannot validate each other.
        supported, pending = set(), []
        for _, box, _, needs_support in accepted:
            if not needs_support or any(isinstance(who, int) and _touches(box, other) for other, who in near(box)):
                supported.add(id(box))
                pending.append(box)
        while pending:
            box = pending.pop()
            for other, who in near(box):
                if isinstance(who, str) and id(other) not in supported and _touches(box, other):
                    supported.add(id(other))
                    pending.append(other)
        warnings = [
            f"{label}: floating, no vertical contact path to the ground or an earlier step (bounding-box check)"
            for _, box, label, _ in accepted
            if id(box) not in supported
        ]
        return [p for placement, _, _, _ in accepted for p in with_accessories(placement)], rejected, warnings

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
            try:
                step = await self.session.step(title, placements, "" if key and problems else key)
            except catalog.ValidationError as exc:
                return self.catalog_rejection(exc.report)
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
        fixed = self._fixed()
        out = await _execute(code, await asyncio.to_thread(self._taken, fixed))
        printed = f"\nThe script printed:\n{out['printed']}" if out.get("printed") else ""
        if "error" in out:
            await self.session.save_script(code)
            return Result(f"The script stopped, so the model did not change.\n{out['error']}{printed}", problems=1)
        steps = out["steps"]
        keys = [_digest(s) for s in steps]
        old = [s.key for s in build.steps[fixed:]]
        same = 0
        while same < min(len(old), len(keys)) and old[same] == keys[same]:
            same += 1
        kept_steps = fixed + same
        candidate = build.model_copy(
            update={
                "script": code,
                "steps": build.steps[:kept_steps],
                "pieces": [p for p in build.pieces if p.step < kept_steps],
            }
        )
        candidate.width, candidate.depth = footprint(candidate.pieces)
        draft = Workbench(Session(candidate, self.session.store))
        source = code.splitlines()
        reports, floating = [], []
        for n, (s, key) in enumerate(zip(steps[same:], keys[same:], strict=True), kept_steps + 1):
            bricks = [b | {"label": _line(source, b["line"])} for b in s["bricks"]]
            try:
                parsed = [Brick.model_validate(b) for b in bricks]
            except ValidationError as e:
                reports.append(f"Step {n} '{s['title']}': invalid bricks: {e.errors(include_url=False)}")
                continue
            placements, rejected, warnings = await asyncio.to_thread(draft._check, parsed)
            if placements:
                candidate.add_step(s["title"], placements, "" if rejected else key)
            if rejected:
                reports.append(f"Step {n} '{s['title']}':\n" + _first(rejected))
            if warnings:
                floating.append(f"Step {n} '{s['title']}':\n" + _first(warnings))
        await self.session.commit_script(candidate, kept_steps)
        parts = await self.session.check_parts() if self.pieces else None
        problems = len(reports) + (len(parts["issues"]) if parts else 0)
        kept = (
            ""
            if not same
            else f"kept step {fixed + 1} unchanged, "
            if same == 1
            else f"kept steps {fixed + 1} to {fixed + same} unchanged, "
        )
        rebuilt = len(steps) - same
        lines = [f"Ran the script: {kept}rebuilt and checked {rebuilt} step{'' if rebuilt == 1 else 's'}."]
        if reports:
            lines += ["Problems, by script line; these bricks were not placed:", *reports]
        if parts and not parts["valid"]:
            lines.append(_catalog_issues(parts))
        if not problems:
            lines.append("No problems: every brick is known, fits, and exists in its color on BrickLink.")
        if floating:
            lines += ["Floating, fine only if the subject flies or hangs there:", *floating]
        lines.append("Steps: pieces, then where they sit in studs (x, y) and plates (z, bottom to top):")
        lines.append(await asyncio.to_thread(self.describe))
        pieces = sum(p.part != BASEPLATE for p in self.pieces)
        seen = await self.look(f"Ran the script: {pieces} pieces" + (f", {problems} problems" if problems else ""))
        physical = await self.assembly_plan()
        return Result(
            "\n".join(lines) + printed + "\n" + seen.text + "\n" + physical.text,
            note=seen.note,
            images=seen.images,
            kind=seen.kind,
            caption=seen.caption,
            problems=problems + physical.problems,
        )

    async def assembly_plan(self, plan: dict | None = None) -> Result:
        """Plan/check the current frozen revision without editing its geometry."""
        build = self.session.build.model_copy(deep=True)
        folder = self.session.store.root.parent / "workspaces" / build.id / ".brickyard-assembly"
        try:
            proposed = assembly.Plan.model_validate(plan) if plan is not None else assembly.cached_plan(folder, build)
        except ValueError as exc:
            return Result(f"Invalid assembly plan: {exc}", problems=1)
        report = await asyncio.to_thread(assembly.check, build, proposed)
        if self.session.build.revision != build.revision:
            return Result("The model changed during assembly checking. Retry for the current revision.", problems=1)
        await asyncio.to_thread(assembly.save_report, folder, report)
        return Result(
            assembly.describe(report) + f"\nEvidence and accepted plan: {folder}",
            problems=0 if report.status == "verified" else 1,
        )

    @staticmethod
    def catalog_rejection(report: dict) -> Result:
        return Result(
            "Candidate rejected; the model did not change.\n" + _catalog_issues(report),
            problems=len(report["issues"]),
        )

    def _fixed(self) -> int:
        """How many steps were built before the script; it builds on them and never changes them."""
        return next((s.index for s in self.session.build.steps if s.key is not None), len(self.session.build.steps))

    def _taken(self, steps: int) -> list[list[int]]:
        """(x, y, w, d, z, height) on the grid of every piece in the first `steps` steps, except a baseplate."""
        s, out = ldraw.STUD, []
        for p, (lo, hi) in self._index().values():
            if p.step < steps and p.part != BASEPLATE:
                x, y, z = round(lo[0] / s), round(lo[2] / s), round(-hi[1] / ldraw.PLATE)
                w, d = round(hi[0] / s) - x, round(hi[2] / s) - y
                out.append([x, y, max(1, w), max(1, d), z, max(1, _top((lo, hi)) - z)])
        return out

    async def look(
        self, note: str = "Looked at the model", camera: dict | None = None, box: list[int] | None = None
    ) -> Result:
        try:
            view = None if camera is None else Camera.model_validate(camera)
            inside = None if box is None else Box.of(box)
        except (ValidationError, ValueError, TypeError) as e:
            return Result(f"Could not set the view: {e}", problems=1)
        if inside and not any(inside.holds(p) for p in self.pieces):
            return Result(f"No pieces in the box {inside}.", problems=1)
        png = await self.session.render(view, inside)
        summary = await asyncio.to_thread(self.summary)
        if png is None:
            return Result(
                f"No verified render was received (viewer unavailable, asset failure, or timeout).\n{summary}",
                note=f"{note} (render unavailable)",
                problems=1,
            )
        palette = await asyncio.to_thread(ldraw.colors)
        colors = Counter(p.color for p in self.pieces if inside is None or inside.holds(p))
        summary += " Colors: " + ", ".join(
            f"{color} {palette.get(color, ('Unknown', ''))[0].lower()} {count}" for color, count in colors.most_common()
        )
        await self.session.say(note, role="tool", images=[self.session.store.save_image(png, "image/png")])
        caption = "The render: 3/4 front-right, 3/4 back-left, front, and top (back at the top)."
        if view:
            center = f", centered on x {view.at[0]:g}, y {view.at[1]:g}, z {view.at[2]:g}" if view.at else ""
            caption = f"The view from {view.angle:g} degrees, {view.elevation:g} up, zoom {view.zoom:g}{center}."
        if inside:
            n = sum(inside.holds(p) for p in self.pieces)
            caption = f"Only the {n} pieces in the box {inside}. {caption}"
        return Result(summary, images=[Picture(png, "image/png")], kind="render", caption=caption)

    async def find_parts(self, query: str) -> Result:
        hits = await asyncio.to_thread(lambda: [part_line(p) for p in ldraw.search(query)])
        text = "\n".join(hits) if hits else f"No parts match '{query}'. Try fewer or simpler words."
        return Result(text, note=f"Searched parts for '{query}'")

    async def catalog_colors(self, part: str) -> Result:
        resolved = ldraw.resolve(part)
        if not resolved or resolved not in ldraw.catalog():
            return Result("Unknown complete part; use bricks parts.", problems=1)
        try:
            record = await asyncio.to_thread(
                catalog.Catalog(self.session.store.root.parent / "bricklink-catalog").resolve, resolved
            )
        except ValueError as exc:
            return Result(str(exc), problems=1)
        choices = catalog.available_colors(record)
        return Result(
            f"{resolved} → BrickLink {record.item}. Verified colors (use these LDraw codes in the script):\n"
            + ", ".join(f"{c['color']} {c['name']}" for c in choices),
            problems=0 if choices else 1,
        )

    async def check_catalog(self) -> Result:
        report = await asyncio.to_thread(
            catalog.validate, self.pieces, self.session.store.root.parent / "bricklink-catalog"
        )
        return Result(catalog.describe(report), problems=len(report["issues"]))

    async def rename(self, name: str) -> Result:
        await self.session.rename(name.strip()[:60] or "Untitled build")
        return Result(f"Build is now called '{self.session.build.name}'.")

    def summary(self) -> str:
        pieces = [p for p in self.pieces if p.part != BASEPLATE]
        if not pieces:
            return "Nothing is built yet."
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


def _catalog_issues(report: dict) -> str:
    retry = any(issue["code"] == "catalog_unavailable" for issue in report["issues"])
    return catalog.describe(report) + (
        "\nRetry the catalog check; do not change the design to bypass an unavailable source."
        if retry
        else "\nChoose verified part/color combinations matching the reference, edit the script and run again."
    )


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
