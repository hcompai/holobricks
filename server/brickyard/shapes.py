"""Expand high-level shapes (bonded walls, greedy fills, mosaics, hipped roofs) into grid bricks."""

from __future__ import annotations

import random
from collections.abc import Callable, Iterable

from brickyard import ldraw

Cell = tuple[int, int]
Brick = dict

BRICK_RUN = {8: "3008", 6: "3009", 4: "3010", 3: "3622", 2: "3004", 1: "3005"}
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
MOSAIC = {
    "tile": ((2, 2, "3068b"), (2, 1, "3069b"), (1, 1, "3070b"), (4, 1, "2431")),
    "plate": ((2, 2, "3022"), (2, 1, "3023b"), (1, 1, "3024"), (4, 1, "3710")),
    "brick": ((2, 2, "3003"), (2, 1, "3004"), (1, 1, "3005"), (4, 1, "3010")),
}
SIZES = {"plate": PLATES, "tile": TILES, "brick": BRICKS}
HEIGHTS = {"plate": 1, "tile": 1, "brick": 3}


def brick(part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> Brick:
    return {"part": part, "x": x, "y": y, "z": z, "color": color, "rotation": rotation % 360}


def rect(x0: int, y0: int, w: int, d: int) -> set[Cell]:
    return {(x, y) for x in range(x0, x0 + w) for y in range(y0, y0 + d)}


def footprint(part: str, rotation: int) -> tuple[int, int]:
    w, d = ldraw.info(ldraw.resolve(part) or part).footprint
    return (d, w) if rotation in (90, 270) else (w, d)


def split(n: int, run: dict[int, str], stagger: bool) -> list[int]:
    """Lengths covering n studs from the sizes in `run`; staggered runs start short so joints alternate."""
    sizes = sorted(run, reverse=True)
    out = [2] if stagger and n > 2 and 2 in run else []
    left = n - sum(out)
    while left:
        out.append(next(s for s in sizes if s <= left))
        left -= out[-1]
    return out


def run(x: int, y: int, z: int, length: int, color: int, axis: str = "x", kind=BRICK_RUN, stagger=False) -> list[Brick]:
    """A 1-stud-wide line of bricks, plates or tiles along x or y."""
    out, at = [], 0
    for n in split(length, kind, stagger):
        out.append(brick(kind[n], x + at, y, z, color) if axis == "x" else brick(kind[n], x, y + at, z, color, 90))
        at += n
    return out


def ring(
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
) -> list[Brick]:
    """Bonded rectangular walls from course `start`; `color` and `openings` get (x, y, course)."""
    x1, y1 = x0 + w - 1, y0 + d - 1
    out = []
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
                out += run(*group[0], zc, len(group), shade(*group[0]), axis, kind, stagger=not even)
    return out


def cover(cells: Iterable[Cell], z: int, color: int | Callable[[int, int], int], sizes=PLATES) -> list[Brick]:
    """Cover cells greedily with the largest parts that fit."""
    free, out = set(cells), []
    for x, y in sorted(free, key=lambda cell: (cell[1], cell[0])):
        if (x, y) not in free:
            continue
        for pw, pd, part in sizes:
            for rw, rd, rotation in ((pw, pd, 0), (pd, pw, 90)):
                spot = rect(x, y, rw, rd)
                if spot <= free:
                    free -= spot
                    out.append(brick(part, x, y, z, color(x, y) if callable(color) else color, rotation))
                    break
            else:
                continue
            break
    return out


def scatter(
    cells: Iterable[Cell], z: int, palette: list[tuple[int, int]], rng: random.Random, sizes=MOSAIC["tile"]
) -> list[Brick]:
    """Random paving of cells with parts of random sizes, colors drawn from (color, weight) pairs."""
    colors, weights = zip(*palette, strict=True)
    free, out = set(cells), []
    single = next(part for w, d, part in sizes if w == d == 1)
    for x, y in sorted(free, key=lambda cell: (cell[1], cell[0])):
        if (x, y) not in free:
            continue
        options = list(sizes)
        rng.shuffle(options)
        for pw, pd, part in [*options, (1, 1, single)]:
            rw, rd, rotation = (pw, pd, 0) if rng.random() < 0.5 else (pd, pw, 90)
            spot = rect(x, y, rw, rd)
            if spot <= free:
                free -= spot
                out.append(brick(part, x, y, z, rng.choices(colors, weights)[0], rotation))
                break
    return out


def ridge(x: int, y: int, w: int, d: int, z: int, color: int) -> list[Brick]:
    """Ridge slopes along the long side of a 2-wide roof top."""
    if d == 2:
        return [brick("3044b", x + i, y, z, color) for i in range(w)]
    return [brick("3044b", x, y + j, z, color, 90) for j in range(d)]


def hip(
    x0: int, y0: int, w: int, d: int, z: int, color: int, slope="3040b", rise=3, core=BRICKS
) -> tuple[list[Brick], tuple[int, int, int, int, int]]:
    """Rings of 1x2 slopes stepping in one stud per ring; also returns the (x, y, w, d, z) left on top."""
    out = []
    while w > 2 and d > 2:
        for x in range(x0, x0 + w):
            out += [brick(slope, x, y0, z, color, 0), brick(slope, x, y0 + d - 2, z, color, 180)]
        for y in range(y0 + 2, y0 + d - 2):
            out += [brick(slope, x0, y, z, color, 90), brick(slope, x0 + w - 2, y, z, color, 270)]
        if w > 4 and d > 4:
            for c in range(rise // 3):
                out += cover(rect(x0 + 2, y0 + 2, w - 4, d - 4), z + 3 * c, color, core)
        x0, y0, w, d, z = x0 + 1, y0 + 1, w - 2, d - 2, z + rise
    return out, (x0, y0, w, d, z)


def roof(x0: int, y0: int, w: int, d: int, z: int, color: int, steep: bool = False) -> tuple[list[Brick], int]:
    """A hipped roof on an even-sided rectangle, with a ridge or, when steep and square, a point; also returns its top z."""
    slope, rise = ("4460b", 9) if steep else ("3040b", 3)
    out, (x, y, rw, rd, top) = hip(x0, y0, w, d, z, color, slope, rise)
    if steep and rw == rd == 2:
        return [*out, brick("3688", x, y, top, color)], top + 6
    return out + ridge(x, y, rw, rd, top, color), top + 3


def support(plates: list[Brick], z: int, solid: set[Cell], column: list[tuple[str, int]], color: int) -> list[Brick]:
    """Hidden columns of (part, plates) ending at `z`, under each plate that misses the `solid` cells."""
    out = []
    for plate in plates:
        w, d = footprint(plate["part"], plate["rotation"])
        spot = rect(plate["x"], plate["y"], w, d)
        if not spot & solid:
            x, y = min(spot)
            at = z - sum(h for _, h in column)
            for part, h in column:
                out.append(brick(part, x, y, at, color))
                at += h
    return out


def _groups(cells: list[Cell], axis: str, shade: Callable[[int, int], int]) -> list[list[Cell]]:
    k = 0 if axis == "x" else 1
    out: list[list[Cell]] = []
    for cell in cells:
        if out and out[-1][-1][k] + 1 == cell[k] and shade(*out[-1][-1]) == shade(*cell):
            out[-1].append(cell)
        else:
            out.append([cell])
    return out
