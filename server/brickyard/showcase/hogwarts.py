"""Hogwarts on its crag above the Black Lake: a 128x88 microscale diorama after LEGO 76419 and the Studio Tour model."""

from __future__ import annotations

import math
import random
from collections.abc import Callable

from brickyard.shapes import brick, rect
from brickyard.showcase.kit import Kit

W, D = 128, 88
BLACK, WHITE, TAN, DTAN, LBG, DBG, GOLD, LIT, CLEAR = 0, 15, 19, 28, 71, 72, 297, 46, 47
GREEN, DGREEN, BGREEN, OLIVE, SGREEN = 2, 288, 10, 330, 378
BLUE, DBLUE, TLBLUE, TMBLUE = 1, 272, 43, 41
RBROWN, DBROWN, ORANGE = 70, 308, 25

Cell = tuple[int, int]
PROMPT = "Hogwarts on its crag above the Black Lake, a big microscale diorama with real height"
STORY = [
    (
        "Hand-scripted by Claude after LEGO's microscale sets and the Studio Tour model, as a showcase of what "
        "Brickyard's parts and checks can do. Every step went through the same validation Holo uses; ask for a "
        "change and Holo takes over."
    ),
]

S = 2
"""The terrain is sculpted on 2x2-stud cells, so its faces are big facets and not a noise of small bricks."""
CLIFF, SLOPE = 2.8, 0.5
LEVELS = [
    ("castle", (26, 38, 96, 70), 22, CLIFF),
    ("castle", (40, 34, 82, 40), 22, CLIFF),
    ("castle", (30, 70, 72, 74), 22, CLIFF),
    ("west", (4, 48, 10, 68), 22, CLIFF),
    ("landing", (60, 26, 76, 32), 13, CLIFF),
    ("greenhouses", (82, 28, 98, 34), 17, CLIFF),
    ("hill", (106, 42, 116, 52), 22, CLIFF),
    ("grounds", (102, 30, 127, 87), 9, SLOPE),
    ("back", (0, 78, 127, 87), 9, SLOPE),
]
STAIRS = [((24 + j, 12), 2 + 2 * j) for j in range(6)]
BOATHOUSE = (20, 9, 23, 10)


def noise(x: float, y: float) -> float:
    """Smooth value in -1..1."""
    return (
        0.5 * math.sin(0.37 * x + 0.11 * y)
        + 0.3 * math.sin(0.53 * y - 0.21 * x + 1.3)
        + 0.2 * math.sin(1.1 * x + 0.7 * y + 2.1)
    )


def distance(x: float, y: float, box: tuple[int, int, int, int]) -> float:
    x0, y0, x1, y1 = box
    return math.hypot(max(x0 - x, 0, x - x1), max(y0 - y, 0, y - y1))


def terrain(rng: random.Random) -> tuple[dict[Cell, int], dict[Cell, str]]:
    """Height in courses and the level of each 2x2 cell; 0 is the lake."""
    height, kind = {}, {}
    for X in range(W // S):
        for Y in range(D // S):
            x, y = S * X + 0.5, S * Y + 0.5
            best, name = 0.0, "lake"
            for level, box, h, rate in LEVELS:
                d = distance(x, y, box)
                if d and rate == CLIFF:
                    d = max(0.0, d - 2.5 - 2.5 * noise(x * 0.18, y * 0.18) - 0.8 * noise(x * 0.7, y * 0.7))
                    d *= 1 + 0.45 * noise(X * 0.9 + 7, Y * 0.9) + 0.3 * (rng.random() - 0.5)
                bump = 0.8 * noise(x * 0.2 + 3, y * 0.2) if rate == SLOPE else 0
                value = h + bump - d * rate
                if value > best:
                    best, name = value, level
            height[X, Y], kind[X, Y] = max(0, math.floor(best)), name
    for x0, y0, w, d in footprints():
        for X in range((x0 - 1) // S, (x0 + w) // S + 1):
            for Y in range((y0 - 1) // S, (y0 + d) // S + 1):
                height[X, Y], kind[X, Y] = 22, "castle"
    X0, Y0, X1, Y1 = BOATHOUSE
    for c in rect(X0, Y0, X1 - X0 + 1, Y1 - Y0 + 1):
        height[c], kind[c] = 1, "boathouse"
    for (X, Y), h in STAIRS:
        height[X, Y], kind[X, Y] = h, "stairs"
        height[X, Y - 1] = min(height[X, Y - 1], max(0, h - 3))
    return height, kind


RUNS = {1: "3003", 2: "3001", 3: "2456", 4: "3007"}
OUTWARD = [((0, -1), 0), ((-1, 0), 90), ((1, 0), 270), ((0, 1), 180)]
BEVELS = {3: "3684c", 2: "3678b", 1: "3039"}
CORNERS = {3: "3685", 2: "3688", 1: "3045"}
CORNER_TURNS = {((0, -1), (1, 0)): 0, ((-1, 0), (0, -1)): 90, ((0, 1), (-1, 0)): 180, ((1, 0), (0, 1)): 270}


def rock(x: int, y: int, k: int) -> int:
    n = noise(x * 0.25 + k * 0.5, y * 0.25 - k * 0.3)
    return DBG if n > 0.3 else DTAN if n < -0.8 else LBG


def earth(x: int, y: int, k: int) -> int:
    return DTAN if noise(x * 0.4, y * 0.4 + k) > -0.3 else DBROWN


def grass(x: int, y: int) -> int:
    n = noise(x * 0.5 + 11, y * 0.5)
    return DGREEN if n > 0.45 else OLIVE if n < -0.6 else GREEN


class Ground:
    """The terrain meshed into bricks: exposed faces only, step edges bevelled, hidden columns under the top plates."""

    def __init__(self, kit: Kit, rng: random.Random):
        self.kit, self.rng = kit, rng
        self.height, self.kind = terrain(rng)
        self.claimed: set[tuple[int, int, int]] = set()

    def top(self, x: int, y: int) -> int:
        """Plate height of the ground's surface at stud (x, y)."""
        return 1 + 3 * self.height[x // S, y // S]

    def studs(self, X: int, Y: int) -> set[Cell]:
        return rect(S * X, S * Y, S, S)

    def solid(self, X: int, Y: int, k: int) -> bool:
        return (X, Y) in self.height and k < self.height[X, Y]

    def grassy(self, c: Cell) -> bool:
        return self.kind[c] in ("grounds", "back")

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
        self.kit.scatter(water, 1, [(TMBLUE, 12), (TLBLUE, 1)], self.rng, WATER)
        await self.kit.step("The Black Lake")

    def bevels(self) -> list[tuple[str, int, int, int, int, int]]:
        out = []
        for (X, Y), h in sorted(self.height.items()):
            if h == 0 or self.kind[X, Y] in ("stairs", "boathouse"):
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
        for k in range(max(self.height.values())):
            groups: dict[int, set[Cell]] = {}
            for X, Y in self.height:
                if self.exposed(X, Y, k):
                    color = (earth if self.grassy((X, Y)) else rock)(X, Y, k)
                    groups.setdefault(color, set()).add((X, Y))
            for color, group in groups.items():
                self.blocks(group, 1 + 3 * k, color)
            await self.kit.step(f"Rock, course {k + 1}")
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


Z = 67
"""Plate height of the castle crag's top."""


def facade(x0: int, y0: int, w: int, d: int, window: Callable[[int, int], bool], lit: int = BLACK):
    """Wall colors: a dark tan plinth, tan stone, and windows where `window(u, course)` holds, u along the face."""
    y1 = y0 + d - 1

    def color(x: int, y: int, c: int) -> int:
        if c == 0:
            return DTAN
        along = y in (y0, y1)
        u, n = (x - x0, w) if along else (y - y0, d)
        return lit if 0 < u < n - 1 and window(u, c) else TAN

    return color


def slits(courses: int, every: int = 2) -> Callable[[int, int], bool]:
    return lambda u, c: u % every == 1 and c % 4 in (2, 3) and c < courses - 1


def finial(kit: Kit, x: int, y: int, z: int) -> None:
    """A cone and a gold spike on the stud in the middle of the 2x2 at (x, y)."""
    kit.centered("4589", x, y, z, DBG)
    kit.centered("30374", x, y, z + 3, GOLD)


def roof(kit: Kit, x0: int, y0: int, w: int, d: int, z: int) -> int:
    """A dark tan cornice and a steep slate roof of 75-degree slopes; returns its top."""
    kit.fill(x0, y0, w, d, z, DTAN)
    x, y, rw, rd, top = kit.hip(x0, y0, w, d, z + 1, DBG, slope="4460b", rise=9)
    if rw == rd == 2:
        kit.add("3688", x, y, top, DBG)
        return top + 6
    kit.ridge(x, y, rw, rd, top, DBG)
    return top + 3


def pinnacle(kit: Kit, x: int, y: int, z: int, rounds: int = 2) -> None:
    for i in range(rounds):
        kit.add("3062b", x, y, z + 3 * i, TAN)
    kit.add("4589", x, y, z + 3 * rounds, DBG)


def hall(
    kit: Kit,
    x0: int,
    y0: int,
    w: int,
    d: int,
    courses: int,
    z: int = Z,
    window: Callable[[int, int], bool] | None = None,
    lit: int = BLACK,
    buttresses: tuple[str, ...] = (),
) -> int:
    """A wing: plinth, walls with windows, a steep slate roof, and buttresses ending in pinnacles; returns its top."""
    top = kit.ring(x0, y0, w, d, z, courses, facade(x0, y0, w, d, window or slits(courses), lit))
    for face in buttresses:
        y = y0 - 1 if face == "front" else y0 + d
        for u in range(3, w - 1, 3):
            kit.pending += _column(x0 + u, y, z, top, TAN)
            kit.add("4589", x0 + u, y, top, DBG)
    return roof(kit, x0, y0, w, d, top)


def square_tower(kit: Kit, x: int, y: int, s: int, courses: int, z: int = Z) -> int:
    """Tan walls with windows, a crenellated cornice, corner pinnacles and a slate spire; returns the spire's base."""
    middle = (s // 2 - 1, s // 2)
    top = kit.ring(x, y, s, s, z, courses, facade(x, y, s, s, lambda u, c: u in middle and c % 5 in (2, 3)))
    kit.fill(x, y, s, s, top, DTAN)
    top += 1
    for cx, cy in ((x, y), (x + s - 1, y), (x, y + s - 1), (x + s - 1, y + s - 1)):
        pinnacle(kit, cx, cy, top)
    for u in range(2, s - 2, 2):
        for cx, cy in ((x + u, y), (x + u, y + s - 1), (x, y + u), (x + s - 1, y + u)):
            kit.add("3005", cx, cy, top, TAN)
    sx, sy, _, _, peak = kit.hip(x + 1, y + 1, s - 2, s - 2, top, DBG, slope="4460b", rise=9)
    kit.add("3688", sx, sy, peak, DBG)
    finial(kit, sx, sy, peak + 6)
    return top


def round_tower(kit: Kit, x: int, y: int, s: int, courses: int, z: int = Z, cap: bool = True) -> int:
    """A round tower of 2x2, 4x4 or 8x8 bricks with a slate cone and a gold finial; returns the shaft's top."""
    for c in range(courses):
        color = DTAN if c == 0 or c % 8 == 7 else TAN
        zc = z + 3 * c
        if s == 8:
            for dx, dy, rotation in ((0, 0, 90), (4, 0, 0), (0, 4, 180), (4, 4, 270)):
                kit.add("48092", x + dx, y + dy, zc, color, rotation)
        else:
            kit.add({2: "3941", 4: "87081"}[s], x, y, zc, color)
    top = z + 3 * courses
    if cap:
        cone(kit, x, y, s, top)
    return top


def cone(kit: Kit, x: int, y: int, s: int, z: int) -> None:
    if s == 8:
        kit.add("48310", x, y, z, DBG)
        kit.add("48310", x, y + 4, z, DBG, 180)
        x, y, s, z = x + 2, y + 2, 4, z + 18
    if s == 4:
        kit.add("272", x, y, z, DBG)
        x, y, z = x + 1, y + 1, z + 9
    kit.add("3942c", x, y, z, DBG)
    finial(kit, x, y, z + 6)


def astronomy(kit: Kit, x: int, y: int) -> None:
    """The tallest tower: a square base, a slender round shaft, a gallery of pinnacles, and a tall cone."""
    base = hall_block(kit, x - 2, y - 2, 8, 8, 12)
    top = round_tower(kit, x, y, 4, 22, base, cap=False)
    kit.fill(x - 1, y - 1, 6, 6, top, DTAN)
    for cx, cy in ((x - 1, y - 1), (x + 4, y - 1), (x - 1, y + 4), (x + 4, y + 4)):
        pinnacle(kit, cx, cy, top + 1, 3)
    top = round_tower(kit, x, y, 4, 6, top + 1, cap=False)
    cone(kit, x, y, 4, top)


def hall_block(kit: Kit, x0: int, y0: int, w: int, d: int, courses: int) -> int:
    """Walls with windows under a flat cornice, as a base for a tower; returns the cornice's top."""
    top = kit.ring(x0, y0, w, d, Z, courses, facade(x0, y0, w, d, slits(courses)))
    kit.fill(x0, y0, w, d, top, DTAN)
    return top + 1


GREAT_HALL = lambda u, c: u % 3 != 0 and 1 <= c <= 7
CASTLE = [
    ("Ravenclaw Tower, the great round tower", [("round", 28, 40, 8, 8, 28)]),
    ("Entrance Hall", [("hall", 36, 40, 8, 10, 12)]),
    ("The Great Hall, its lancet windows lit", [("great hall", 44, 37, 28, 8, 10)]),
    ("Great Hall tower", [("square", 72, 36, 6, 6, 24)]),
    ("Clock Tower and the hospital wing", [("hall", 78, 36, 10, 6, 9), ("square", 88, 36, 6, 6, 18)]),
    ("Astronomy Tower", [("astronomy", 54, 50, 8, 8, 12)]),
    ("Courtyard wings", [("hall", 44, 46, 10, 8, 11), ("hall", 62, 46, 16, 8, 12)]),
    ("Gryffindor Tower", [("square", 80, 50, 6, 6, 32), ("hall", 86, 48, 10, 8, 9)]),
    ("Transfiguration wing", [("hall", 28, 52, 16, 8, 10)]),
    ("Headmaster's Tower", [("round", 66, 58, 4, 4, 34)]),
    ("Library and north wings", [("hall", 44, 60, 20, 8, 10), ("hall", 70, 60, 20, 8, 9)]),
    (
        "Towers and turrets",
        [
            ("round", 36, 62, 4, 4, 20),
            ("round", 92, 58, 4, 4, 16),
            ("round", 28, 62, 4, 4, 14),
            ("round", 42, 50, 2, 2, 16),
            ("round", 78, 46, 2, 2, 15),
            ("round", 72, 42, 2, 2, 15),
            ("round", 26, 50, 2, 2, 12),
            ("round", 54, 58, 2, 2, 18),
        ],
    ),
]
"""Steps of (kind, x, y, w, d, courses) on the crag top, front to back."""


def footprints() -> list[tuple[int, int, int, int]]:
    return [
        (x, y - (kind == "great hall"), w, d + (kind == "great hall"))
        for _, parts in CASTLE
        for kind, x, y, w, d, _ in parts
    ]


async def castle(kit: Kit) -> None:
    for title, parts in CASTLE:
        for kind, x, y, w, d, courses in parts:
            if kind == "round":
                round_tower(kit, x, y, w, courses)
            elif kind == "square":
                square_tower(kit, x, y, w, courses)
            elif kind == "hall":
                hall(kit, x, y, w, d, courses)
            elif kind == "great hall":
                hall(kit, x, y, w, d, courses, window=GREAT_HALL, lit=LIT, buttresses=("front",))
            elif kind == "astronomy":
                astronomy(kit, x + 2, y + 2)
        await kit.step(title)


async def build() -> Kit:
    kit = Kit("hogwarts", "Hogwarts", PROMPT, W, D)
    rng = random.Random(7)
    ground = Ground(kit, rng)
    await ground.lake()
    await ground.mesh()
    await ground.surface({"castle": lambda x, y: LBG, "stairs": lambda x, y: TAN, "boathouse": lambda x, y: DTAN})
    await castle(kit)
    kit.save(STORY)
    return kit
