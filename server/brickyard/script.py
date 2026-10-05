"""Build scripts, run in their own process: each call expands into grid bricks, grouped into manual steps."""

from __future__ import annotations

import contextlib
import io
import json
import random
import sys
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from functools import cache

from brickyard import catalog, ldraw, shapes
from brickyard.model import IDENTITY, Brick, Placement, bounds, extent
from brickyard.sculpt import Sculpture, circle
from brickyard.shapes import Cell

SOURCE = "<script>"
MAX_BRICKS = 100_000
PRINT_LIMIT = 2000
API = ("step", "brick", "mount", "place", "top", "colors", "box", "disc", "fill", "carve", "roof", "cone", "cover")
Shade = int | Callable[[int, int, int], int]
RUN_LENGTH = {part: n for n, part in shapes.BRICK_RUN.items()}


class Script:
    """The functions a script calls; tracks what fills each stud column so `top` sees earlier calls."""

    def __init__(self, taken: list[list[int]]):
        self.steps: list[dict] = []
        self.columns: dict[Cell, list[tuple[int, int]]] = {}
        self.count = 0
        self.sculpture: Sculpture | None = None
        self.peak = 0
        for x, y, w, d, z, height in taken:
            self._occupy(shapes.rect(x, y, w, d), z, z + height)

    def _occupy(self, cells: set[Cell], lo: int, hi: int) -> None:
        for cell in cells:
            self.columns.setdefault(cell, []).append((lo, hi))

    @staticmethod
    def _lines() -> tuple[int, int]:
        """The script line that made the brick and the top-level line that led to it, the same outside helpers."""
        lines = []
        frame = sys._getframe(1)
        while frame:
            if frame.f_code.co_filename == SOURCE:
                lines.append(frame.f_lineno)
            frame = frame.f_back
        return (lines[0], lines[-1]) if lines else (0, 0)

    def _add(self, bricks: list[dict]) -> None:
        line, call = self._lines()
        self._record([(b, line, call) for b in bricks])

    def _record(self, made: list[tuple[dict, int, int]]) -> None:
        if not self.steps:
            self.step("Build")
        self.count += len(made)
        if self.count > MAX_BRICKS:
            raise ValueError(f"the script makes more than {MAX_BRICKS} bricks")
        for b, line, call in made:
            self.steps[-1]["bricks"].append(b | {"line": line, "call": call})
            try:
                brick = Brick.model_validate(b)
                x, y, w, d, z, height = self._extent(brick)
            except (ArithmeticError, KeyError, ValueError):
                continue
            if brick.facing is None:
                self._occupy(shapes.rect(x, y, w, d), z, z + height)

    @staticmethod
    def _extent(b: Brick) -> tuple[int, int, int, int, int, int]:
        """(x, y, w, d, z, height) that the brick fills on the grid."""
        part = ldraw.resolve(b.part) or b.part
        if b.pos is not None:
            return extent(bounds(Placement(part=part, color=b.color, pos=b.pos, rot=b.rot)))
        w, d = shapes.footprint(b.part, b.rotation)
        return b.x, b.y, w, d, b.z, ldraw.info(part).plates

    def step(self, title: str) -> None:
        """Start a manual step; the calls after it go into it, with `random` seeded from its title."""
        self._flush()
        self.steps.append({"title": str(title)[:80], "bricks": []})
        random.seed(str(title))

    def brick(self, part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> None:
        self._add([shapes.brick(str(part), x, y, z, color, rotation)])

    def mount(self, part: str, x: int, y: int, z: int, color: int, facing: str) -> None:
        """A part on a wall's face, its top toward `facing`; `top` does not count it."""
        self._add([{"part": str(part), "x": x, "y": y, "z": z, "color": color, "facing": facing}])

    def place(self, part: str, color: int, pos: Sequence[float], rot: Sequence[float] = IDENTITY) -> None:
        """A part exactly where LDraw puts it: `pos` in LDU, `rot` 9 numbers row by row; no glass comes with it."""
        pos, rot = [float(v) for v in pos], [float(v) for v in rot]
        if len(pos) != 3 or len(rot) != 9:
            raise ValueError("place takes pos as 3 numbers and rot as 9")
        self._add([{"part": str(part), "color": color, "pos": pos, "rot": rot}])

    def top(self, x: int, y: int, w: int = 1, d: int = 1) -> int:
        """The highest plate height filled over the rectangle, 0 on bare ground; counts this step's solids."""
        cells = shapes.rect(x, y, w, d)
        filled = max((b for cell in cells for _, b in self.columns.get(cell, ())), default=0)
        sc = self.sculpture
        if sc is None:
            return filled
        courses = (next((k + 1 for k in range(self.peak, -1, -1) if (*c, k) in sc.solid), 0) for c in cells)
        return max(filled, max((sc.z0 + 3 * k for k in courses if k), default=0))

    @staticmethod
    def colors(part: str) -> set[int]:
        """The LDraw codes of the colors `part` comes in, empty for a part the catalog does not know."""
        return set(_made_in(str(part)))

    @staticmethod
    def box(x: int, y: int, w: int, d: int) -> set[Cell]:
        """The studs of a w by d rectangle from (x, y)."""
        return shapes.rect(x, y, w, d)

    @staticmethod
    def disc(cx: float, cy: float, r: float) -> set[Cell]:
        """The studs whose centers lie within r of (cx, cy)."""
        return circle(cx, cy, r)

    def _grid(self, z: int, height: int) -> tuple[Sculpture, int]:
        """The step's sculpture and the course at plate z, which has to sit on its grid of whole bricks."""
        if not self.steps:
            self.step("Build")
        if z < 0:
            raise ValueError(f"z={z} is below the ground")
        if self.sculpture is None:
            self.sculpture = Sculpture(z % 3, supported=True)
        sc = self.sculpture
        if (z - sc.z0) % 3 or height % 3:
            raise ValueError(
                f"solids come in whole bricks: this step's solids start at z = {sc.z0}, {sc.z0 + 3}, {sc.z0 + 6} "
                f"and so on, and rise in 3s; got z={z}, height {height}. Start a new step for another grid"
            )
        sc.owner = self._lines()
        return sc, (z - sc.z0) // 3

    def _shade(self, color: Shade) -> Shade:
        z0 = self.sculpture.z0 if self.sculpture else 0
        return (lambda x, y, k: color(x, y, z0 + 3 * k)) if callable(color) else color

    def fill(self, cells: Iterable[Cell], z: int, height: int, color: Shade, sloped: bool = False) -> None:
        """Make the studs solid from plate z up `height` plates; the step's end turns its solids into bricks."""
        sc, k = self._grid(z, height)
        sc.fill(cells, k, k + height // 3, self._shade(color), sloped)
        self.peak = max(self.peak, k + height // 3)

    def carve(self, cells: Iterable[Cell], z: int, height: int) -> None:
        """Empty the studs from plate z up `height` plates, out of this step's solids."""
        sc, k = self._grid(z, height)
        sc.carve(cells, k, k + height // 3)

    def roof(self, cells: Iterable[Cell], z: int, color: Shade, pitch: int = 6, ridge: str | None = None) -> int:
        """A solid roof from plate z, in one stud every `pitch` plates; returns the plate above its top."""
        if pitch < 3:
            raise ValueError("a roof's pitch is 3 plates or more")
        sc, k = self._grid(z, pitch)
        end = sc.roof(cells, k, self._shade(color), pitch // 3, ridge)
        self.peak = max(self.peak, end)
        return sc.z0 + 3 * end

    def cone(self, cx: float, cy: float, r: float, z: int, height: int, color: Shade) -> int:
        """A solid spire of shrinking circles from plate z; returns the plate above its tip."""
        sc, k = self._grid(z, height)
        end = sc.cone(cx, cy, r, k, height // 3, self._shade(color))
        self.peak = max(self.peak, end)
        return sc.z0 + 3 * end

    def cover(self, cells: Iterable[Cell], z: int, color: int | Callable[[int, int], int], tiles: bool = False) -> None:
        """One layer of plates (or tiles) at z over the studs, largest first in parts that come in the color; skips
        studs already filled there."""
        groups: dict[int, set[Cell]] = defaultdict(set)
        for c in cells:
            if not any(lo <= z < hi for lo, hi in self.columns.get(c, ())):
                groups[color(*c) if callable(color) else color].add(c)
        sizes = shapes.TILES if tiles else shapes.PLATES
        bricks = []
        for shade, group in groups.items():
            made = [s for s in sizes if shade in self.colors(s[2])]
            bricks += shapes.cover(group, z, shade, made if any(w == d == 1 for w, d, _ in made) else sizes)
        self._add(bricks)

    def _flush(self) -> None:
        """Turn the step's solids into bricks: the shell only, slopes on steps, giving way to pieces placed."""
        sc, self.sculpture, self.peak = self.sculpture, None, 0
        if sc is None:
            return
        for x, y in {(x, y) for x, y, _ in sc.solid}:
            for lo, hi in self.columns.get((x, y), ()):
                for k in range((lo - sc.z0) // 3, -((sc.z0 - hi) // 3)):
                    sc.solid.pop((x, y, k), None)
                    sc.claimed.add((x, y, k))
        pieces = sc.mesh(lambda x, y: 0 if sc.z0 == 0 else -1)
        self._record([(part, *owner) for _, owner, b in pieces for part in _in_color(b)])  # type: ignore[misc]


@cache
def _made_in(part: str) -> frozenset[int]:
    """Empty without a catalog too: the run's catalog check reports that."""
    try:
        record = catalog.snapshot().parts.get(ldraw.resolve(part) or "")
    except catalog.CatalogUnavailable:
        return frozenset()
    return frozenset(c["color"] for c in catalog.available_colors(record)) if record else frozenset()


def _in_color(b: dict) -> list[dict]:
    """A run of bricks in sizes that come in its color, the brick itself when it does or no size would."""
    n = RUN_LENGTH.get(b["part"])
    sizes = {k: v for k, v in shapes.BRICK_RUN.items() if b["color"] in _made_in(v)}
    if n is None or b["color"] in _made_in(b["part"]) or 1 not in sizes:
        return [b]
    dx, dy = (1, 0) if b["rotation"] % 180 == 0 else (0, 1)
    out, at = [], 0
    for size in shapes.split(n, sizes, stagger=False):
        out.append(b | {"part": sizes[size], "x": b["x"] + dx * at, "y": b["y"] + dy * at})
        at += size
    return out


def _explain(error: BaseException, code: str) -> str:
    line = error.lineno if isinstance(error, SyntaxError) and error.filename == SOURCE else None
    tb = error.__traceback__
    while tb:
        if tb.tb_frame.f_code.co_filename == SOURCE:
            line = tb.tb_lineno
        tb = tb.tb_next
    lines = code.splitlines()
    where = f"line {line} `{lines[line - 1].strip()}`: " if line and line <= len(lines) else ""
    return f"{where}{type(error).__name__}: {error}"[:800]


def run(code: str, taken: list[list[int]]) -> dict:
    """The script's non-empty steps, or the error that stopped it; either way, what it printed."""
    script = Script(taken)
    printed = io.StringIO()
    scope = {"__name__": "__main__", **{name: getattr(script, name) for name in API}}
    random.seed(0)
    try:
        with contextlib.redirect_stdout(printed):
            exec(compile(code, SOURCE, "exec"), scope)  # noqa: S102
            script._flush()
    except (Exception, SystemExit) as e:  # noqa: BLE001
        return {"error": _explain(e, code), "printed": printed.getvalue()[-PRINT_LIMIT:]}
    steps = [s for s in script.steps if s["bricks"]]
    return {"steps": steps, "printed": printed.getvalue()[-PRINT_LIMIT:]}


def main() -> None:
    job = json.load(sys.stdin)
    sys.stdout.write(json.dumps(run(job["code"], job["taken"])))


if __name__ == "__main__":
    main()
