"""Toolkit for hand-scripted showcase builds: facade frames, bonded walls, fills, roofs; every step is validated."""

from __future__ import annotations

import random
from collections.abc import Callable, Iterable

from brickyard import ldraw
from brickyard.model import Build, Message, Placement, mount
from brickyard.session import Session, Store
from brickyard.workbench import Workbench

Cell = tuple[int, int]

BRICK_RUN = {8: "3008", 6: "3009", 4: "3010", 3: "3622", 2: "3004", 1: "3005"}
PLATE_RUN = {8: "3460", 6: "3666", 4: "3710", 3: "3623", 2: "3023b", 1: "3024"}
TILE_RUN = {8: "4162", 6: "6636", 4: "2431", 2: "3069b", 1: "3070b"}
PLATES = [
    (16, 8, "92438"),
    (12, 6, "3028"),
    (10, 6, "3033"),
    (8, 6, "3036"),
    (8, 4, "3035"),
    (6, 4, "3032"),
    (4, 4, "3031"),
    (8, 2, "3034"),
    (6, 2, "3795"),
    (4, 2, "3020"),
    (3, 2, "3021"),
    (2, 2, "3022"),
    (8, 1, "3460"),
    (6, 1, "3666"),
    (4, 1, "3710"),
    (3, 1, "3623"),
    (2, 1, "3023b"),
    (1, 1, "3024"),
]
TILES = [
    (4, 2, "87079"),
    (2, 2, "3068b"),
    (8, 1, "4162"),
    (6, 1, "6636"),
    (4, 1, "2431"),
    (2, 1, "3069b"),
    (1, 1, "3070b"),
]
BRICKS = [
    (8, 2, "3007"),
    (6, 2, "2456"),
    (4, 2, "3001"),
    (3, 2, "3002"),
    (2, 2, "3003"),
    (8, 1, "3008"),
    (6, 1, "3009"),
    (4, 1, "3010"),
    (3, 1, "3622"),
    (2, 1, "3004"),
    (1, 1, "3005"),
]
FACINGS = {"south": 0, "west": 90, "north": 180, "east": 270}


def split(n: int, run: dict[int, str], stagger: bool) -> list[int]:
    """Lengths covering n studs from the sizes in `run`; staggered runs start short so joints alternate."""
    sizes = sorted(run, reverse=True)
    out = [2] if stagger and n > 2 and 2 in run else []
    left = n - sum(out)
    while left:
        out.append(next(s for s in sizes if s <= left))
        left -= out[-1]
    return out


def footprint(part: str, rotation: int) -> tuple[int, int]:
    w, d = ldraw.info(ldraw.resolve(part) or part).footprint
    return (d, w) if rotation in (90, 270) else (w, d)


class Kit:
    """Collects bricks into validated steps of a new build, then saves it to the library."""

    def __init__(self, name: str, prompt: str, width: int, depth: int):
        self.build = Build(name=name, prompt=prompt, builder="claude", width=width, depth=depth, status="done")
        self.session = Session(self.build, Store())
        self.bench = Workbench(self.session)
        self.pending: list[dict] = []
        self.mounted: list[Placement] = []
        self.problems: list[str] = []

    def add(self, part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> None:
        self.pending.append({"part": part, "x": x, "y": y, "z": z, "color": color, "rotation": rotation % 360})

    def mount(self, part: str, x: int, y: int, z: int, color: int, facing: str) -> None:
        """A part hung on the wall behind stud (x, y), its top facing `facing`."""
        self.mounted.append(mount(ldraw.resolve(part) or part, x, y, z, color, facing))

    async def step(self, title: str) -> None:
        if not self.pending and not self.mounted:
            return
        result = await self.bench.add(title, self.pending, self.mounted)
        if "Rejected" in result.text or "check:" in result.text:
            self.problems.append(f"[{title}] {result.text}")
        self.pending, self.mounted = [], []

    def save(self, story: list[str]) -> Build:
        self.build.messages = [
            Message(role="user", text=self.build.prompt),
            *(Message(role="assistant", text=s) for s in story),
        ]
        self.session.store.save(self.build)
        return self.build

    def run(self, x: int, y: int, z: int, length: int, color: int, axis: str = "x", kind=BRICK_RUN, stagger=False):
        """A 1-stud-wide line of bricks, plates or tiles along x or y."""
        at = 0
        for n in split(length, kind, stagger):
            if axis == "x":
                self.add(kind[n], x + at, y, z, color)
            else:
                self.add(kind[n], x, y + at, z, color, 90)
            at += n

    def ring(
        self,
        x0: int,
        y0: int,
        w: int,
        d: int,
        z: int,
        courses: int,
        color: int | Callable[[int, int, int], int],
        openings: Callable[[int, int, int], bool] = lambda x, y, c: False,
        kind=BRICK_RUN,
        height: int = 3,
        start: int = 0,
    ) -> int:
        """Bonded rectangular walls from course `start`; returns the top z. `color` and `openings` get (x, y, course)."""
        x1, y1 = x0 + w - 1, y0 + d - 1
        for c in range(start, start + courses):
            zc = z + (c - start) * height
            even = c % 2 == 0
            segments = [("x", y, range(x0, x1 + 1) if even else range(x0 + 1, x1)) for y in (y0, y1)] + [
                ("y", x, range(y0 + 1, y1) if even else range(y0, y1 + 1)) for x in (x0, x1)
            ]
            for axis, fixed, span in segments:
                cells = [(s, fixed) if axis == "x" else (fixed, s) for s in span]
                cells = [cell for cell in cells if not openings(cell[0], cell[1], c)]
                shade = (lambda x, y, c=c: color(x, y, c)) if callable(color) else (lambda x, y: color)
                for group in _groups(cells, axis, shade):
                    self.run(*group[0], zc, len(group), shade(*group[0]), axis, kind, stagger=not even)
        return z + courses * height

    def cover(self, cells: Iterable[Cell], z: int, color: int | Callable[[int, int], int], sizes=PLATES) -> None:
        """Cover cells greedily with the largest parts that fit."""
        free = set(cells)
        for x, y in sorted(free, key=lambda cell: (cell[1], cell[0])):
            if (x, y) not in free:
                continue
            for pw, pd, part in sizes:
                for rw, rd, rotation in ((pw, pd, 0), (pd, pw, 90)):
                    spot = {(x + i, y + j) for i in range(rw) for j in range(rd)}
                    if spot <= free:
                        free -= spot
                        self.add(part, x, y, z, color(x, y) if callable(color) else color, rotation)
                        break
                else:
                    continue
                break

    def fill(self, x0, y0, w, d, z, color, sizes=PLATES, skip: Iterable[Cell] = ()) -> None:
        """Cover a rectangle greedily, around `skip` cells."""
        self.cover(rect(x0, y0, w, d) - set(skip), z, color, sizes)

    def scatter(
        self,
        cells: Iterable[Cell],
        z: int,
        palette: list[tuple[int, int]],
        rng: random.Random,
        sizes=((2, 2, "3068b"), (2, 1, "3069b"), (1, 1, "3070b"), (4, 1, "2431")),
    ) -> None:
        """Random paving of cells with parts of random sizes, colors drawn from (color, weight) pairs."""
        colors, weights = zip(*palette, strict=True)
        free = set(cells)
        single = next(part for w, d, part in sizes if w == d == 1)
        for x, y in sorted(free, key=lambda cell: (cell[1], cell[0])):
            if (x, y) not in free:
                continue
            options = list(sizes)
            rng.shuffle(options)
            for pw, pd, part in [*options, (1, 1, single)]:
                rw, rd, rotation = (pw, pd, 0) if rng.random() < 0.5 else (pd, pw, 90)
                spot = {(x + i, y + j) for i in range(rw) for j in range(rd)}
                if spot <= free:
                    free -= spot
                    self.add(part, x, y, z, rng.choices(colors, weights)[0], rotation)
                    break

    def mosaic(self, x0, y0, w, d, z, palette, rng, skip: Iterable[Cell] = (), **kwargs) -> None:
        """Random paving of a rectangle, around `skip` cells."""
        self.scatter(rect(x0, y0, w, d) - set(skip), z, palette, rng, **kwargs)

    def support(self, z: int, solid: set[Cell], column: list[tuple[str, int]], color: int) -> list[dict]:
        """Takes the pending plates at height `z`; props up with a hidden `column` of (part, plates) each one missing `solid`."""
        plates, self.pending = self.pending, []
        for plate in plates:
            w, d = footprint(plate["part"], plate["rotation"])
            spot = rect(plate["x"], plate["y"], w, d)
            if not spot & solid:
                x, y = min(spot)
                at = z - sum(h for _, h in column)
                for part, h in column:
                    self.add(part, x, y, at, color)
                    at += h
        return plates

    def ridge(self, x: int, y: int, w: int, d: int, z: int, color: int) -> None:
        """Ridge slopes along the long side of a 2-wide roof top."""
        if d == 2:
            for i in range(w):
                self.add("3044b", x + i, y, z, color)
        else:
            for j in range(d):
                self.add("3044b", x, y + j, z, color, 90)

    def hip(self, x0: int, y0: int, w: int, d: int, z: int, color: int, slope="3040b", rise=3, core=BRICKS):
        """Rings of 1x2 slopes stepping in one stud per ring; returns the (x, y, w, d, z) left on top."""
        while w > 2 and d > 2:
            for x in range(x0, x0 + w):
                self.add(slope, x, y0, z, color, 0)
                self.add(slope, x, y0 + d - 2, z, color, 180)
            for y in range(y0 + 2, y0 + d - 2):
                self.add(slope, x0, y, z, color, 90)
                self.add(slope, x0 + w - 2, y, z, color, 270)
            if w > 4 and d > 4:
                for c in range(rise // 3):
                    self.fill(x0 + 2, y0 + 2, w - 4, d - 4, z + 3 * c, color, core)
            x0, y0, w, d, z = x0 + 1, y0 + 1, w - 2, d - 2, z + rise
        return x0, y0, w, d, z


def rect(x0: int, y0: int, w: int, d: int) -> set[Cell]:
    return {(x, y) for x in range(x0, x0 + w) for y in range(y0, y0 + d)}


def _groups(cells: list[Cell], axis: str, shade: Callable[[int, int], int]) -> list[list[Cell]]:
    k = 0 if axis == "x" else 1
    out: list[list[Cell]] = []
    for cell in cells:
        if out and out[-1][-1][k] + 1 == cell[k] and shade(*out[-1][-1]) == shade(*cell):
            out[-1].append(cell)
        else:
            out.append([cell])
    return out


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
