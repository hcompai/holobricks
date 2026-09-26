"""Westminster, London: a 48x48 microscale diorama."""

from __future__ import annotations

import random

from brickyard.showcase.kit import TILE_RUN, TILES, Frame, Kit, rect
from brickyard.showcase.paris import tree

BLACK, WHITE, BLUE, GREEN, RED, BGREEN, DGREEN, DRED = 0, 15, 1, 2, 4, 10, 288, 320
LBG, DBG, VLBG, TAN, DTAN, PGOLD, DBLUE, SBLUE = 71, 72, 151, 19, 28, 297, 272, 379
TBLACK, TYELLOW, TORANGE = 40, 46, 57

W = D = 48
GROUND = 8
RIVER = 14
PAVILIONS = [(2, 16, 6, 8, 6, True), (8, 16, 14, 8, 5, False), (22, 16, 6, 8, 6, True)]
BACK = (8, 28, 20, 6)
VICTORIA = (1, 24, 6, 6)
LANTERN = (13, 24, 4, 4)
CLOCK = (30, 16, 4, 4)
RIBS = [*range(2, 28, 2), 27]
ROADS = rect(37, RIVER, 4, D - RIVER) | rect(0, 34, 41, 4)
ZEBRA = rect(37, 24, 4, 4)
GRASS = rect(2, 39, 30, 8)
PATHS = rect(16, 39, 2, 8) | rect(2, 42, 30, 2)
WATER = [(DBLUE, 6), (SBLUE, 3), (BLUE, 1)]

PROMPT = "Westminster in London, microscale diorama with Big Ben, the Houses of Parliament and the Thames"
STORY = [
    (
        "Hand-scripted by Claude, as a showcase of what Brickyard's parts and checks can do. Every step went through "
        "the same validation Holo uses; ask for a change and Holo takes over."
    ),
    (
        "Nods: Elizabeth Tower with its four clock faces, the Houses of Parliament's Gothic river front and Victoria "
        "Tower, the green Westminster Bridge with a Routemaster and a black cab, a Thames tour boat, a zebra crossing "
        "with Belisha beacons, red phone boxes, a pillar box, the Red Lion pub and Churchill in Parliament Square."
    ),
]


def column(kit: Kit, x: int, y: int, z: int, courses: int, color: int) -> int:
    for _ in range(courses // 3):
        kit.add("14716", x, y, z, color)
        z += 9
    for _ in range(courses % 3):
        kit.add("3005", x, y, z, color)
        z += 3
    return z


async def base(kit: Kit) -> None:
    kit.fill(0, 0, W, D, 0, BLACK)
    await kit.step("Base plate")
    kit.ring(0, RIVER, W, D - RIVER, 1, 2, lambda x, y, c: LBG if y == RIVER else DBG)
    await kit.step("Embankment and base walls")
    kit.fill(0, RIVER, W, D - RIVER, 7, DBG)
    walls = {c for c in rect(0, RIVER, W, D - RIVER) if c[0] in (0, W - 1) or c[1] in (RIVER, D - 1)}
    plates = kit.support(7, walls, [("3005", 3), ("3005", 3)], DBG)
    await kit.step("Hidden base pillars")
    kit.pending = plates
    await kit.step("Top plates")


async def thames(kit: Kit, rng: random.Random) -> None:
    piers = {(x, y) for x in range(36, 42) for y in (4, 9)}
    sides = {(x, y) for x in (36, 41) for y in range(RIVER)}
    kit.mosaic(0, 0, W, RIVER, 1, WATER, rng, piers | sides)
    await kit.step("The Thames")
    for x, y in ((6, 7), (22, 2)):
        kit.add("3034", x, y, 2, WHITE)
        kit.add("3034", x, y, 3, BLUE)
        kit.add("2456", x, y, 4, TBLACK)
        kit.add("3039", x + 6, y, 4, WHITE, 270)
        kit.add("3795", x, y, 7, WHITE)
    await kit.step("Tour boats")


def lamp(kit: Kit, x: int, y: int, color: int) -> None:
    for c in range(3):
        kit.add("3062b", x, y, GROUND + 1 + 3 * c, color)
    kit.add("3062b", x, y, GROUND + 10, TYELLOW)
    kit.add("4589", x, y, GROUND + 13, color)


def bus(kit: Kit, x: int, y: int, axis: str = "y") -> None:
    turn = 90 if axis == "y" else 0
    strips = [(x, y), (x + 1, y)] if axis == "y" else [(x, y), (x, y + 1)]
    z = GROUND + 1
    kit.add("3795", x, y, z, BLACK, turn)
    kit.add("2456", x, y, z + 1, RED, turn)
    for level in (z + 4, z + 6):
        for sx, sy in strips:
            kit.add("3666", sx, sy, level, TBLACK, turn)
        kit.add("3795", x, y, level + 1, RED, turn)


def cab(kit: Kit, x: int, y: int, axis: str = "y") -> None:
    z = GROUND + 1
    if axis == "y":
        kit.add("3020", x, y, z, BLACK, 90)
        kit.add("3020", x, y, z + 1, BLACK, 90)
        kit.add("3039", x, y + 1, z + 2, TBLACK)
        kit.add("3004", x, y + 3, z + 2, BLACK)
    else:
        kit.add("3020", x, y, z, BLACK)
        kit.add("3020", x, y, z + 1, BLACK)
        kit.add("3039", x + 1, y, z + 2, TBLACK, 90)
        kit.add("3004", x + 3, y, z + 2, BLACK, 90)


async def bridge(kit: Kit) -> None:
    for y in (4, 9):
        for c in range(2):
            kit.run(36, y, 1 + 3 * c, 6, LBG)
    for y in (0, 5, 10):
        for x in (36, 41):
            kit.add("6182", x, y, 1, GREEN, 90)
    await kit.step("Westminster Bridge piers and arches")
    kit.fill(36, 0, 6, RIVER, 7, GREEN)
    await kit.step("Bridge deck")
    kit.fill(37, 0, 4, RIVER, GROUND, DBG, TILES)
    for x in (36, 41):
        kit.run(x, 0, GROUND, RIVER, LBG, "y", TILE_RUN)
    await kit.step("Bridge road and pavements")
    for x in (36, 41):
        for y in (0, 5, 10):
            kit.add("3633", x, y, GROUND + 1, GREEN, 90)
        for y in (4, 9):
            lamp(kit, x, y, GREEN)
    await kit.step("Parapets and lamps")
    bus(kit, 37, 2)
    cab(kit, 39, 8)
    await kit.step("A Routemaster and a black cab on the bridge")


async def streets(kit: Kit, rng: random.Random, footprints: set[tuple[int, int]]) -> None:
    kit.cover(ROADS - ZEBRA, GROUND, DBG, TILES)
    for x in (37, 39):
        kit.add("2431", x, 24, GROUND, WHITE, 90)
    kit.cover(ZEBRA - rect(37, 24, 1, 4) - rect(39, 24, 1, 4), GROUND, DBG, TILES)
    await kit.step("Bridge Street and Parliament Square roads, zebra crossing")
    kit.cover(PATHS & GRASS, GROUND, TAN, TILES)
    kit.scatter(GRASS - PATHS, GROUND, [(GREEN, 4), (BGREEN, 2), (DGREEN, 1)], rng)
    await kit.step("Parliament Square lawn")
    land = rect(0, RIVER, W, D - RIVER) - ROADS - GRASS - footprints
    kit.scatter(land, GROUND, [(VLBG, 5), (LBG, 4), (TAN, 1)], rng)
    await kit.step("Paving")


def gothic(kit: Kit, x0: int, y0: int, w: int, d: int, courses: int, steep: bool) -> None:
    """A Parliament block: plinth, walls with a tight grid of lancet windows, a slab and a slate roof."""

    def glass(x, y, c):
        side = x in (x0, x0 + w - 1) and y not in (y0, y0 + d - 1)
        i, n = (y - y0, d) if side else (x - x0, w)
        return 0 < i < n - 1 and i % 2 == 1 and c % 3 != 0

    z = kit.ring(x0, y0, w, d, GROUND, 1, DTAN)
    z = kit.ring(x0, y0, w, d, z, courses, lambda x, y, c: TBLACK if glass(x, y, c) else TAN, start=1)
    kit.fill(x0, y0, w, d, z, TAN)
    slope, rise = ("4460b", 9) if steep else ("3040b", 3)
    x, y, rw, rd, top = kit.hip(x0, y0, w, d, z + 1, DBG, slope=slope, rise=rise)
    kit.ridge(x, y, rw, rd, top, DBG)


async def parliament(kit: Kit) -> None:
    for n, (x0, y0, w, d, courses, steep) in enumerate(PAVILIONS, 1):
        gothic(kit, x0, y0, w, d, courses, steep)
        await kit.step(f"Houses of Parliament, river front block {n}")
    for x in RIBS:
        courses = 1 + next(c for x0, _, w, _, c, _ in PAVILIONS if x0 <= x < x0 + w)
        top = column(kit, x, 15, GROUND, courses, DTAN)
        kit.add("4589", x, 15, top, DTAN)
    await kit.step("Buttresses and pinnacles along the river front")
    gothic(kit, *BACK, 4, False)
    await kit.step("Back range")
    for x in (5, 13, 21):
        lamp(kit, x, 14, BLACK)
    await kit.step("Embankment lamps")


async def victoria_tower(kit: Kit) -> None:
    x0, y0, w, d = VICTORIA
    arch = {(x, y0) for x in range(x0 + 1, x0 + 5)}

    def color(x, y, c):
        if x in (x0, x0 + w - 1) and y in (y0, y0 + d - 1):
            return DTAN
        i = x - x0 if y in (y0, y0 + d - 1) else y - y0
        return TBLACK if i in (2, 3) and c % 3 != 0 and c > 2 else TAN

    kit.add("6182", x0 + 1, y0, GROUND, DTAN)
    kit.add("3004", x0 + 2, y0 + 1, GROUND, BLACK)
    kit.add("3004", x0 + 2, y0 + 1, GROUND + 3, BLACK)
    z = kit.ring(x0, y0, w, d, GROUND, 1, DTAN, lambda x, y, c: (x, y) in arch)
    z = kit.ring(x0, y0, w, d, z, 28, color, lambda x, y, c: c == 1 and (x, y) in arch, start=1)
    await kit.step("Victoria Tower and the Sovereign's Entrance")
    kit.fill(x0, y0, w, d, z, TAN)
    z += 1
    corners = {(x0, y0), (x0 + w - 1, y0), (x0, y0 + d - 1), (x0 + w - 1, y0 + d - 1)}
    kit.ring(x0, y0, w, d, z, 1, TAN, lambda x, y, c: (x + y) % 2 == 1 or (x, y) in corners)
    for x, y in corners:
        top = column(kit, x, y, z, 2, TAN)
        kit.add("4589", x, y, top, DTAN)
    kit.add("3957a", x0 + 2, y0 + 2, z, BLACK)
    await kit.step("Victoria Tower battlements, corner pinnacles and flagpole")


async def central_spire(kit: Kit) -> None:
    x, y, _, _ = LANTERN
    sides = [(x + 1, y, 0), (x + 3, y + 1, 90), (x + 1, y + 3, 0), (x, y + 1, 90)]
    z = GROUND
    for c in range(16):
        for px, py, turn in sides:
            kit.add("3004", px, py, z, TBLACK if c > 9 and c % 3 != 0 else TAN, turn)
        kit.add("3003", x + 1, y + 1, z, DTAN)
        z += 3
    kit.add("272", x, y, z, DBG)
    kit.add("3942c", x + 1, y + 1, z + 9, DBG)
    await kit.step("Central octagonal tower and spire")


async def elizabeth_tower(kit: Kit) -> None:
    x0, y0, w, d = CLOCK

    def shaft(x, y, c):
        if x in (x0, x0 + w - 1) and y in (y0, y0 + d - 1):
            return DTAN
        return TBLACK if c % 4 in (1, 2) else TAN

    z = kit.ring(x0, y0, w, d, GROUND, 1, DTAN)
    z = kit.ring(x0, y0, w, d, z, 21, shaft, start=1)
    await kit.step("Elizabeth Tower shaft")
    kit.fill(x0 - 1, y0 - 1, w + 2, d + 2, z, DTAN)
    z += 1
    kit.ring(x0 - 1, y0 - 1, w + 2, d + 2, z, 2, TAN)
    kit.mount("4150p03", x0 + 1, y0 - 2, z, WHITE, "south")
    kit.mount("4150p03", x0 + 1, y0 + d + 1, z, WHITE, "north")
    kit.mount("4150p03", x0 - 2, y0 + 1, z, WHITE, "west")
    kit.mount("4150p03", x0 + w + 1, y0 + 1, z, WHITE, "east")
    z += 6
    await kit.step("Clock stage with four faces")
    kit.fill(x0 - 1, y0 - 1, w + 2, d + 2, z, DTAN)
    z += 1
    for x, y in ((x0 - 1, y0 - 1), (x0 + w, y0 - 1), (x0 - 1, y0 + d), (x0 + w, y0 + d)):
        kit.add("3062b", x, y, z, TAN)
        kit.add("4589", x, y, z + 3, PGOLD)
    corner = {(x0, y0), (x0 + w - 1, y0), (x0, y0 + d - 1), (x0 + w - 1, y0 + d - 1)}
    z = kit.ring(x0, y0, w, d, z, 2, lambda x, y, c: TAN if (x, y) in corner else BLACK)
    kit.fill(x0, y0, w, d, z, PGOLD)
    await kit.step("Belfry and gilded pinnacles")
    x, y, _, _, top = kit.hip(x0, y0, w, d, z + 1, DBG, slope="4460b", rise=9)
    kit.add("3688", x, y, top, DBG)
    await kit.step("Spire")


def pub(kit: Kit, frame: Frame) -> None:
    """The Red Lion: green pub front with lit windows, two red-brick floors, a slate roof."""
    x0, y0, w, d = frame.rect
    L = frame.length
    facade = {frame.cell(u, 0) for u in range(L)}
    windows = [1, 5, 9]
    z = GROUND
    kit.ring(x0, y0, w, d, z, 3, DGREEN, lambda x, y, c: (x, y) in facade)
    frame.put("14716", 0, 0, z, DGREEN)
    frame.put("14716", L - 1, 0, z, DGREEN)
    for u in range(1, L - 1, 2):
        frame.put("60593", u, 0, z, DGREEN)
        for c in range(3):
            frame.run(u, 1, z + 3 * c, 2, TYELLOW)
    z += 9
    z = kit.ring(x0, y0, w, d, z, 1, lambda x, y, c: PGOLD if (x, y) in facade else DGREEN, start=1)
    for floor in range(2):
        kit.fill(x0, y0, w, d, z, DRED)
        z += 1
        glass = {frame.cell(u + i, 0) for u in windows for i in (0, 1)} | {frame.cell(L - 1, v) for v in (2, 3)}
        for c in range(2):
            for u in windows:
                frame.put("3004", u, 1, z + 3 * c, BLACK)
            frame.put("3004", L - 2, 2, z + 3 * c, BLACK, 90)
        kit.ring(x0, y0, w, d, z, 2, DRED, lambda x, y, c, glass=glass: (x, y) in glass, start=floor)
        for u in windows:
            frame.put("60592", u, 0, z, WHITE)
        frame.put("60592", L - 1, 2, z, WHITE, 270)
        z += 6
    kit.fill(x0, y0, w, d, z, WHITE)
    x, y, rw, rd, top = kit.hip(x0, y0, w, d, z + 1, DBG)
    kit.ridge(x, y, rw, rd, top, DBG)


async def street_life(kit: Kit, red_lion: Frame) -> None:
    pub(kit, red_lion)
    await kit.step("The Red Lion pub")
    z = GROUND + 1
    for x in (35, 42):
        for c, color in enumerate((BLACK, WHITE, BLACK)):
            kit.add("3062b", x, 24, z + 3 * c, color)
        kit.add("3062b", x, 24, z + 9, TORANGE)
    await kit.step("Belisha beacons")
    for x in (44, 45):
        kit.add("14716", x, 27, z, RED)
        kit.add("3024", x, 27, z + 9, RED)
        kit.add("98138", x, 27, z + 10, RED)
    kit.add("6141", 42, 28, z, BLACK)
    kit.add("3062b", 42, 28, z + 1, RED)
    kit.add("3062b", 42, 28, z + 4, RED)
    kit.add("98138", 42, 28, z + 7, BLACK)
    await kit.step("Phone boxes and a pillar box")
    for x, y in ((43, 15), (43, 21), (29, 23), (29, 28)):
        tree(kit, x, y, (GREEN, DGREEN, GREEN))
    for x, y in ((3, 39), (8, 44), (26, 44), (27, 38)):
        tree(kit, x, y, (BGREEN, GREEN, BGREEN))
    await kit.step("Plane trees")
    kit.add("3003", 22, 40, z, LBG)
    kit.add("3003", 22, 40, z + 3, LBG)
    kit.add("3005", 22, 40, z + 6, DBG)
    kit.add("3062b", 22, 40, z + 9, DBG)
    await kit.step("Churchill statue")
    bus(kit, 39, 29)
    cab(kit, 37, 17)
    bus(kit, 8, 34, "x")
    cab(kit, 24, 36, "x")
    await kit.step("Traffic")


async def build() -> Kit:
    kit = Kit("Westminster", PROMPT, W, D)
    rng = random.Random(11)
    red_lion = Frame(kit, 42, 30, 12, 6, "west")
    footprints = (
        set().union(*(rect(x0, y0, w, d) for x0, y0, w, d, _, _ in PAVILIONS))
        | rect(*BACK)
        | rect(*VICTORIA)
        | rect(*LANTERN)
        | rect(*CLOCK)
        | rect(*red_lion.rect)
        | {(x, 15) for x in RIBS}
    )
    await base(kit)
    await thames(kit, rng)
    await bridge(kit)
    await streets(kit, rng, footprints)
    await parliament(kit)
    await victoria_tower(kit)
    await central_spire(kit)
    await elizabeth_tower(kit)
    await street_life(kit, red_lion)
    kit.save(STORY)
    return kit
