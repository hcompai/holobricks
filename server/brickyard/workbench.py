"""The model an agent edits: a build script rebuilt into validated steps, plus part search and checks."""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from brickyard import assembly, catalog, ldraw
from brickyard.model import (
    FACINGS,
    ROTATIONS,
    Piece,
    Placement,
    bounds,
    footprint,
    grid,
    mount,
    place,
    with_accessories,
)
from brickyard.workspace import MODEL, Workspace

STUD_HEIGHT = 4
EPS = 0.5
CELL = 4 * ldraw.STUD
PROBLEM_LIMIT = 12
PARTS_SHOWN = 12
SCRIPT_TIMEOUT_S = 60
BASEPLATE = "3811.dat"


class Brick(BaseModel):
    part: str
    x: int
    y: int
    z: int
    color: int
    rotation: int = 0
    facing: str | None = None
    """Set for a part mounted on a wall, its top turned to face that side."""
    label: str | None = None
    """How problems name the brick, like the script line that made it."""


@dataclass
class Result:
    text: str
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


def _by_step(groups: list[tuple[int, str, list[str]]]) -> list[str]:
    """The first PROBLEM_LIMIT lines of the whole run under their steps, then how many more and where."""
    lines, shown, rest = [], 0, {}
    for n, title, found in groups:
        taken = found[: max(0, PROBLEM_LIMIT - shown)]
        if taken:
            lines += [f"Step {n} '{title}':", *taken]
            shown += len(taken)
        if len(found) > len(taken):
            rest[n] = len(found) - len(taken)
    if rest:
        where = f"step{'s' if len(rest) > 1 else ''} {', '.join(map(str, rest))}"
        lines.append(f"... and {sum(rest.values())} more like these in {where}.")
    return lines


def part_line(part: str) -> str:
    info = ldraw.info(part)
    w, d = info.footprint
    height = f"{info.plates} plate" + ("s" if info.plates != 1 else "")
    return f"{part.removesuffix('.dat')}: {info.title} | W={w} along x, D={d} along y | {height} tall"


class Workbench:
    def __init__(self, workspace: Workspace):
        self.workspace = workspace
        self._indexed: dict[int, tuple[Piece, tuple]] = {}
        self._cells: dict[tuple[int, int], set[int]] = {}

    @property
    def pieces(self) -> list[Piece]:
        return self.workspace.build.pieces

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
            elif brick.facing is not None:
                if brick.facing in FACINGS:
                    candidates.append((label, mount(part, brick.x, brick.y, brick.z, brick.color, brick.facing), False))
                else:
                    rejected.append(f"{label}: facing must be south, north, west or east")
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
                rejected.append(f"{label}: x and y start at 0; to make room, add an offset to the whole plan")
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

    def add(self, title: str, bricks: list[dict], mounted: list[Placement] = ()) -> Result:
        """Check the bricks and place the ones that fit as one step, if the whole model stays verified."""
        try:
            parsed = [Brick.model_validate(b) for b in bricks]
        except ValidationError as e:
            return Result(f"Invalid bricks in '{title}': {e.errors(include_url=False)}", problems=len(bricks))
        if not parsed and not mounted:
            return Result("No bricks given.")
        placements, rejected, warnings = self._check(parsed, list(mounted))
        lines = []
        if placements:
            candidate = self.workspace.build.model_copy(deep=True)
            step = candidate.add_step(title, placements)
            try:
                catalog.require(candidate.pieces)
            except catalog.ValidationError as exc:
                return Result(
                    "Candidate rejected; the model did not change.\n" + _catalog_issues(exc.report),
                    problems=len(exc.report["issues"]),
                )
            self.workspace.commit(candidate)
            new = [p for p in self.pieces if p.step == step.index]
            lines.append(f"Step {step.index + 1} '{title}': placed {len(new)} pieces as #{new[0].id}-#{new[-1].id}.")
        if rejected:
            lines.append(f"Rejected {len(rejected)}, not placed:\n" + _first(rejected))
        if warnings:
            lines.append("Placed but check:\n" + _first(warnings))
        return Result("\n".join(lines), problems=len(rejected) + len(warnings))

    def run_script(self, code: str) -> Result:
        """Rebuild the model from `code`: steps up to the first changed one stay, the rest are rebuilt and checked."""
        build = self.workspace.build
        fixed = self._fixed()
        out = _execute(code, self._taken(fixed))
        printed = f"\nThe script printed:\n{out['printed']}" if out.get("printed") else ""
        if "error" in out:
            self.workspace.save(build.model_copy(update={"script": code}))
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
        draft = Workbench(Workspace(candidate))
        source = code.splitlines()
        reports, floating = [], []
        for n, (s, key) in enumerate(zip(steps[same:], keys[same:], strict=True), kept_steps + 1):
            bricks = [b | {"label": _line(source, b["line"])} for b in s["bricks"]]
            try:
                parsed = [Brick.model_validate(b) for b in bricks]
            except ValidationError as e:
                reports.append((n, s["title"], [f"invalid bricks: {e.errors(include_url=False)}"]))
                continue
            placements, rejected, warnings = draft._check(parsed)
            if placements:
                candidate.add_step(s["title"], placements, "" if rejected else key)
            if rejected:
                reports.append((n, s["title"], rejected))
            if warnings:
                floating.append((n, s["title"], warnings))
        self.workspace.commit(candidate)
        parts = catalog.validate(self.pieces) if self.pieces else None
        problems = len(reports) + (len(parts["issues"]) if parts else 0)
        kept = (
            ""
            if not same
            else f"kept step {fixed + 1} unchanged, "
            if same == 1
            else f"kept steps {fixed + 1} to {fixed + same} unchanged, "
        )
        rebuilt = len(steps) - same
        revision = self.workspace.build.revision[:8]
        lines = [
            f"Ran the script: {kept}rebuilt and checked {rebuilt} step{'' if rebuilt == 1 else 's'}.",
            f"Share {MODEL} to show revision {revision} to the user, then call look to see it.",
        ]
        if reports:
            lines += ["Problems, by script line; these bricks were not placed:", *_by_step(reports)]
        if parts and not parts["valid"]:
            lines.append(_catalog_issues(parts))
        if not problems:
            lines.append("No problems: every brick is known, fits, and exists in its color in LEGO sets.")
        if floating:
            lines += ["Floating, fine only if the subject flies or hangs there:", *_by_step(floating)]
        lines.append("Steps: pieces, then where they sit in studs (x, y) and plates (z, bottom to top):")
        lines.append(self.describe())
        lines.append(self.summary() + self.colors() + self.parts())
        lines.append("Kit, a note for ordering the model as one connected kit: " + self.assembly_plan().text)
        return Result("\n".join(lines) + printed, problems=problems)

    def assembly_plan(self, plan: dict | None = None) -> Result:
        """Plan/check the current frozen revision without editing its geometry."""
        build = self.workspace.build
        folder = self.workspace.evidence
        try:
            proposed = assembly.Plan.model_validate(plan) if plan is not None else assembly.cached_plan(folder, build)
        except ValueError as exc:
            return Result(f"Invalid assembly plan: {exc}", problems=1)
        report = assembly.check(build, proposed)
        assembly.save_report(folder, report)
        return Result(
            assembly.describe(report) + f"\nEvidence and accepted plan: {folder}",
            problems=0 if report.status == "verified" else 1,
        )

    def _fixed(self) -> int:
        """How many steps were built before the script; it builds on them and never changes them."""
        steps = self.workspace.build.steps
        return next((s.index for s in steps if s.key is not None), len(steps))

    def _taken(self, steps: int) -> list[list[int]]:
        """(x, y, w, d, z, height) on the grid of every piece in the first `steps` steps, except a baseplate."""
        s, out = ldraw.STUD, []
        for p, (lo, hi) in self._index().values():
            if p.step < steps and p.part != BASEPLATE:
                x, y, z = round(lo[0] / s), round(lo[2] / s), round(-hi[1] / ldraw.PLATE)
                w, d = round(hi[0] / s) - x, round(hi[2] / s) - y
                out.append([x, y, max(1, w), max(1, d), z, max(1, _top((lo, hi)) - z)])
        return out

    def find_parts(self, query: str) -> Result:
        hits = [part_line(p) for p in ldraw.search(query)]
        return Result("\n".join(hits) if hits else f"No parts match '{query}'. Try fewer or simpler words.")

    def catalog_colors(self, part: str) -> Result:
        resolved = ldraw.resolve(part)
        if not resolved or resolved not in ldraw.catalog():
            return Result("Unknown complete part; use bricks parts.", problems=1)
        try:
            record = catalog.entry(resolved)
        except ValueError as exc:
            return Result(str(exc), problems=1)
        choices = catalog.available_colors(record)
        return Result(
            f"{resolved} → Rebrickable {record['rebrickable']}. Verified colors (use these LDraw codes in the script):\n"
            + ", ".join(f"{c['color']} {c['name']}" for c in choices),
            problems=0 if choices else 1,
        )

    def check_catalog(self) -> Result:
        report = catalog.validate(self.pieces)
        return Result(catalog.describe(report), problems=len(report["issues"]))

    def rename(self, name: str) -> Result:
        self.workspace.save(self.workspace.build.model_copy(update={"name": name.strip()[:60] or "Untitled build"}))
        return Result(f"Build is now called '{self.workspace.build.name}'.")

    def colors(self) -> str:
        palette = ldraw.colors()
        counts = Counter(p.color for p in self.pieces)
        return " Colors: " + ", ".join(
            f"{color} {palette.get(color, ('Unknown', ''))[0].lower()} {count}" for color, count in counts.most_common()
        )

    def parts(self) -> str:
        counts = Counter(p.part for p in self.pieces if p.part != BASEPLATE)
        named = [
            f"{part.removesuffix('.dat')} {ldraw.info(part).title} {n}" for part, n in counts.most_common(PARTS_SHOWN)
        ]
        more = len(counts) - len(named)
        return " Parts: " + ", ".join(named) + (f" and {more} more" if more > 0 else "") if named else ""

    def summary(self) -> str:
        pieces = [p for p in self.pieces if p.part != BASEPLATE]
        if not pieces:
            return "Nothing is built yet."
        boxes = [grid(p) for p in pieces]
        indexed = self._index()
        top = max(_top(indexed[p.id][1]) for p in pieces)
        xs, ys = [b[0] for b in boxes], [b[1] for b in boxes]
        return (
            f"{len(pieces)} pieces in {len(self.workspace.build.steps)} steps, spanning x {min(xs)}-{max(xs)}, "
            f"y {min(ys)}-{max(ys)}, up to plate height {top}."
        )

    def describe(self) -> str:
        """One line per step: its pieces and the studs and plate heights they span."""
        indexed = self._index()
        boxes: dict[int, list[tuple]] = {}
        for p in self.pieces:
            boxes.setdefault(p.step, []).append(indexed[p.id][1])
        s, lines = ldraw.STUD, []

        def studs(lo: float, hi: float) -> str:
            return f"{math.floor((lo + EPS) / s)}-{math.ceil((hi - EPS) / s) - 1}"

        for step in self.workspace.build.steps:
            if step.index not in boxes:
                continue
            los, his = [b[0] for b in boxes[step.index]], [b[1] for b in boxes[step.index]]
            x = studs(min(v[0] for v in los), max(v[0] for v in his))
            y = studs(min(v[2] for v in los), max(v[2] for v in his))
            z = f"{max(0, round(min(-v[1] for v in his) / ldraw.PLATE))}-{max(map(_top, boxes[step.index]))}"
            n = len(boxes[step.index])
            lines.append(f"{step.index + 1} {step.title}: {n} piece{'s' * (n != 1)}, x {x}, y {y}, z {z}")
        return "\n".join(lines) or "No pieces yet."


def _catalog_issues(report: dict) -> str:
    retry = any(issue["code"] == "catalog_unavailable" for issue in report["issues"])
    return catalog.describe(report) + (
        "\nThe catalog snapshot is missing or expired; report it and do not change the design to bypass it."
        if retry
        else "\nChoose verified part/color combinations matching the reference, edit the script and run again."
    )


def _line(source: list[str], n: int) -> str | None:
    return f"line {n} `{source[n - 1].strip()[:70]}`" if 0 < n <= len(source) else None


def _digest(step: dict) -> str:
    bricks = [{k: v for k, v in b.items() if k != "line"} for b in step["bricks"]]
    return hashlib.sha256(json.dumps([step["title"], bricks], sort_keys=True).encode()).hexdigest()[:16]


def _execute(code: str, taken: list[list[int]]) -> dict:
    """Run a build script in a fresh process with an empty environment and a time limit."""
    job = json.dumps({"code": code, "taken": taken})
    try:
        done = subprocess.run(
            [sys.executable, "-I", "-m", "brickyard.script"],
            input=job,
            capture_output=True,
            text=True,
            env={"BRICKYARD_LDRAW": str(ldraw.LDRAW)},
            cwd=tempfile.gettempdir(),
            timeout=SCRIPT_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"error": f"The script ran for over {SCRIPT_TIMEOUT_S} s; look for a loop that never ends."}
    if done.returncode:
        return {"error": f"The script runner crashed: {done.stderr[-500:]}"}
    return json.loads(done.stdout)
