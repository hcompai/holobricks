"""The model an agent edits: a build script rebuilt into validated steps, plus part search and checks."""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import zip_longest

from pydantic import ValidationError

from brickyard import assembly, catalog, ldraw, support
from brickyard.model import (
    ACCESSORIES,
    FACINGS,
    ROTATIONS,
    UNNAMED,
    Brick,
    Matrix,
    Piece,
    Placement,
    bounds,
    extent,
    footprint,
    grid,
    mount,
    place,
    top,
    with_accessories,
)
from brickyard.support import overlap as _overlap
from brickyard.workspace import MODEL, Workspace

STUD_HEIGHT = 4
EPS = 0.5
TURN_TOLERANCE = 1e-3
"""How far a rotation's rows may stray from unit length and right angles, as in LDraw files rounded to 6 digits."""
CELL = 4 * ldraw.STUD
PROBLEM_LIMIT = 12
PARTS_SHOWN = 12
PARTS_FOUND = 20
LINES_CITED = 3
SCRIPT_TIMEOUT_S = 40
"""Well under the agent's 60 s shell wait, so a run and the share after it see the same revision."""
BASEPLATE = "3811.dat"


@dataclass
class Result:
    text: str
    problems: int = 0


def _collides(a: tuple, b: tuple) -> bool:
    dx, dy, dz = _overlap(a, b)
    return dx > EPS and dz > EPS and dy > STUD_HEIGHT + EPS


def _turns(rot: Matrix) -> bool:
    """Whether `rot` only turns or mirrors a part: its rows have length 1 and meet at right angles."""
    rows = [rot[k : k + 3] for k in (0, 3, 6)]
    return all(
        abs(sum(a * b for a, b in zip(r, s, strict=True)) - (i == j)) < TURN_TOLERANCE
        for i, r in enumerate(rows)
        for j, s in enumerate(rows)
    )


def _cells(box: tuple) -> list[tuple[int, int]]:
    xs = range(int(box[0][0] // CELL), int(box[1][0] // CELL) + 1)
    return [(cx, cz) for cx in xs for cz in range(int(box[0][2] // CELL), int(box[1][2] // CELL) + 1)]


def _where(p: Placement | Piece) -> str:
    x, y, z, rotation = grid(p)
    facing = next((f for f, m in FACINGS.items() if m == tuple(p.rot)), None)
    turn = f" facing={facing}" if facing else f" rot={rotation}" if rotation else ""
    return f"{p.part.removesuffix('.dat')} at x={x} y={y} z={z}{turn}"


def _studs(boxes: list[tuple]) -> tuple[str, str]:
    """The first and last studs the boxes cover along x and along y."""

    def span(k: int) -> str:
        lo, hi = min(b[0][k] for b in boxes), max(b[1][k] for b in boxes)
        return f"{math.floor((lo + EPS) / ldraw.STUD)}-{math.ceil((hi - EPS) / ldraw.STUD) - 1}"

    return span(0), span(2)


def _invalid(error: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, e['loc']))} {e['input']!r:.40}: {e['msg']}" for e in error.errors())


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
        self, bricks: list[dict], mounted: list[Placement] = (), origins: list[str] | None = None
    ) -> tuple[list[Placement], list[str]]:
        """Placements that fit and rejection lines; support is checked on the complete model."""
        indexed = self._index()
        batch: dict[tuple[int, int], list[tuple[tuple, str]]] = {}

        def near(box: tuple) -> list[tuple[tuple, int | str]]:
            ids = sorted({pid for cell in _cells(box) for pid in self._cells.get(cell, ())})
            own = {id(entry): entry for cell in _cells(box) for entry in batch.get(cell, [])}
            return [(indexed[pid][1], pid) for pid in ids] + list(own.values())

        def name(what: int | str) -> str:
            return what if isinstance(what, str) else f"#{what} {_where(indexed[what][0])}"

        accepted: list[tuple[Placement, str]] = []
        rejected = []
        parsed: list[tuple[int, Brick]] = []
        for n, raw in enumerate(bricks, 1):
            try:
                parsed.append((n, Brick.model_validate(raw)))
            except ValidationError as e:
                rejected.append(f"{raw.get('label') or f'brick {n}'}: {_invalid(e)}")
        candidates: list[tuple[str, str, Placement]] = []
        exact: set[int] = set()
        frames = {
            (ACCESSORIES[frame][0], b.pos, b.rot)
            for _, b in parsed
            if b.pos is not None and (frame := ldraw.resolve(b.part)) in ACCESSORIES
        }
        inserts: dict[tuple, list[Placement]] = defaultdict(list)
        for n, brick in parsed:
            at = f"x={brick.x} y={brick.y} z={brick.z}" if brick.pos is None else f"pos={brick.pos}"
            label = f"{brick.label or f'brick {n}'} ({brick.part} at {at})"
            origin = brick.label or label
            part = ldraw.resolve(brick.part)
            if part is None:
                rejected.append(f"{label}: unknown part; use bricks parts")
            elif brick.color not in ldraw.colors():
                rejected.append(f"{label}: unknown color {brick.color}")
            elif brick.pos is not None:
                placement = Placement(part=part, color=brick.color, pos=brick.pos, rot=brick.rot)
                if not all(map(math.isfinite, brick.pos)) or not _turns(brick.rot):
                    rejected.append(f"{label}: pos must be finite and rot a turn, rows of length 1 at right angles")
                elif (part, brick.pos, brick.rot) in frames:
                    inserts[part, brick.pos, brick.rot].append(placement)
                else:
                    exact.add(id(placement))
                    candidates.append((origin, label, placement))
            elif brick.rotation not in ROTATIONS:
                rejected.append(f"{label}: rotation must be 0, 90, 180 or 270")
            elif brick.z < 0:
                rejected.append(f"{label}: below the ground")
            elif brick.facing is not None:
                if brick.facing in FACINGS:
                    placement = mount(part, brick.x, brick.y, brick.z, brick.color, brick.facing)
                    candidates.append((origin, label, placement))
                else:
                    rejected.append(f"{label}: facing must be south, north, west or east")
            else:
                placement = place(part, brick.x, brick.y, brick.z, brick.color, brick.rotation)
                candidates.append((origin, label, placement))
        for p in mounted:
            label = f"mounted {p.part.removesuffix('.dat')}"
            if ldraw.resolve(p.part) is None:
                rejected.append(f"{label}: unknown part")
            else:
                candidates.append((label, label, p))
        for origin, label, placement in candidates:
            box = bounds(placement)
            if box[0][0] < -EPS or box[0][2] < -EPS:
                rejected.append(f"{label}: x and y start at 0; to make room, add an offset to the whole plan")
                continue
            neighbors = near(box)
            hit = next(((other, what) for other, what in neighbors if _collides(box, other)), None)
            if hit:
                rejected.append(f"{label}: overlaps {name(hit[1])}, which fills up to z={top(hit[0])}")
                continue
            accepted.append((placement, origin))
            for cell in _cells(box):
                batch.setdefault(cell, []).append((box, f"{label} of this step"))

        def fitted(p: Placement) -> list[Placement]:
            """The placement and its inserts: those placed exactly with it, else the usual ones."""
            if id(p) not in exact:
                return with_accessories(p)
            return [p, *inserts.pop((ACCESSORIES.get(p.part, ("",))[0], p.pos, p.rot), [])]

        placements = []
        for placement, origin in accepted:
            parts = fitted(placement)
            placements.extend(parts)
            if origins is not None:
                origins.extend([origin] * len(parts))
        return placements, rejected

    def add(self, title: str, bricks: list[dict], mounted: list[Placement] = ()) -> Result:
        """Place the bricks that fit with verified colors, then warn about model-wide support."""
        if not bricks and not mounted:
            return Result("No bricks given.")
        labels = []
        placements, rejected = self._check(bricks, list(mounted), origins=labels)
        origins = {}
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
            origins.update(zip((p.id for p in new), labels, strict=True))
            lines.append(f"Step {step.index + 1} '{title}': placed {len(new)} pieces as #{new[0].id}-#{new[-1].id}.")
        if rejected:
            lines.append(f"Rejected {len(rejected)}, not placed:\n" + _first(rejected))
        floating = support.detached(self.pieces)
        if floating:
            lines.append(_floating(floating, origins))
        return Result("\n".join(lines), problems=len(rejected))

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
        reports, origins = [], {}
        for n, (s, key) in enumerate(zip(steps[same:], keys[same:], strict=True), kept_steps + 1):
            bricks = [b | {"label": _cite(source, b["line"], b["call"])} for b in s["bricks"]]
            labels = []
            placements, rejected = draft._check(bricks, origins=labels)
            if placements:
                candidate.add_step(s["title"], placements, "" if rejected else key)
                origins.update(zip((p.id for p in candidate.pieces[-len(placements) :]), labels, strict=True))
            if rejected:
                reports.append((n, s["title"], rejected))
        # Earlier steps are not anchors: check the final geometry, including kept/manual
        # pieces and supports added in later steps. A floating group cannot support itself.
        floating = support.detached(candidate.pieces)
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
            _cite_lines(parts, steps, source)
            lines.append(_catalog_issues(parts))
        if not problems:
            lines.append(
                "Placement and catalog checks passed; inspect the support warnings below."
                if floating
                else "No problems: every brick is known, fits, and exists in its color in real sets."
            )
        if floating:
            lines.append(_floating(floating, origins))
        lines.append("Steps: pieces, then where they sit in studs (x, y) and plates (z, bottom to top):")
        lines.append(self.describe())
        lines.append(self.summary() + self.colors() + self.parts())
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
        return [list(extent(box)) for p, box in self._index().values() if p.step < steps and p.part != BASEPLATE]

    def find_parts(self, query: str) -> Result:
        """The catalog's parts matching `query`, or the exact part asked for, each with its number of colors."""
        try:
            known = catalog.snapshot().parts
        except catalog.CatalogUnavailable as exc:
            return Result(str(exc), problems=1)
        exact, hits = ldraw.resolve(query), []
        for part in ldraw.search(query):
            n = len(catalog.available_colors(known[part])) if part in known else 0
            if n or part == exact:
                hits.append(f"{part_line(part)} | in {n} color{'s' * (n != 1)}")
            if len(hits) == PARTS_FOUND:
                break
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
        self.workspace.save(self.workspace.build.model_copy(update={"name": name.strip()[:60] or UNNAMED}))
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
        indexed = self._index()
        boxes = [indexed[p.id][1] for p in pieces]
        x, y = _studs(boxes)
        return (
            f"{len(pieces)} pieces in {len(self.workspace.build.steps)} steps, spanning x {x}, "
            f"y {y}, up to plate height {max(map(top, boxes))}."
        )

    def describe(self) -> str:
        """One line per step: its pieces and the studs and plate heights they span."""
        indexed = self._index()
        boxes: dict[int, list[tuple]] = {}
        for p in self.pieces:
            boxes.setdefault(p.step, []).append(indexed[p.id][1])
        lines = []
        for step in self.workspace.build.steps:
            if step.index not in boxes:
                continue
            x, y = _studs(boxes[step.index])
            his = [b[1] for b in boxes[step.index]]
            z = f"{max(0, round(min(-v[1] for v in his) / ldraw.PLATE))}-{max(map(top, boxes[step.index]))}"
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


def _cite_lines(report: dict, steps: list[dict], source: list[str]) -> None:
    """Give each catalog issue the first script lines and calls that made its part/color pair."""
    made: dict[tuple, set[tuple[int, int]]] = defaultdict(set)
    for step in steps:
        for b in step["bricks"]:
            made[ldraw.resolve(str(b["part"])), b["color"]].add((b["line"], b["call"]))
    for issue in report["issues"]:
        found = sorted(made.get((issue.get("part"), issue.get("color")), ()))
        issue["lines"] = [where for line, call in found[:LINES_CITED] if (where := _cite(source, line, call))]


def _floating(groups: list[list[Piece]], origins: dict[int, str]) -> str:
    """One inspection box per group, spread across steps so repeated parts do not hide other gaps."""
    by_step = defaultdict(list)
    for n, group in enumerate(groups, 1):
        by_step[min(p.step for p in group)].append((n, group))
    ordered = [item for row in zip_longest(*by_step.values()) for item in row if item is not None]
    count = sum(map(len, groups))
    lines = [
        (
            f"Support warnings: {count} piece{'s' if count != 1 else ''} "
            f"in {len(groups)} possibly detached group{'s' if len(groups) != 1 else ''}."
        ),
        "No ground contact path found by the approximate check. Inspect the joins; warnings do not block the run.",
    ]
    for n, pieces in ordered[:PROBLEM_LIMIT]:
        boxes = [bounds(p) for p in pieces]
        x0, y0 = (math.floor(min(b[0][k] for b in boxes) / ldraw.STUD) for k in (0, 2))
        x1, y1 = (math.ceil(max(b[1][k] for b in boxes) / ldraw.STUD) for k in (0, 2))
        z1 = max(map(top, boxes))
        # Include the ground and neighboring supports: cropping to just the
        # detached pieces would hide the gap the agent needs to inspect.
        box = [max(0, x0 - 1), max(0, y0 - 1), 0, x1 + 1, y1 + 1, z1 + 1]
        steps = ", ".join(map(str, sorted({p.step + 1 for p in pieces})))
        lines.append(f"Group {n}: {len(pieces)} piece{'s' if len(pieces) != 1 else ''}; steps {steps}; look box {box}.")
        seen = set()
        for p in pieces:
            origin = origins.get(p.id, "")
            if origin not in seen and len(seen) < LINES_CITED:
                lines.append(f"  #{p.id} {_where(p)}" + (f"; {origin}" if origin else ""))
                seen.add(origin)
    if len(groups) > PROBLEM_LIMIT:
        lines.append(f"... and {len(groups) - PROBLEM_LIMIT} more groups not shown.")
    lines.append("Bounding-box contact can miss side/clip joins; it is not a stud/socket or strength proof.")
    return "\n".join(lines)


def _line(source: list[str], n: int) -> str | None:
    return f"line {n} `{source[n - 1].strip()[:70]}`" if 0 < n <= len(source) else None


def _cite(source: list[str], line: int, call: int) -> str | None:
    """The line that made a brick, then the top-level line that called it when a helper made it."""
    made, via = _line(source, line), _line(source, call)
    return f"{made} from {via}" if made and via and call != line else made


def _digest(step: dict) -> str:
    bricks = [{k: v for k, v in b.items() if k not in ("line", "call")} for b in step["bricks"]]
    return hashlib.sha256(json.dumps([step["title"], bricks], sort_keys=True).encode()).hexdigest()[:16]


def _execute(code: str, taken: list[list[int]]) -> dict:
    """Run a build script in a fresh process with a fixed hash seed, a clean environment and a time limit."""
    job = json.dumps({"code": code, "taken": taken})
    try:
        done = subprocess.run(
            [sys.executable, "-s", "-P", "-m", "brickyard.script"],
            input=job,
            capture_output=True,
            text=True,
            env={
                "BRICKYARD_LDRAW": str(ldraw.LDRAW),
                "BRICKYARD_CATALOG": str(catalog.SNAPSHOT),
                "PYTHONHASHSEED": "0",
            },
            cwd=tempfile.gettempdir(),
            timeout=SCRIPT_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"error": f"The script ran for over {SCRIPT_TIMEOUT_S} s; look for a loop that never ends."}
    if done.returncode:
        return {"error": f"The script runner crashed: {done.stderr[-500:]}"}
    return json.loads(done.stdout)
