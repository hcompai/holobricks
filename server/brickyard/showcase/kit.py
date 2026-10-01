"""Toolkit for hand-scripted showcase builds: facade frames over the shared shapes; every step is validated."""

from __future__ import annotations

import math
import random
from collections.abc import Iterable
from functools import cache

from brickyard import catalog, ldraw, shapes
from brickyard.model import Build, Message, Placement, mount, place
from brickyard.shapes import BRICK_RUN, BRICKS, MOSAIC, PLATES, Cell, footprint, rect, split
from brickyard.store import Store
from brickyard.workbench import Workbench
from brickyard.workspace import Workspace

FACINGS = {"south": 0, "west": 90, "north": 180, "east": 270}


CLEAR_RUN = {4: "3066", 2: "3065", 1: "3005"}
FINISHES = (
    "Trans",
    "Glitter",
    "Glow",
    "Pearl",
    "Metallic",
    "Chrome",
    "Flat Silver",
    "Speckle",
    "Satin",
    "Opal",
    "Milky",
)


@cache
def listed(part: str) -> tuple[int, ...]:
    """The colors the catalog lists for `part`, none if it can't be looked up."""
    try:
        record = catalog.entry(ldraw.resolve(part) or part)
    except ValueError:
        return ()
    return tuple(c["color"] for c in catalog.available_colors(record))


def finish(code: int) -> frozenset[str]:
    """The special finishes in the name of an LDraw color, like Trans or Pearl."""
    return frozenset(f for f in FINISHES if f in ldraw.colors()[code][0])


def lab(code: int) -> tuple[float, float, float]:
    """CIELAB of an LDraw color with hue counted twice, so greys stay grey rather than tinted at the same lightness."""
    value = ldraw.colors()[code][1].lstrip("#")
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    r, g, b = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)
    xyz = (
        (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505,
        0.2126 * r + 0.7152 * g + 0.0722 * b,
        (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089,
    )
    fx, fy, fz = (t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116 for t in xyz)
    return 116 * fy - 16, 1000 * (fx - fy), 400 * (fy - fz)


@cache
def verified(part: str, color: int) -> int:
    """`color` if the catalog lists it for `part`, else the nearest listed color of the same finish."""
    part = part.removesuffix(".dat")
    if color not in ldraw.colors() or color in listed(part) or not listed(part):
        return color
    options = (
        [c for c in listed(part) if finish(c) == finish(color)]
        or [c for c in listed(part) if finish(c) <= {"Trans"}]
        or listed(part)
    )
    return min(options, key=lambda c: math.dist(lab(c), lab(color)))


def orderable(b: dict) -> list[dict]:
    """`b` as bricks the catalog lists: a clear 1-wide brick split into tube-less ones of its color, else recolored."""
    part, color = b["part"].removesuffix(".dat"), b["color"]
    length = next((n for n, p in BRICK_RUN.items() if p == part), None)
    if length and "Trans" in finish(color) and color not in listed(part):
        along_y = b["rotation"] in (90, 270)
        pieces, at = [], 0
        for n in split(length, CLEAR_RUN, stagger=False):
            pieces.append(b | {"part": CLEAR_RUN[n], "x": b["x"] + at * (not along_y), "y": b["y"] + at * along_y})
            at += n
        if all(color in listed(p["part"]) for p in pieces):
            return pieces
    return [b | {"color": verified(part, color)}]


class Kit:
    """Collects bricks into validated steps of the build `id`, replacing any earlier version in the library."""

    def __init__(self, id: str, name: str, prompt: str):
        self.store = Store()
        self.workspace = Workspace(Build(id=id, name=name, prompt=prompt, builder="claude", status="done"))
        self.bench = Workbench(self.workspace)
        self.pending: list[dict] = []
        self.mounted: list[Placement] = []
        self.problems: list[str] = []
        self.offset = (0, 0)

    def add(self, part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> None:
        self.pending.append(shapes.brick(part, x, y, z, color, rotation))

    def centered(self, part: str, x: int, y: int, z: int, color: int) -> None:
        """A 1x1 part on the stud at the middle of a 2x2 top, like a finial on a cone; x, y is the 2x2's corner."""
        p = place(ldraw.resolve(part) or part, x, y, z, color)
        self.mounted.append(
            p.model_copy(update={"pos": (p.pos[0] + ldraw.STUD / 2, p.pos[1], p.pos[2] + ldraw.STUD / 2)})
        )

    def mount(self, part: str, x: int, y: int, z: int, color: int, facing: str) -> None:
        """A part hung on the wall behind stud (x, y), its top facing `facing`."""
        self.mounted.append(mount(ldraw.resolve(part) or part, x, y, z, color, facing))

    def step(self, title: str) -> None:
        """Checks the pending bricks as one step, each moved `offset` studs along x and y, in verified colors."""
        if not self.pending and not self.mounted:
            return
        ox, oy = self.offset
        bricks = [b | {"x": b["x"] + ox, "y": b["y"] + oy} for a in self.pending for b in orderable(a)]
        mounted = [
            p.model_copy(
                update={
                    "pos": (p.pos[0] + ox * ldraw.STUD, p.pos[1], p.pos[2] + oy * ldraw.STUD),
                    "color": verified(p.part, p.color),
                }
            )
            for p in self.mounted
        ]
        result = self.bench.add(title, bricks, mounted)
        if result.problems:
            self.problems.append(f"[{title}] {result.text}")
        self.pending, self.mounted = [], []

    @property
    def build(self) -> Build:
        return self.workspace.build

    def save(self, story: list[str]) -> Build:
        self.build.messages = [
            Message(role="user", text=self.build.prompt),
            *(Message(role="assistant", text=s) for s in story),
        ]
        self.store.save(self.build)
        return self.build

    def run(self, x: int, y: int, z: int, length: int, color: int, axis: str = "x", kind=BRICK_RUN, stagger=False):
        self.pending += shapes.run(x, y, z, length, color, axis, kind, stagger)

    def ring(self, x0, y0, w, d, z, courses, color, openings=lambda x, y, c: False, kind=BRICK_RUN, height=3, start=0):
        """Bonded rectangular walls from course `start`; returns the top z."""
        self.pending += shapes.ring(x0, y0, w, d, z, courses, color, openings, kind, height, start)
        return z + courses * height

    def cover(self, cells: Iterable[Cell], z: int, color, sizes=PLATES) -> None:
        self.pending += shapes.cover(cells, z, color, sizes)

    def fill(self, x0, y0, w, d, z, color, sizes=PLATES, skip: Iterable[Cell] = ()) -> None:
        self.cover(rect(x0, y0, w, d) - set(skip), z, color, sizes)

    def scatter(self, cells: Iterable[Cell], z: int, palette, rng: random.Random, sizes=MOSAIC["tile"]) -> None:
        self.pending += shapes.scatter(cells, z, palette, rng, sizes)

    def mosaic(self, x0, y0, w, d, z, palette, rng, skip: Iterable[Cell] = (), **kwargs) -> None:
        self.scatter(rect(x0, y0, w, d) - set(skip), z, palette, rng, **kwargs)

    def ridge(self, x: int, y: int, w: int, d: int, z: int, color: int) -> None:
        self.pending += shapes.ridge(x, y, w, d, z, color)

    def hip(self, x0: int, y0: int, w: int, d: int, z: int, color: int, slope="3040b", rise=3, core=BRICKS):
        """Rings of 1x2 slopes stepping in one stud per ring; returns the (x, y, w, d, z) left on top."""
        bricks, top = shapes.hip(x0, y0, w, d, z, color, slope, rise, core)
        self.pending += bricks
        return top


class Frame:
    """Local facade coordinates: u runs along the facade, v goes into the building, the facade faces `facing`."""

    def __init__(self, kit: Kit, x0: int, y0: int, length: int, depth: int, facing: str):
        self.kit, self.x0, self.y0, self.length, self.depth, self.facing = kit, x0, y0, length, depth, facing
        self.turn = FACINGS[facing]

    @property
    def rect(self) -> tuple[int, int, int, int]:
        """World (x0, y0, w, d) of the footprint."""
        if self.facing in ("south", "north"):
            return self.x0, self.y0, self.length, self.depth
        return self.x0, self.y0, self.depth, self.length

    def area(self, u: int, v: int, length: int, depth: int) -> tuple[int, int, int, int]:
        """World (x0, y0, w, d) of a local rectangle."""
        x, y = self.world(u, v, length, depth)
        return (x, y, length, depth) if self.facing in ("south", "north") else (x, y, depth, length)

    def cell(self, u: int, v: int) -> Cell:
        return self.world(u, v, 1, 1)

    def world(self, u: int, v: int, w: int, d: int) -> Cell:
        L, D = self.length, self.depth
        return {
            "south": (self.x0 + u, self.y0 + v),
            "north": (self.x0 + L - u - w, self.y0 + D - v - d),
            "west": (self.x0 + v, self.y0 + L - u - w),
            "east": (self.x0 + D - v - d, self.y0 + u),
        }[self.facing]

    def put(self, part: str, u: int, v: int, z: int, color: int, rotation: int = 0) -> None:
        w, d = footprint(part, rotation)
        x, y = self.world(u, v, w, d)
        self.kit.add(part, x, y, z, color, rotation + self.turn)

    def run(self, u: int, v: int, z: int, length: int, color: int, kind=BRICK_RUN, stagger=False) -> None:
        at = 0
        for n in split(length, kind, stagger):
            self.put(kind[n], u + at, v, z, color)
            at += n
