"""Build scripts, run in their own process: each call expands into grid bricks, grouped into manual steps."""

from __future__ import annotations

import contextlib
import io
import json
import random
import sys

from brickyard import catalog, ldraw, shapes
from brickyard.shapes import Brick, Cell

SOURCE = "<script>"
MAX_BRICKS = 100_000
PRINT_LIMIT = 2000
API = ("step", "brick", "mount", "top", "colors")


class Script:
    """The functions a script calls; tracks what fills each stud column so `top` sees earlier calls."""

    def __init__(self, taken: list[list[int]]):
        self.steps: list[dict] = []
        self.columns: dict[Cell, list[tuple[int, int]]] = {}
        self.count = 0
        for x, y, w, d, z, height in taken:
            self._occupy(shapes.rect(x, y, w, d), z, z + height)

    def _occupy(self, cells: set[Cell], lo: int, hi: int) -> None:
        for cell in cells:
            self.columns.setdefault(cell, []).append((lo, hi))

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
            if "facing" in b:
                self.steps[-1]["bricks"].append(b | {"line": line})
                continue
            try:
                w, d = shapes.footprint(b["part"], b["rotation"])
                height = ldraw.info(ldraw.resolve(b["part"]) or b["part"]).plates
            except (KeyError, ValueError):
                pass
            else:
                self._occupy(shapes.rect(b["x"], b["y"], w, d), b["z"], b["z"] + height)
            self.steps[-1]["bricks"].append(b | {"line": line})

    def step(self, title: str) -> None:
        """Start a manual step; the calls after it go into it, with `random` seeded from its title."""
        self.steps.append({"title": str(title)[:80], "bricks": []})
        random.seed(str(title))

    def brick(self, part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> None:
        self._add([shapes.brick(str(part), x, y, z, color, rotation)])

    def mount(self, part: str, x: int, y: int, z: int, color: int, facing: str) -> None:
        """A part on a wall's face, its top toward `facing`; `top` does not count it."""
        self._add([{"part": str(part), "x": x, "y": y, "z": z, "color": color, "facing": facing}])

    def top(self, x: int, y: int, w: int = 1, d: int = 1) -> int:
        """The highest plate height filled over the rectangle, 0 on bare ground."""
        return max((b for cell in shapes.rect(x, y, w, d) for _, b in self.columns.get(cell, ())), default=0)

    @staticmethod
    def colors(part: str) -> set[int]:
        """The LDraw codes of the colors `part` comes in, empty for a part the catalog does not know."""
        record = catalog.snapshot().parts.get(ldraw.resolve(str(part)) or "")
        return {c["color"] for c in catalog.available_colors(record)} if record else set()


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
    except (Exception, SystemExit) as e:  # noqa: BLE001
        return {"error": _explain(e, code), "printed": printed.getvalue()[-PRINT_LIMIT:]}
    steps = [s for s in script.steps if s["bricks"]]
    return {"steps": steps, "printed": printed.getvalue()[-PRINT_LIMIT:]}


def main() -> None:
    job = json.load(sys.stdin)
    sys.stdout.write(json.dumps(run(job["code"], job["taken"])))


if __name__ == "__main__":
    main()
