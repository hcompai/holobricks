"""Build scripts, run in their own process: each call expands into grid bricks, grouped into manual steps."""

from __future__ import annotations

import contextlib
import io
import json
import random
import sys
from typing import Literal

from pydantic import BaseModel, Field

from brickyard import ldraw, shapes
from brickyard.shapes import Brick, Cell

SOURCE = "<script>"
MAX_BRICKS = 20_000
PRINT_LIMIT = 2000
ARCHES = {2: "3659", 4: "3455"}
API = ("step", "brick", "walls", "fill", "roof", "top")


class Windows(BaseModel):
    color: int
    every: int = Field(2, ge=2)
    width: int = Field(1, ge=1)
    courses: list[int]


class Opening(BaseModel):
    side: Literal["south", "north", "west", "east"]
    at: int = Field(ge=0)
    width: int = Field(ge=1)
    courses: int = Field(ge=1)
    arch: bool = False


class Script:
    """The functions a script calls; tracks what fills each stud column so `fill` and `top` see earlier calls."""

    def __init__(self, taken: list[list[int]]):
        self.steps: list[dict] = []
        self.notes: list[str] = []
        self.columns: dict[Cell, list[tuple[int, int]]] = {}
        self.count = 0
        for x, y, w, d, z, height in taken:
            self._occupy(shapes.rect(x, y, w, d), z, z + height)

    def _occupy(self, cells: set[Cell], lo: int, hi: int) -> None:
        for cell in cells:
            self.columns.setdefault(cell, []).append((lo, hi))

    def _free(self, cell: Cell, lo: int, hi: int) -> bool:
        return all(hi <= a or b <= lo for a, b in self.columns.get(cell, ()))

    @staticmethod
    def _line() -> int:
        frame = sys._getframe(1)
        while frame and frame.f_code.co_filename != SOURCE:
            frame = frame.f_back
        return frame.f_lineno if frame else 0

    def _add(self, bricks: list[Brick]) -> None:
        if not self.steps:
            self.step("Build")
        self.count += len(bricks)
        if self.count > MAX_BRICKS:
            raise ValueError(f"the script makes more than {MAX_BRICKS} bricks")
        line = self._line()
        for b in bricks:
            try:
                w, d = shapes.footprint(b["part"], b["rotation"])
                height = ldraw.info(ldraw.resolve(b["part"]) or b["part"]).plates
            except (KeyError, ValueError):
                pass
            else:
                self._occupy(shapes.rect(b["x"], b["y"], w, d), b["z"], b["z"] + height)
            self.steps[-1]["bricks"].append(b | {"line": line})

    def step(self, title: str) -> None:
        """Start a manual step; the calls after it go into it."""
        self.steps.append({"title": str(title)[:80], "bricks": []})

    def brick(self, part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> None:
        self._add([shapes.brick(str(part), x, y, z, color, rotation)])

    def walls(
        self,
        x: int,
        y: int,
        w: int,
        d: int,
        z: int,
        courses: int,
        color: int,
        corners: int | None = None,
        windows: dict | None = None,
        openings: list[dict] = (),  # type: ignore[assignment]
    ) -> int:
        """Hollow bonded walls around x..x+w-1, y..y+d-1 with windows and openings; returns the top z."""
        if w < 2 or d < 2 or courses < 1:
            raise ValueError("walls need w and d of at least 2 and at least 1 course")
        glazing = Windows.model_validate(windows) if windows else None
        gaps = [Opening.model_validate(o) for o in openings]
        if any(o.arch and (o.width not in ARCHES or o.courses >= courses) for o in gaps):
            raise ValueError("arched openings must be 2 or 4 studs wide and lower than the walls")
        x1, y1 = x + w - 1, y + d - 1

        def span(o: Opening, at: int, width: int) -> list[Cell]:
            if o.side in ("south", "north"):
                row = y if o.side == "south" else y1
                return [(x + at + i, row) for i in range(width)]
            column = x if o.side == "west" else x1
            return [(column, y + at + i) for i in range(width)]

        holes = [(0, o.courses, set(span(o, o.at, o.width))) for o in gaps]
        arches = [(o.courses, o, span(o, o.at - 1, o.width + 2)) for o in gaps if o.arch]
        holes += [(c, c + 1, set(cells)) for c, _, cells in arches]

        def glass(cx: int, cy: int, c: int) -> bool:
            if glazing is None or c not in glazing.courses:
                return False
            i, n = (cx - x, w) if cy in (y, y1) else (cy - y, d)
            return 0 < i < n - 1 and i % glazing.every >= glazing.every - glazing.width

        def shade(cx: int, cy: int, c: int) -> int:
            if corners is not None and cx in (x, x1) and cy in (y, y1):
                return corners
            return glazing.color if glazing and glass(cx, cy, c) else color

        def opening(cx: int, cy: int, c: int) -> bool:
            return any(lo <= c < hi and (cx, cy) in cells for lo, hi, cells in holes)

        bricks = []
        for c in range(courses):
            bricks += shapes.ring(x, y, w, d, z + 3 * c, 1, shade, opening, start=c)
            for k, o, cells in arches:
                if k == c:
                    turn = 0 if o.side in ("south", "north") else 90
                    bricks.append(shapes.brick(ARCHES[o.width], *cells[0], z + 3 * k, color, turn))
        self._add(bricks)
        return z + 3 * courses

    def fill(
        self,
        x: int,
        y: int,
        w: int,
        d: int,
        z: int,
        color: int | None = None,
        palette: list[list[int]] | None = None,
        kind: str = "plate",
        skip: list[list[int]] = (),  # type: ignore[assignment]
    ) -> None:
        """Cover the rectangle's free cells at height z, largest parts first, or in random `palette` colors."""
        if kind not in shapes.SIZES:
            raise ValueError(f"kind must be one of {list(shapes.SIZES)}")
        if (color is None) == (palette is None):
            raise ValueError("give fill either a color or a palette")
        cells = shapes.rect(x, y, w, d).difference(*(shapes.rect(*s) for s in skip))
        free = {c for c in cells if self._free(c, z, z + shapes.HEIGHTS[kind])}
        if len(free) < len(cells) / 2:
            self.notes.append(
                f"line {self._line()}: fill covered only {len(free)} of {len(cells)} cells; the rest are already "
                f"filled at z={z}. To lay it on top of them, use z={self.top(x, y, w, d)}."
            )
        if palette:
            rng = random.Random(f"{x},{y},{z},{w},{d}")
            pairs = [(int(c), int(n)) for c, n in palette]
            self._add(shapes.scatter(free, z, pairs, rng, shapes.MOSAIC[kind]))
        else:
            self._add(shapes.cover(free, z, color, shapes.SIZES[kind]))

    def roof(self, x: int, y: int, w: int, d: int, z: int, color: int, steep: bool = False) -> int:
        """A plate ceiling at z with a hipped roof on it, or a spire when steep and square; returns the top z."""
        if w % 2 or d % 2:
            raise ValueError(f"a roof needs an even width and depth, not {w}x{d}")
        slopes, top = shapes.roof(x, y, w, d, z + 1, color, steep)
        self._add(shapes.cover(shapes.rect(x, y, w, d), z, color) + slopes)
        return top

    def top(self, x: int, y: int, w: int = 1, d: int = 1) -> int:
        """The highest plate height filled over the rectangle, 0 on the bare baseplate."""
        return max((b for cell in shapes.rect(x, y, w, d) for _, b in self.columns.get(cell, ())), default=0)


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
    try:
        with contextlib.redirect_stdout(printed):
            exec(compile(code, SOURCE, "exec"), scope)  # noqa: S102
    except (Exception, SystemExit) as e:  # noqa: BLE001
        return {"error": _explain(e, code), "printed": printed.getvalue()[-PRINT_LIMIT:]}
    steps = [s for s in script.steps if s["bricks"]]
    return {"steps": steps, "notes": script.notes, "printed": printed.getvalue()[-PRINT_LIMIT:]}


def main() -> None:
    job = json.load(sys.stdin)
    sys.stdout.write(json.dumps(run(job["code"], job["taken"])))


if __name__ == "__main__":
    main()
