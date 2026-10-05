"""Hogwarts' south front above the Black Lake, the first film's arrival shot, after Stuart Craig's design and LEGO 71043."""

from __future__ import annotations

import heapq
import math
import random
from collections import Counter
from collections.abc import Callable

from brickyard.sculpt import Color, Sculpture, circle, erode
from brickyard.shapes import rect
from brickyard.showcase.kit import Kit

W, D = 152, 124
"""The plan's frame: the crag and the lake spill past it on every side."""
BLACK, TAN, DTAN, LBG, DBG, GOLD, LIT = 0, 19, 28, 71, 72, 297, 46
GREEN, DGREEN, OLIVE = 2, 288, 330
DBLUE, TLBLUE, TMBLUE = 272, 43, 41
DBROWN, BROWN = 308, 70
WHITE, YELLOW, ORANGE, LAVENDER, PINK, AZURE, CLEAR, SQUID = 15, 14, 25, 31, 29, 322, 47, 320
FLOWERS = (WHITE, YELLOW, LAVENDER, PINK, YELLOW)
PINES = (("3471", DGREEN), ("3471", DGREEN), ("3471", GREEN), ("3470", GREEN), ("6064", DGREEN), ("6064", OLIVE))

Cell = tuple[int, int]
PROMPT = (
    "Hogwarts' south front above the Black Lake: the Great Hall on its cliff, the Marble Staircase Tower, the viaduct"
)
STORY = [
    (
        "Hand-scripted by Claude after Stuart Craig's concept art, the film's miniature and LEGO 71043, as a showcase "
        "of what HoloBricks' parts and checks can do. The castle is sculpted as solids and meshed into bricks: only the "
        "shell is built, steady steps become slopes, and every brick rests on another. Ask for a change and Holo takes over."
    ),
]

S = 2
"""The terrain is sculpted on 2x2-stud cells, so its faces are big facets and not a noise of small bricks."""
PLATEAU = 40
CLIFF = 3.2
CX, CY = 76, 62
"""The Marble Staircase Tower's center: every building is placed from it, after the film castle's ground-floor plan."""
YARD = PLATEAU - 2
"""The Viaduct Courtyard's floor, level with the viaduct's deck."""
SIDES4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
"""Courses the crag falls per stud away from the buildings on it."""
LAKE = 12
"""Studs of water from the foot of the crag to the lake's edge, on average; the shore wanders from 4 to 23."""
FRONT = 14
"""Studs more of lake in front, where the boats cross."""
MARGIN = 24
"""Cells of terrain past the plan's frame, room for the crag's foot and the lake around it."""


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
    for X in range(-MARGIN, W // S + MARGIN):
        for Y in range(-MARGIN, D // S + MARGIN):
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
    keep = shore(height)
    return {c: h for c, h in height.items() if c in keep}, {c: k for c, k in kind.items() if c in keep}


def shore(height: dict[Cell, int]) -> set[Cell]:
    """The crag and the lake around it: water reaches an uneven distance from the rock, filling any bay it encloses."""
    far = {c: 0.0 for c, h in height.items() if h > 0}
    queue = [(0.0, c) for c in far]
    while queue:
        d, (X, Y) = heapq.heappop(queue)
        if d > far[X, Y]:
            continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            c, step = (X + dx, Y + dy), d + S * math.hypot(dx, dy)
            if c in height and step < far.get(c, math.inf) and step <= LAKE + FRONT + 11:
                far[c] = step
                heapq.heappush(queue, (step, c))

    def reach(X: int, Y: int) -> float:
        x, y = S * X, S * Y
        front = FRONT * min(1.0, max(0.0, (12 - y) / 24))
        return max(2.0 * S, LAKE + front + 8 * noise(x * 0.05 + 3, y * 0.05) + 3 * noise(x * 0.21, y * 0.21 + 5))

    keep = {c for c, d in far.items() if d <= reach(*c)}
    edge = [c for c in height if c not in keep and not all((c[0] + dx, c[1] + dy) in height for dx, dy in SIDES4)]
    outside = set(edge)
    while edge:
        X, Y = edge.pop()
        for dx, dy in SIDES4:
            c = (X + dx, Y + dy)
            if c in height and c not in keep and c not in outside:
                outside.add(c)
                edge.append(c)
    return set(height) - outside


def pads(sc: Sculpture) -> tuple[dict[Cell, tuple[int, str]], set[Cell]]:
    """Flat ground under every building, one stud wider; also the cells a building stands in.

    A cell's ground meets the highest foot in it and the lower feet there are cut, so no stud hangs over the ground.
    Only courses up to the plateau count, so corbelled crowns don't raise rock under them. Footings at the water's
    edge only raise the ground to course 1, so the crag keeps its height where it is higher.
    """
    base: dict[Cell, int] = {}
    for (x, y, k), (_, _, owner) in sc.solid.items():
        if k <= PLATEAU and (owner not in ("the viaduct", "the boathouse stairs") or k <= 1):
            base[x, y] = min(k, base.get((x, y), k))
    own: dict[Cell, int] = {}
    for (x, y), k in base.items():
        own[x // S, y // S] = max(k, own.get((x // S, y // S), k))
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
    """The terrain meshed into bricks: exposed faces only, step edges bevelled, plates on the hollow tops."""

    def __init__(self, kit: Kit, rng: random.Random, pads: dict[Cell, tuple[int, str]], footing: set[Cell]):
        self.kit, self.rng, self.footing = kit, rng, footing
        self.height, self.kind = terrain(rng, pads)
        self.claimed: set[tuple[int, int, int]] = set()
        self.slopes: dict[tuple[int, int, int], Cell | None] = {}
        """The courses a bevel fills, each with the one side its slope covers to the top, None for a corner."""
        kit.offset = (-S * min(X for X, _ in self.height), -S * min(Y for _, Y in self.height))

    def course(self, x: int, y: int) -> int:
        """The course a building starts on at stud (x, y)."""
        return self.height.get((x // S, y // S), 0)

    def water(self, x: int, y: int) -> bool:
        return self.height.get((x // S, y // S)) == 0

    def studs(self, X: int, Y: int) -> set[Cell]:
        return rect(S * X, S * Y, S, S)

    def solid(self, X: int, Y: int, k: int) -> bool:
        return (X, Y) in self.height and k < self.height[X, Y]

    def grassy(self, c: Cell) -> bool:
        return False

    def closed(self, X: int, Y: int, k: int, side: Cell) -> bool:
        """Whether a cell's course fills its whole `side`: a bevel's slope leaves all but its back open."""
        if (X, Y, k) in self.slopes:
            return self.slopes[X, Y, k] == side
        return self.solid(X, Y, k)

    def exposed(self, X: int, Y: int, k: int) -> bool:
        """A cell's course seen from outside, so built as bricks; the ones inside stay hollow."""
        return (
            self.solid(X, Y, k)
            and (X, Y, k) not in self.claimed
            and any(
                not self.closed(X + dx, Y + dy, k, (-dx, -dy))
                for (dx, dy), _ in OUTWARD
                if (X + dx, Y + dy) in self.height
            )
        )

    def lake(self) -> None:
        self.kit.cover({s for c in self.height for s in self.studs(*c)}, 0, DBLUE)
        self.kit.step("The bed of the Black Lake")
        water = {s for c, h in self.height.items() if h == 0 for s in self.studs(*c)}
        self.kit.scatter(water, 1, [(TMBLUE, 14), (TLBLUE, 1)], self.rng, WATER)
        self.kit.step("The Black Lake")

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
                part, rotation, back = CORNERS[size], corner[1], None
            else:
                d, drop = max(drops.items(), key=lambda item: item[1])
                size = min(drop, 3, h)
                if size == 3 and self.rng.random() < 0.3:
                    size = 2
                part, rotation, back = BEVELS[size], dict(OUTWARD)[d], (-d[0], -d[1])
            self.claimed.update((X, Y, k) for k in range(h - size, h))
            self.slopes.update(((X, Y, k), back) for k in range(h - size, h))
            color = grass(X, Y) if self.grassy((X, Y)) else OLIVE if self.rng.random() < 0.1 else rock(X, Y, h - 1)
            out.append((part, S * X, S * Y, 1 + 3 * (h - size), color, rotation))
        return out

    def mesh(self) -> None:
        bevels = self.bevels()
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
            self.kit.step(f"The crag, courses {k0 + 1} to {min(k0 + 4, top)}")
        for part, x, y, z, color, rotation in bevels:
            self.kit.add(part, x, y, z, color, rotation)
        self.kit.step("Crags: the angled faces of the rock")

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

    def surface(self, paved: dict[str, Callable[[int, int], int]]) -> None:
        """Top plates flush with the rock over the hollow cells."""
        groups: dict[tuple[str, int], set[Cell]] = {}
        for X, Y in self.hollow_tops():
            groups.setdefault((self.kind[X, Y], self.height[X, Y]), set()).update(self.studs(X, Y))
        for (kind, h), cells in sorted(groups.items()):
            self.kit.cover(cells, 3 * h, paved.get(kind, grass))
        self.kit.step("The tops of the crag and the grounds")


WATER = ((4, 2, "3020"), (2, 2, "3022"), (4, 4, "3031"), (6, 2, "3795"), (2, 1, "3023b"), (1, 1, "3024"))


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


def gable_roof(
    sc: Sculpture, x0: int, y0: int, w: int, d: int, k0: int, ridge: str, pitch: int = 2, slate: Color = DBG
) -> int:
    """A steep slate roof with tan crow-stepped gables at both ends of its ridge; returns the course above it."""
    cells, k = rect(x0, y0, w, d), k0
    ends = {x0, x0 + w - 1} if ridge == "x" else {y0, y0 + d - 1}
    while cells:
        gable = {c for c in cells if (c[0] if ridge == "x" else c[1]) in ends}
        sc.fill(cells - gable, k, k + pitch, slate, sloped=True)
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
    x0, y0, w, d = CX - 53, CY - 29, 41, 14
    x1, y1, top = x0 + w - 1, y0 + d - 1, PLATEAU + 26

    def color(x: int, y: int, k: int) -> int:
        u = (x - x0) % 4
        if y in (y0, y1) and u and PLATEAU + 4 <= k <= PLATEAU + (22 if u == 2 else 20):
            return LIT
        if x in (x0, x1) and 4 <= y - y0 <= 9 and PLATEAU + 5 <= k <= PLATEAU + 22 and (y - y0) not in (6, 7):
            return LIT
        if k < PLATEAU + 2 or k in (PLATEAU + 13, top - 1):
            return DTAN
        return TAN

    sc.fill(rect(x0, y0, w, d), PLATEAU, top, color)
    for x in range(x0 + 4, x1 + 1, 4):
        for y, outer, turn in ((y0 - 1, y0 - 2, 0), (y1 + 1, y1 + 1, 180)):
            sc.fill([(x, y0 - 2 if turn == 0 else y1 + 2)], PLATEAU, PLATEAU + 17, stone({PLATEAU, PLATEAU + 13}))
            sc.part("3040b", x, outer, PLATEAU + 17, TAN, turn)
            sc.fill([(x, y)], PLATEAU, top, stone({PLATEAU, PLATEAU + 13, top - 1}))
            pinnacle(sc, x, y, top)
    dormers = lambda x, y, k: BLACK if k - top in (4, 5) and (x - x0) % 4 == 2 else DBG
    gable_roof(sc, x0, y0, w, d, top, ridge="x", slate=dormers)
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


def ivy(x: int, y: int, k: int, k0: int) -> int | None:
    """Ivy climbing a wall from its foot in patches, thinning out with height."""
    n = noise(x * 0.6 + k * 0.35, y * 0.6 - k * 0.25)
    if n > 0.3 + 0.1 * (k - k0):
        return DGREEN if n > 0.55 + 0.1 * (k - k0) else GREEN
    return None


def block(
    sc: Sculpture,
    x0: int,
    y0: int,
    w: int,
    d: int,
    courses: int,
    ridge: str | None = None,
    every: int = 3,
    k0: int = PLATEAU,
) -> int:
    """A tan wing with rows of small windows every `every` studs, under a gabled or hipped roof; returns the course above it."""
    top = k0 + courses
    rows = range(k0 + 4, top - 3, 5)

    def color(x: int, y: int, k: int) -> int:
        u = x - x0 if y in (y0, y0 + d - 1) else y - y0
        if u % every == every // 2 and any(r <= k < r + 2 for r in rows):
            return LIT if (u + k) % 3 else BLACK
        if green := ivy(x, y, k, k0):
            return green
        return DTAN if k < k0 + 1 or k == top - 1 else TAN

    sc.fill(rect(x0, y0, w, d), k0, top, color)
    return gable_roof(sc, x0, y0, w, d, top, ridge) if ridge else sc.roof(rect(x0, y0, w, d), top, DBG)


def hall_front(sc: Sculpture) -> None:
    """The Great Hall's gabled front on the courtyard: a pointed door, two tall lancets, pinnacles, a clock in the gable."""
    sc.owner = "the Great Hall's front"
    x0, y0, w, d = CX - 12, CY - 28, 4, 12
    x1, mid, top = x0 + w - 1, y0 + d / 2, PLATEAU + 30

    def color(x: int, y: int, k: int) -> int:
        off = abs(y + 0.5 - mid)
        if x == x1 and off < 2:
            if k < YARD + 7 + (off < 1):
                return BLACK
            for a, b in ((PLATEAU + 7, PLATEAU + 15), (PLATEAU + 18, PLATEAU + 27)):
                if a <= k < b + (off < 1):
                    return LIT
        return DTAN if k in (YARD, PLATEAU + 16, top - 1) else TAN

    sc.fill(rect(x0, y0, w, d), YARD, top, color)
    gable_roof(sc, x0, y0, w, d, top, ridge="x")
    for y in (y0, y0 + d - 1):
        pinnacle(sc, x1, y, top, rounds=6)


def staircase_tower(sc: Sculpture, finials: Finials) -> None:
    """The Marble Staircase Tower: 24 studs across, a corbelled crown, a spire twice as tall with Dumbledore's turrets."""
    sc.owner = "the Marble Staircase Tower"
    cx, cy, r = CX, CY, 12
    crown = PLATEAU + 48
    bands = {YARD, YARD + 1, PLATEAU + 18, PLATEAU + 34}
    wall = round_wall(cx, cy, bands, windows(r, 14, list(range(PLATEAU + 5, crown - 2, 7))))
    sc.fill(circle(cx, cy, r), YARD, crown, wall)
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


def chamber(sc: Sculpture, finials: Finials) -> None:
    """The Chamber of Reception: the fat round tower at the front corner of the Great Hall and the courtyard, on a lower ledge."""
    sc.owner = "the Chamber of Reception"
    round_tower(sc, CX - 10, CY - 37, 5, PLATEAU - 6, PLATEAU + 18, 9, finials)


def viaduct_courtyard(sc: Sculpture, finials: Finials) -> None:
    """The open yard from the Great Hall's end to the viaduct, at the great tower's door, ringed by a gabled arcade."""
    sc.owner = "the Viaduct Courtyard's towers"
    x0, y0, x1, y1 = CX - 12, CY - 38, CX + 23, CY - 14
    round_tower(sc, x1 + 1, y0, 5, YARD, PLATEAU + 30, 16, finials)
    round_tower(sc, x1 + 1, y1 + 1, 4, YARD, PLATEAU + 20, 10, finials)
    sc.owner = "the Viaduct Courtyard"
    top = YARD + 10

    def color(x: int, y: int, k: int) -> int:
        u = x if y in (y0, y1, y0 + 3, y1 - 3) else y
        if u % 4 in (1, 2) and YARD + 2 <= k <= YARD + 6:
            return LIT
        if green := ivy(x, y, k, YARD):
            return green
        return DTAN if k in (YARD, top - 1) else TAN

    for x, y, w, d, ridge in (
        (x0, y0, x1 - x0 + 1, 4, "x"),
        (x1 - 3, y0 + 4, 4, y1 - y0 - 3, "y"),
        (CX + 8, y1 - 3, x1 - CX - 11, 4, "x"),
    ):
        sc.fill(rect(x, y, w, d), YARD, top, color)
        gable_roof(sc, x, y, w, d, top, ridge)


def south_courtyard(sc: Sculpture, finials: Finials) -> None:
    """Four gabled wings round a lawn behind the great tower, which stands in its front corner; Gryffindor Tower at the far one."""
    sc.owner = "Gryffindor Tower"
    x0, y0, x1, y1 = CX - 40, CY - 4, CX + 11, CY + 45
    round_tower(sc, x0, y1 + 1, 6, PLATEAU, PLATEAU + 58, 24, finials)
    sc.owner = "the South Courtyard"
    block(sc, x0, y0, 8, y1 - y0 + 1, 20, ridge="y")
    block(sc, x0 + 8, y0, CX - 12 - x0 - 8, 8, 16, ridge="x")
    block(sc, x0 + 8, y1 - 7, x1 - x0 - 7, 8, 20, ridge="x")
    block(sc, x1 - 7, CY + 10, 8, y1 - CY - 17, 18, ridge="y")


def gate_tower(sc: Sculpture, finials: Finials) -> None:
    sc.owner = "the gate tower"
    round_tower(sc, 141, CY - 21, 5, PLATEAU - 2, PLATEAU + 24, 10, finials)


def viaduct(sc: Sculpture) -> None:
    """Tall slender piers rising from the lake, pointed arches, and a parapeted deck from the courtyard to the gate tower."""
    sc.owner = "the viaduct"
    x0, x1, y0, y1, deck = CX + 24, 136, CY - 24, CY - 19, YARD
    soffit = {0: 1, 1: 1, 2: deck - 6, 3: deck - 3, 4: deck - 2, 5: deck - 3, 6: deck - 6}
    for x in range(x0, x1 + 1):
        rel = (x - x0 - 2) % 7
        for y in range(y0, y1 + 1):
            low = soffit[rel]
            sc.fill([(x, y)], low, deck + 2, stone({deck + 1, *range(low, low + 2)}))
            if y in (y0, y1):
                sc.fill([(x, y)], deck + 2, deck + 3 + (x % 2 == 0), TAN)
    for x in range(x0 + 3, x1, 7):
        for y in (y0, y1):
            sc.part("3062b", x, y, deck + 3 + (x % 2 == 0), LIT)


def stairs(sc: Sculpture) -> None:
    """The walled stair switching back down the cliff from the courtyard's corner tower to the boathouse."""
    sc.owner = "the boathouse stairs"
    x0, x1, flights = 104, 124, 4
    drop = (YARD - 2) // flights
    level: dict[Cell, int] = {}
    for i in range(flights):
        y, top = 19 - 4 * i, YARD - 1 - drop * i
        for x in range(x0, x1 + 1):
            run = x - x0 if i % 2 == 0 else x1 - x
            for dy in range(3):
                level[x, y + dy] = top - round(run * drop / (x1 - x0))
        if i < flights - 1:
            turn = x1 + 1 if i % 2 == 0 else x0 - 3
            for x in range(turn, turn + 3):
                for dy in range(-4, 3):
                    level[x, y + dy] = top - drop
    ends = {(x0, y) for y in (19, 20, 21, 7, 8, 9)}
    for c, k in level.items():
        wall = c not in ends and any((c[0] + dx, c[1] + dy) not in level for dx, dy in SIDES4)
        sc.fill([c], 1, k + (3 if wall else 1), stone({k, k + 2} if wall else {k}))


def boathouse(sc: Sculpture) -> None:
    sc.owner = "the boathouse"
    x0, y0, w, d = 96, 4, 8, 7

    def color(x: int, y: int, k: int) -> int:
        if y == y0 and x0 + 3 <= x <= x0 + 4 and k < 5:
            return BLACK
        return DTAN if k == 1 else TAN

    sc.fill(rect(x0, y0, w, d), 1, 7, color)
    gable_roof(sc, x0, y0, w, d, 7, ridge="y", pitch=1)


def grounds(sc: Sculpture) -> None:
    """Lawns and paving between the buildings, one course under their floors, so the crag doesn't dip between them."""
    sc.owner = "the grounds"
    for cells, k, color in (
        (rect(CX - 59, CY - 15, 47, 11), PLATEAU - 1, GREEN),
        (rect(CX - 32, CY + 4, 36, 34), PLATEAU - 1, paths(CX - 14, CY + 21)),
        (rect(CX - 12, CY - 34, 32, 22), YARD - 1, LBG),
    ):
        sc.fill({c for c in cells if not any((*c, k + i) in sc.solid for i in (1, 2, 3))}, k, k + 1, color)


def paths(cx: int, cy: int) -> Callable[[int, int, int], int]:
    """A lawn crossed by two paths meeting at (cx, cy)."""
    return lambda x, y, k: TAN if abs(x - cx) <= 1 or abs(y - cy) <= 1 else GREEN


def gardens(sc: Sculpture) -> None:
    """Trees, a fountain and flower borders in the South Courtyard; trees, lamps and a gold statue in the Viaduct Courtyard."""
    sc.owner = "the South Courtyard's garden"
    lx, ly = CX - 14, CY + 21
    sc.part("87081", lx - 2, ly - 2, PLATEAU, LBG)
    sc.part("3941", lx - 1, ly - 1, PLATEAU + 1, LBG)
    for x, y in ((lx - 1, ly - 1), (lx, ly)):
        sc.part("3062b", x, y, PLATEAU + 2, TLBLUE)
    for part, x, y, color in (
        ("3470", CX - 28, CY + 8, GREEN),
        ("3471", CX - 28, CY + 30, DGREEN),
        ("3471", CX - 4, CY + 30, DGREEN),
        ("2435", CX - 4, CY + 16, GREEN),
    ):
        sc.part(part, x, y, PLATEAU, color)
    lawn = {
        (x, y)
        for (x, y, k), (color, _, owner) in sc.solid.items()
        if k == PLATEAU - 1 and color == GREEN and owner == "the grounds"
    }
    for x, y in sorted(lawn):
        edge = any((x + dx, y + dy) not in lawn for dx, dy in SIDES4)
        if edge and (x + y) % 2 == 0 and (x, y, PLATEAU) not in sc.claimed:
            sc.part("24866", x, y, PLATEAU, FLOWERS[(7 * x + 3 * y) % len(FLOWERS)])
    sc.owner = "the Viaduct Courtyard"
    for x, y in ((CX - 3, CY - 21), (CX + 16, CY - 21)):
        sc.part("2435", x, y, YARD, DGREEN)
    for x, y in ((CX + 2, CY - 31), (CX + 13, CY - 31), (CX + 2, CY - 23), (CX + 13, CY - 23)):
        for i, color in enumerate((DBG, DBG, LIT)):
            sc.part("3062b", x, y, YARD + i, color)
        sc.part("4589", x, y, YARD + 3, BLACK)
    x, y = CX + 7, CY - 27
    sc.part("3941", x, y, YARD, LBG)
    for i in (1, 2):
        sc.part("3062b", x, y, YARD + i, GOLD)
    sc.part("4589", x, y, YARD + 3, GOLD)


def easter_eggs(sc: Sculpture) -> None:
    """Hagrid's round hut and pumpkin patch on a ledge below the Great Hall."""
    sc.owner = "Hagrid's hut"
    cx, cy, k0 = 9, 20, 9

    def wall(x: int, y: int, k: int) -> int:
        if y < cy - 2 and abs(x + 0.5 - cx) < 1 and k < k0 + 3:
            return DBROWN
        if abs(y + 0.5 - cy) < 1 and k == k0 + 2:
            return LIT
        return LBG if noise(x * 0.9, y * 0.9 + k) > 0.3 else DBG

    sc.fill(circle(cx, cy, 3.5), k0, k0 + 5, wall)
    sc.cone(cx, cy, 4.5, k0 + 5, 5, DBROWN)
    sc.fill([(cx + 1, cy + 1)], k0 + 5, k0 + 10, DBG)
    sc.owner = "Hagrid's pumpkins"
    sc.fill(rect(cx - 5, cy - 7, 10, 3), k0 - 1, k0, DBROWN)
    for x, y in ((cx - 4, cy - 7), (cx - 1, cy - 6), (cx + 2, cy - 7), (cx + 3, cy - 5)):
        sc.part("3062b", x, y, k0, ORANGE)
        sc.part("32607", x, y, k0 + 1, GREEN)


def castle(sc: Sculpture, finials: Finials) -> None:
    great_hall(sc, finials)
    hall_front(sc)
    staircase_tower(sc, finials)
    chamber(sc, finials)
    viaduct_courtyard(sc, finials)
    south_courtyard(sc, finials)
    gate_tower(sc, finials)
    viaduct(sc)
    stairs(sc)
    boathouse(sc)
    grounds(sc)
    gardens(sc)
    easter_eggs(sc)


def boats(kit: Kit, ground: Ground) -> None:
    """The first years' little boats crossing the lake in a line, a lantern at each bow."""
    for i in range(12):
        x, y = 6 + 9 * i, 6 + round(3 * math.sin(i * 0.9))
        if not all(ground.water(u, v) for u in range(x - 1, x + 3) for v in range(y - 1, y + 5)):
            continue
        kit.add("3020", x, y, 2, BROWN, 90)
        kit.add("3062b", x, y + 3, 3, LIT)
    kit.step("Boats with lanterns crossing the Black Lake")


def life(kit: Kit, sc: Sculpture, ground: Ground, rng: random.Random) -> None:
    """The clock, the Whomping Willow with the Ford Anglia in its branches, the forest and flowers, the giant squid."""
    kit.mount("4150p03", CX - 8, CY - 23, 1 + 3 * (PLATEAU + 33), WHITE, "east")
    kit.step("The clock in the Great Hall's gable")
    x, y, z = CX - 36, CY - 10, 1 + 3 * PLATEAU
    for i in range(3):
        kit.add("3941", x, y, z + 3 * i, BROWN)
    kit.add("2417", x - 2, y - 2, z + 9, OLIVE)
    kit.add("3941", x, y, z + 10, BROWN)
    kit.add("2417", x - 2, y - 2, z + 13, DGREEN, 90)
    kit.add("3021", x - 1, y, z + 14, AZURE)
    kit.add("3004", x, y, z + 15, CLEAR, 90)
    kit.add("3023b", x, y, z + 18, AZURE, 90)
    kit.step("The Whomping Willow, with a flying Ford Anglia stuck in it")
    tops = {
        c: h
        for c, h in ground.height.items()
        if h > 0 and ground.kind[c] == "crag" and (*c, h - 1) not in ground.claimed
    }
    used: set[Cell] = set()

    def free(cells: list[Cell], h: int, courses: int) -> bool:
        return all(tops.get(c) == h and c not in used for c in cells) and not any(
            (x, y, k) in sc.solid or (x, y, k) in sc.claimed
            for c in cells
            for x, y in ground.studs(*c)
            for k in range(h, h + courses)
        )

    for (X, Y), h in sorted(tops.items()):
        cells = [(X, Y), (X + 1, Y), (X, Y + 1), (X + 1, Y + 1)]
        forest = S * Y > CY + 36 or S * X < 16
        if rng.random() < (0.45 if forest else 0.06) and free(cells, h, 7):
            part, color = rng.choice(PINES)
            kit.add(part, S * X, S * Y, 1 + 3 * h, color)
            used.update(cells)
    kit.step("Pines of the Forbidden Forest and bushes on the crag")
    for (X, Y), h in sorted(tops.items()):
        if (X, Y) in used or not free([(X, Y)], h, 1):
            continue
        for x, y in sorted(ground.studs(X, Y)):
            if rng.random() < 0.06:
                flower = rng.random() < 0.6
                kit.add("24866" if flower else "32607", x, y, 1 + 3 * h, rng.choice(FLOWERS) if flower else DGREEN)
    kit.step("Wild flowers and ferns on the ledges")
    for x, y in ((126, 5), (131, 8), (137, 4)):
        if not all(ground.water(u, v) for u in range(x, x + 3) for v in (y, y + 1)):
            continue
        for part, dx, z in (
            ("3941", 0, 2),
            ("3062b", 1, 5),
            ("3062b", 1, 8),
            ("3023b", 1, 11),
            ("3062b", 2, 12),
            ("4589", 2, 15),
        ):
            kit.add(part, x + dx, y, z, SQUID)
    kit.step("The giant squid's tentacles out of the Black Lake")
    x, y = 104, 8
    k = max((k + 1 for (u, v, k) in sc.solid if (u, v) == (x, y)), default=ground.course(x, y))
    kit.add("33320", x, y, 1 + 3 * k, GREEN)
    kit.step("Trevor the toad, found at the foot of the boathouse stairs")


def raise_castle(kit: Kit, sc: Sculpture, ground: Ground, finials: Finials, band: int = 6) -> None:
    pieces = sc.mesh(ground.course)
    for k0 in range(0, int(pieces[-1][0]) + 1, band):
        chunk = [(owner, b) for k, owner, b in pieces if k0 <= int(k) < k0 + band]
        if not chunk:
            continue
        names = [name for name, _ in Counter(owner for owner, _ in chunk).most_common(3)]
        listed = ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]
        kit.pending = [b for _, b in chunk]
        kit.step(f"Courses {k0 + 1} to {k0 + band}: {listed}")
    for x, y, k in finials:
        kit.centered("4589", x, y, 1 + 3 * k, DBG)
        kit.centered("30374", x, y, 4 + 3 * k, GOLD)
    kit.step("Gold finials on every spire")


def build() -> Kit:
    kit = Kit("hogwarts", "Hogwarts", PROMPT)
    rng = random.Random(7)
    sc, finials = Sculpture(), []
    castle(sc, finials)
    ground = Ground(kit, rng, *pads(sc))
    sc.clip(ground.course)
    ground.lake()
    ground.mesh()
    ground.surface({"castle": lambda x, y: LBG, "footing": lambda x, y: DBG, "crag": lambda x, y: grass(x, y)})
    raise_castle(kit, sc, ground, finials)
    life(kit, sc, ground, rng)
    boats(kit, ground)
    kit.save(STORY)
    print(f"{sc.overhangs} bricks hang from the one above")
    return kit
