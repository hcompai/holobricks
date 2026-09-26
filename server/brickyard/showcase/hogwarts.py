"""Hogwarts' south front above the Black Lake, the first film's arrival shot, after Stuart Craig's design and LEGO 71043."""

from __future__ import annotations

import math
import random
from collections import Counter
from collections.abc import Callable

from brickyard.shapes import brick, rect
from brickyard.showcase.kit import Kit
from brickyard.showcase.sculpt import Sculpture, circle, erode

W, D = 152, 92
BLACK, TAN, DTAN, LBG, DBG, GOLD, LIT = 0, 19, 28, 71, 72, 297, 46
GREEN, DGREEN, OLIVE = 2, 288, 330
DBLUE, TLBLUE, TMBLUE = 272, 43, 41
DBROWN = 308

Cell = tuple[int, int]
PROMPT = (
    "Hogwarts' south front above the Black Lake: the Great Hall on its cliff, the Marble Staircase Tower, the viaduct"
)
STORY = [
    (
        "Hand-scripted by Claude after Stuart Craig's concept art, the film's miniature and LEGO 71043, as a showcase "
        "of what Brickyard's parts and checks can do. The castle is sculpted as solids and meshed into bricks: only the "
        "shell is built, steady steps become slopes, and every brick rests on another. Ask for a change and Holo takes over."
    ),
]

S = 2
"""The terrain is sculpted on 2x2-stud cells, so its faces are big facets and not a noise of small bricks."""
PLATEAU = 40
CLIFF = 3.2
"""Courses the crag falls per stud away from the buildings on it."""


def noise(x: float, y: float) -> float:
    """Smooth value in -1..1."""
    return (
        0.5 * math.sin(0.37 * x + 0.11 * y)
        + 0.3 * math.sin(0.53 * y - 0.21 * x + 1.3)
        + 0.2 * math.sin(1.1 * x + 0.7 * y + 2.1)
    )


def terrain(rng: random.Random, pads: dict[Cell, tuple[int, str]]) -> tuple[dict[Cell, int], dict[Cell, str]]:
    """Height in courses and the kind of each 2x2 cell: the castle's pads, crags falling from them, the lake at 0."""
    height, kind = {}, {}
    reach = math.ceil(PLATEAU / CLIFF / S) + 3
    for X in range(W // S):
        for Y in range(D // S):
            x, y = S * X + 1, S * Y + 1
            wobble = noise(x * 0.18, y * 0.18), noise(x * 0.7, y * 0.7)
            stretch = 1 + 0.35 * noise(X * 0.45 + 7, Y * 0.45) + 0.1 * (rng.random() - 0.5)
            best, name = 0.0, "lake"
            for PX in range(X - reach, X + reach + 1):
                for PY in range(Y - reach, Y + reach + 1):
                    if (PX, PY) not in pads:
                        continue
                    h, what = pads[PX, PY]
                    if what == "footing":
                        continue
                    d = max(0.0, S * math.hypot(X - PX, Y - PY) - 0.6 * (1 + wobble[0]) - 0.8 * wobble[1]) * stretch
                    if h - d * CLIFF > best:
                        best, name = h - d * CLIFF, "crag"
            height[X, Y], kind[X, Y] = max(0, math.floor(best)), name
    for c, (h, name) in pads.items():
        if c in height and (name != "footing" or height[c] < h):
            height[c], kind[c] = h, name
    return height, kind


def pads(sc: Sculpture) -> tuple[dict[Cell, tuple[int, str]], set[Cell]]:
    """Flat ground under every building at its lowest course, one stud wider; also the cells a building stands in.

    Only courses up to the plateau count, so corbelled crowns don't raise rock under them. Footings at the water's
    edge only raise the ground to course 1, so the crag keeps its height where it is higher.
    """
    base: dict[Cell, int] = {}
    for (x, y, k), (_, _, owner) in sc.solid.items():
        if k <= PLATEAU and (owner != "the viaduct" or k <= 1):
            base[x, y] = min(k, base.get((x, y), k))
    own: dict[Cell, int] = {}
    for (x, y), k in base.items():
        own[x // S, y // S] = min(k, own.get((x // S, y // S), k))
    out = dict(own)
    for (x, y), k in base.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                c = ((x + dx) // S, (y + dy) // S)
                if c not in own:
                    out[c] = min(k, out.get(c, k))
    return {c: (k, "footing" if k <= 1 else "castle") for c, k in out.items()}, set(own)


RUNS = {1: "3003", 2: "3001", 3: "2456", 4: "3007"}
OUTWARD = [((0, -1), 0), ((-1, 0), 90), ((1, 0), 270), ((0, 1), 180)]
BEVELS = {3: "3684c", 2: "3678b", 1: "3039"}
CORNERS = {3: "3685", 2: "3688", 1: "3045"}
CORNER_TURNS = {((0, -1), (1, 0)): 0, ((-1, 0), (0, -1)): 90, ((0, 1), (-1, 0)): 180, ((1, 0), (0, 1)): 270}


def rock(x: int, y: int, k: int) -> int:
    n = noise(x * 0.25 + k * 0.5, y * 0.25 - k * 0.3)
    return DBG if n > -0.15 else DTAN if n < -0.75 else LBG


def earth(x: int, y: int, k: int) -> int:
    return DTAN if noise(x * 0.4, y * 0.4 + k) > -0.3 else DBROWN


def grass(x: int, y: int) -> int:
    n = noise(x * 0.5 + 11, y * 0.5)
    return DGREEN if n > 0.45 else OLIVE if n < -0.6 else GREEN


class Ground:
    """The terrain meshed into bricks: exposed faces only, step edges bevelled, hidden columns under the top plates."""

    def __init__(self, kit: Kit, rng: random.Random, pads: dict[Cell, tuple[int, str]], footing: set[Cell]):
        self.kit, self.rng, self.footing = kit, rng, footing
        self.height, self.kind = terrain(rng, pads)
        self.claimed: set[tuple[int, int, int]] = set()

    def course(self, x: int, y: int) -> int:
        """The course a building starts on at stud (x, y)."""
        return self.height.get((x // S, y // S), 0)

    def studs(self, X: int, Y: int) -> set[Cell]:
        return rect(S * X, S * Y, S, S)

    def solid(self, X: int, Y: int, k: int) -> bool:
        return (X, Y) in self.height and k < self.height[X, Y]

    def grassy(self, c: Cell) -> bool:
        return False

    def exposed(self, X: int, Y: int, k: int) -> bool:
        """A cell's course seen from outside, so built as bricks; the ones inside stay hollow."""
        return (
            self.solid(X, Y, k)
            and (X, Y, k) not in self.claimed
            and any(not self.solid(X + dx, Y + dy, k) for (dx, dy), _ in OUTWARD if (X + dx, Y + dy) in self.height)
        )

    async def lake(self) -> None:
        self.kit.fill(0, 0, W, D, 0, DBLUE)
        await self.kit.step("The bed of the Black Lake")
        water = {s for c, h in self.height.items() if h == 0 for s in self.studs(*c)}
        self.kit.scatter(water, 1, [(TMBLUE, 14), (TLBLUE, 1)], self.rng, WATER)
        await self.kit.step("The Black Lake")

    def bevels(self) -> list[tuple[str, int, int, int, int, int]]:
        out = []
        for (X, Y), h in sorted(self.height.items()):
            if h == 0 or self.kind[X, Y] == "footing" or (X, Y) in self.footing:
                continue
            drops = {
                d: h - self.height[X + d[0], Y + d[1]]
                for d, _ in OUTWARD
                if (X + d[0], Y + d[1]) in self.height and self.height[X + d[0], Y + d[1]] < h
            }
            if not drops:
                continue
            corner = next(((pair, turn) for pair, turn in CORNER_TURNS.items() if all(d in drops for d in pair)), None)
            if corner:
                size = min(min(drops[d] for d in corner[0]), 3, h)
                part, rotation = CORNERS[size], corner[1]
            else:
                d, drop = max(drops.items(), key=lambda item: item[1])
                size = min(drop, 3, h)
                if size == 3 and self.rng.random() < 0.3:
                    size = 2
                part, rotation = BEVELS[size], dict(OUTWARD)[d]
            self.claimed.update((X, Y, k) for k in range(h - size, h))
            color = grass(X, Y) if self.grassy((X, Y)) else OLIVE if self.rng.random() < 0.1 else rock(X, Y, h - 1)
            out.append((part, S * X, S * Y, 1 + 3 * (h - size), color, rotation))
        return out

    async def mesh(self) -> None:
        bevels = self.bevels()
        for (X, Y), h in self.height.items():
            low = next((k for k in range(h) if (X, Y, k) in self.claimed or self.exposed(X, Y, k)), 0)
            self.kit.pending += _column(S * X, S * Y, 1, 1 + 3 * low)
        await self.kit.step("Hidden columns under the rock faces")
        top = max(self.height.values())
        for k0 in range(0, top, 4):
            for k in range(k0, min(k0 + 4, top)):
                groups: dict[int, set[Cell]] = {}
                for X, Y in self.height:
                    if self.exposed(X, Y, k):
                        color = (earth if self.grassy((X, Y)) else rock)(X, Y, k)
                        groups.setdefault(color, set()).add((X, Y))
                for color, group in groups.items():
                    self.blocks(group, 1 + 3 * k, color)
            await self.kit.step(f"The crag, courses {k0 + 1} to {min(k0 + 4, top)}")
        for part, x, y, z, color, rotation in bevels:
            self.kit.add(part, x, y, z, color, rotation)
        await self.kit.step("Crags: the angled faces of the rock")

    def blocks(self, cells: set[Cell], z: int, color: int) -> None:
        """2-stud-wide bricks over whole cells, runs of 1 to 4 cells along x or y."""
        free = set(cells)
        for X, Y in sorted(cells, key=lambda c: (c[1], c[0])):
            if (X, Y) not in free:
                continue
            axis, target, n = self.rng.choice(((1, 0), (0, 1))), self.rng.choice((1, 2, 3, 4, 4)), 1
            while n < target and (X + axis[0] * n, Y + axis[1] * n) in free:
                n += 1
            free -= {(X + axis[0] * i, Y + axis[1] * i) for i in range(n)}
            self.kit.add(RUNS[n], S * X, S * Y, z, color, 0 if n == 1 or axis == (1, 0) else 90)

    def hollow_tops(self) -> set[Cell]:
        return {
            (X, Y)
            for (X, Y), h in self.height.items()
            if h > 0 and (X, Y, h - 1) not in self.claimed and not self.exposed(X, Y, h - 1)
        }

    async def surface(self, paved: dict[str, Callable[[int, int], int]]) -> None:
        """Top plates flush with the rock over the hollow cells, each held by a hidden column."""
        groups: dict[tuple[str, int], set[Cell]] = {}
        for X, Y in self.hollow_tops():
            groups.setdefault((self.kind[X, Y], self.height[X, Y]), set()).update(self.studs(X, Y))
        columns = []
        for (kind, h), cells in sorted(groups.items()):
            before = len(self.kit.pending)
            self.kit.cover(cells, 3 * h, paved.get(kind, grass))
            for plate in self.kit.pending[before:]:
                x, y = plate["x"], plate["y"]
                built = [k for k in range(h) if (x // S, y // S, k) in self.claimed or self.exposed(x // S, y // S, k)]
                columns += _column(x, y, 1 + 3 * (max(built) + 1) if built else 1, 3 * h)
        plates, self.kit.pending = self.kit.pending, columns
        await self.kit.step("Hidden columns under the ground")
        self.kit.pending = plates
        await self.kit.step("The tops of the crag and the grounds")


WATER = ((4, 2, "3020"), (2, 2, "3022"), (4, 4, "3031"), (6, 2, "3795"), (2, 1, "3023b"), (1, 1, "3024"))
COLUMN = [(15, "2453b"), (9, "14716"), (3, "3005"), (1, "3024")]


def _column(x: int, y: int, z0: int, z1: int, color: int = DBG) -> list[dict]:
    """1x1 bricks and plates from plate z0 up to z1."""
    out, z = [], z0
    for h, part in COLUMN:
        while z1 - z >= h:
            out.append(brick(part, x, y, z, color))
            z += h
    return out


Finials = list[tuple[int, int, int]]
"""The 2x2 tops, as (x, y, course above), that get a cone and a gold spike."""


def windows(r: float, n: int, rows: list[int], tall: int = 2) -> Callable[[float, int], int | None]:
    """Window colors on a round wall of radius r: n per row, each 1 stud wide and `tall` courses, mostly lit."""
    step = 2 * math.pi / n

    def color(a: float, k: int) -> int | None:
        i = round(a / step)
        if abs(a - i * step) * r > 0.6:
            return None
        for row, k0 in enumerate(rows):
            if k0 <= k < k0 + tall:
                return BLACK if (3 * i + row) % 4 == 0 else LIT
        return None

    return color


def round_wall(cx: float, cy: float, bands: set[int], window: Callable[[float, int], int | None]):
    def color(x: int, y: int, k: int) -> int:
        if k in bands:
            return DTAN
        return window(math.atan2(y + 0.5 - cy, x + 0.5 - cx), k) or TAN

    return color


def slate(cx: float, cy: float, k0: int, dormers: int = 0) -> Callable[[int, int, int], int]:
    """Dark grey slate, with rows of small black dormer windows every 8 courses."""
    step = 2 * math.pi / max(dormers, 1)

    def color(x: int, y: int, k: int) -> int:
        if dormers and (k - k0) % 8 == 5:
            a = math.atan2(y + 0.5 - cy, x + 0.5 - cx) + ((k - k0) // 8) * step / 2
            if abs(a - round(a / step) * step) < 0.08:
                return BLACK
        return DBG

    return color


def spire(sc: Sculpture, cx: int, cy: int, r: float, k0: int, height: int, finials: Finials, dormers: int = 0) -> None:
    """A slate cone on a round tower centered on a stud corner, and its finial."""
    top = sc.cone(cx, cy, r, k0, height, slate(cx, cy, k0, dormers))
    finials.append((cx - 1, cy - 1, top))


def round_tower(
    sc: Sculpture, cx: int, cy: int, r: float, k0: int, k1: int, cone: int, finials: Finials, rows: int = 4
) -> None:
    """A round stone tower with bands, windows, a corbelled crown and a slate spire `cone` courses tall."""
    bands = {k0, k0 + 1, *range(k0 + 10, k1 - 4, 12)}
    sc.fill(circle(cx, cy, r), k0, k1 - 2, round_wall(cx, cy, bands, windows(r, 8, list(range(k0 + 5, k1 - 6, 6)))))
    sc.fill(circle(cx, cy, r + 0.5), k1 - 2, k1, DTAN)
    spire(sc, cx, cy, r + 0.5, k1, cone, finials)


def gable_roof(sc: Sculpture, x0: int, y0: int, w: int, d: int, k0: int, ridge: str, pitch: int = 2) -> int:
    """A steep slate roof with tan crow-stepped gables at both ends of its ridge; returns the course above it."""
    cells, k = rect(x0, y0, w, d), k0
    ends = {x0, x0 + w - 1} if ridge == "x" else {y0, y0 + d - 1}
    while cells:
        gable = {c for c in cells if (c[0] if ridge == "x" else c[1]) in ends}
        sc.fill(cells - gable, k, k + pitch, DBG, sloped=True)
        sc.fill(gable, k, k + pitch + 1, TAN)
        cells, k = erode(cells, ridge), k + pitch
    return k + 1


def pinnacle(sc: Sculpture, x: int, y: int, k: int, rounds: int = 3) -> None:
    for i in range(rounds):
        sc.part("3062b", x, y, k + i, TAN)
    sc.part("4589", x, y, k + rounds, DBG)


def great_hall(sc: Sculpture, finials: Finials) -> None:
    """41x14 on the cliff edge: ten bays of tall lit lancets between buttresses, pinnacles above a steep gabled roof."""
    sc.owner = "the Great Hall"
    x0, y0, w, d = 24, 32, 41, 14
    x1, y1, top = x0 + w - 1, y0 + d - 1, PLATEAU + 26

    def color(x: int, y: int, k: int) -> int:
        if k < PLATEAU + 2 or k in (PLATEAU + 13, top - 1):
            return DTAN
        if y in (y0, y1) and (x - x0) % 4 in (1, 2) and PLATEAU + 4 <= k <= PLATEAU + 21:
            return LIT
        if x in (x0, x1) and 4 <= y - y0 <= 9 and PLATEAU + 5 <= k <= PLATEAU + 22 and (y - y0) not in (6, 7):
            return LIT
        return TAN

    sc.fill(rect(x0, y0, w, d), PLATEAU, top, color)
    for x in range(x0 + 4, x1 + 1, 4):
        for y, outer, turn in ((y0 - 1, y0 - 2, 0), (y1 + 1, y1 + 1, 180)):
            sc.fill([(x, y0 - 2 if turn == 0 else y1 + 2)], PLATEAU, PLATEAU + 17, stone({PLATEAU, PLATEAU + 13}))
            sc.part("3040b", x, outer, PLATEAU + 17, TAN, turn)
            sc.fill([(x, y)], PLATEAU, top, stone({PLATEAU, PLATEAU + 13, top - 1}))
            pinnacle(sc, x, y, top)
    gable_roof(sc, x0, y0, w, d, top, ridge="x")
    ridge_y = y0 + d // 2 - 1
    for x in (x0 + 12, x1 - 13):
        for i in range(5):
            sc.part("3941", x, ridge_y, top + 14 + i, TAN if i < 4 else DTAN)
        sc.part("3942c", x, ridge_y, top + 19, DBG)
        finials.append((x, ridge_y, top + 21))
    sc.owner = "the Great Hall's corner turret"
    for i in range(46):
        sc.part("87081", x0 - 2, y0 - 2, PLATEAU + i, DTAN if i % 9 == 0 else TAN)
    sc.part("272", x0 - 2, y0 - 2, PLATEAU + 46, DBG)
    sc.part("3942c", x0 - 1, y0 - 1, PLATEAU + 49, DBG)
    finials.append((x0 - 1, y0 - 1, PLATEAU + 51))
    sc.owner = "the terrace"
    edge = rect(x0 - 6, y0 - 2, 6, d + 4) - rect(x0 - 5, y0 - 1, 5, d + 2)
    sc.fill(edge, PLATEAU, PLATEAU + 1, DTAN)
    sc.fill({(x, y) for x, y in edge if (x + y) % 2 == 0}, PLATEAU + 1, PLATEAU + 2, TAN)


def stone(bands: set[int]) -> Callable[[int, int, int], int]:
    return lambda x, y, k: DTAN if k in bands else TAN


def block(sc: Sculpture, x0: int, y0: int, w: int, d: int, courses: int, every: int = 3, skip: set[Cell] = frozenset()):
    """A tan wing with rows of small windows every `every` studs, under a hipped slate roof."""
    top = PLATEAU + courses
    rows = range(PLATEAU + 4, top - 3, 5)

    def color(x: int, y: int, k: int) -> int:
        if k < PLATEAU + 1 or k == top - 1:
            return DTAN
        u = x - x0 if y in (y0, y0 + d - 1) else y - y0
        if u % every == every // 2 and any(r <= k < r + 2 for r in rows):
            return LIT if (u + k) % 3 else BLACK
        return TAN

    cells = rect(x0, y0, w, d) - skip
    sc.fill(cells, PLATEAU, top, color)
    sc.roof(cells, top, DBG)


def entrance(sc: Sculpture) -> None:
    """The block in front of the great tower: two tall lancets under a crow-stepped gable facing the lake."""
    sc.owner = "the Entrance Hall"
    x0, y0, w, d = 65, 30, 16, 16
    top = PLATEAU + 20

    def color(x: int, y: int, k: int) -> int:
        if k < PLATEAU + 2 or k == top - 1:
            return DTAN
        if y == y0:
            for a in (x0 + 2, x0 + 11):
                if a <= x <= a + 2 and PLATEAU + 4 <= k <= PLATEAU + 15 or x == a + 1 and k == PLATEAU + 16:
                    return LIT
        if x in (x0, x0 + w - 1) and (y - y0) % 4 == 2 and (y - y0) < 12 and PLATEAU + 6 <= k <= PLATEAU + 12:
            return LIT
        return TAN

    sc.fill(rect(x0, y0, w, d), PLATEAU, top, color)
    gable_roof(sc, x0, y0, w, d, top, ridge="y")


def staircase_tower(sc: Sculpture, finials: Finials) -> None:
    """The Marble Staircase Tower: 24 studs across, a corbelled crown, a spire twice as tall with Dumbledore's turrets."""
    sc.owner = "the Marble Staircase Tower"
    cx, cy, r = 76, 54, 12
    crown = PLATEAU + 48
    bands = {PLATEAU, PLATEAU + 1, PLATEAU + 18, PLATEAU + 34}
    rows = list(range(PLATEAU + 5, crown - 2, 7))
    sc.fill(circle(cx, cy, r), PLATEAU, crown, round_wall(cx, cy, bands, windows(r, 14, rows)))
    sc.fill(circle(cx, cy, r + 0.5), crown, crown + 1, DTAN)
    sc.fill(circle(cx, cy, r + 1), crown + 1, crown + 4, DTAN)
    ring = circle(cx, cy, r + 1) - circle(cx, cy, r + 0.5)
    sc.fill({(x, y) for x, y in ring if (x + y) % 2 == 0}, crown + 4, crown + 5, TAN)
    spire(sc, cx, cy, r + 0.5, crown + 4, 46, finials, dormers=9)
    sc.owner = "Dumbledore's turrets"
    for angle, courses in ((205, 9), (180, 12), (155, 8)):
        a = math.radians(angle)
        x, y, k0 = round(cx + 9 * math.cos(a)) - 2, round(cy + 9 * math.sin(a)) - 2, crown + 16
        k1 = k0 + courses
        for k in range(k0, k1):
            sc.part("87081", x, y, k, DTAN if k in (k0, k1 - 1) else TAN)
        sc.part("272", x, y, k1, DBG)
        sc.part("3942c", x + 1, y + 1, k1 + 3, DBG)
        finials.append((x + 1, y + 1, k1 + 5))


def pepperpot(sc: Sculpture, finials: Finials) -> None:
    """The fat round tower on its own ledge below the Great Hall's end, under a squat cone."""
    sc.owner = "the pepperpot"
    round_tower(sc, 64, 25, 5, PLATEAU - 6, PLATEAU + 18, 9, finials)


def quad(sc: Sculpture) -> None:
    """The wings around the courtyard behind the Great Hall."""
    sc.owner = "the Quad"
    block(sc, 26, 48, 40, 30, 18, skip=rect(34, 56, 24, 14))


def east_front(sc: Sculpture, finials: Finials) -> None:
    """The wing where the viaduct lands, and the tall-spired round tower in front of it."""
    sc.owner = "the viaduct wing"
    block(sc, 81, 32, 16, 14, 18)
    sc.owner = "the viaduct tower"
    round_tower(sc, 96, 28, 4, PLATEAU, PLATEAU + 30, 16, finials)


def gate_tower(sc: Sculpture, finials: Finials) -> None:
    sc.owner = "the gate tower"
    round_tower(sc, 141, 37, 5, PLATEAU - 2, PLATEAU + 24, 10, finials)


def viaduct(sc: Sculpture) -> None:
    """Tall slender piers rising from the lake, pointed arches, and a parapeted deck to the gate tower."""
    sc.owner = "the viaduct"
    x0, x1, y0, y1, deck = 97, 136, 35, 40, PLATEAU - 2
    for x in range(x0, x1 + 1):
        rel = (x - x0) % 5
        for y in range(y0, y1 + 1):
            low = 1 if rel in (3, 4) else deck - 1 if rel in (0, 2) else deck
            sc.fill([(x, y)], low, deck + 2, stone({deck + 1, *range(low, low + 2)}))
            if y in (y0, y1):
                sc.fill([(x, y)], deck + 2, deck + 3 + (rel % 2 == 0), TAN)


def boathouse(sc: Sculpture) -> None:
    sc.owner = "the boathouse"
    x0, y0, w, d = 104, 10, 8, 6

    def color(x: int, y: int, k: int) -> int:
        if y == y0 and 107 <= x <= 108 and k < 5:
            return BLACK
        return DTAN if k == 1 else TAN

    sc.fill(rect(x0, y0, w, d), 1, 7, color)
    gable_roof(sc, x0, y0, w, d, 7, ridge="y", pitch=1)


def castle(sc: Sculpture, finials: Finials) -> None:
    great_hall(sc, finials)
    entrance(sc)
    staircase_tower(sc, finials)
    pepperpot(sc, finials)
    quad(sc)
    east_front(sc, finials)
    gate_tower(sc, finials)
    viaduct(sc)
    boathouse(sc)


async def raise_castle(kit: Kit, sc: Sculpture, ground: Ground, finials: Finials, band: int = 6) -> None:
    pieces = sc.mesh(ground.course)
    for k0 in range(0, int(pieces[-1][0]) + 1, band):
        chunk = [(owner, b) for k, owner, b in pieces if k0 <= int(k) < k0 + band]
        if not chunk:
            continue
        names = [name for name, _ in Counter(owner for owner, _ in chunk).most_common(3)]
        listed = ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]
        kit.pending = [b for _, b in chunk]
        await kit.step(f"Courses {k0 + 1} to {k0 + band}: {listed}")
    for x, y, k in finials:
        kit.centered("4589", x, y, 1 + 3 * k, DBG)
        kit.centered("30374", x, y, 4 + 3 * k, GOLD)
    await kit.step("Gold finials on every spire")


async def build() -> Kit:
    kit = Kit("hogwarts", "Hogwarts", PROMPT, W, D)
    rng = random.Random(7)
    sc, finials = Sculpture(), []
    castle(sc, finials)
    ground = Ground(kit, rng, *pads(sc))
    sc.clip(ground.course)
    await ground.lake()
    await ground.mesh()
    await ground.surface({"castle": lambda x, y: LBG, "footing": lambda x, y: DBG, "crag": lambda x, y: grass(x, y)})
    await raise_castle(kit, sc, ground, finials)
    kit.save(STORY)
    print(f"{sc.overhangs} bricks hang from the one above")
    return kit
