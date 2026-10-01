"""London, Mind the Gap: a 32x32 microscale slice from a Tube platform up to Big Ben, with Tower Bridge on the Thames."""

from __future__ import annotations

import random

from brickyard.shapes import BRICKS, PLATES, TILE_RUN, TILES, rect
from brickyard.showcase.kit import Kit
from brickyard.showcase.paris import EMBOSSED, bench, lamp, plane

BLACK, WHITE, BLUE, GREEN, RED, BGREEN, DGREEN, DRED = 0, 15, 1, 2, 4, 10, 288, 320
LBG, DBG, VLBG, TAN, DTAN, PGOLD, DBLUE, SBLUE = 71, 72, 151, 19, 28, 297, 272, 379
TBLACK, TYELLOW, TORANGE, RBROWN, DORANGE, YELLOW = 40, 46, 57, 70, 484, 14
PINK, LBLUE, LYELLOW, MBLUE, ORANGE, AZURE = 13, 212, 226, 73, 191, 322

W = D = 32
GROUND = 14
PLATFORM = 4
QUAY = 19
RIVER = rect(QUAY + 1, 0, W - QUAY - 1, D)
TOWERS = (20, 28)
BOAT = (26, 12, 2, 8)
BARGE = (21, 21, 2, 7)
STATION = rect(0, 0, QUAY, 9)
PIERS = (1, 6, 7, 12, 13, 18)
TRAIN = (6, 1, 12, 2)
CAB = 17
DOORS = {8, 9, 13, 14}
STAIRS = [(7, 13), (8, 11), (9, 9), (10, 7)]
OPENING = rect(7, 6, 4, 2)
PIT = rect(1, 9, 8, 2)
BASEMENT = rect(1, 11, 8, 1)
ROADS = rect(0, 1, W, 4) | rect(12, 5, 2, D - 5)
ZEBRA = rect(14, 1, 4, 4)
PALACE = (14, 10, 6, 12)
YARD = rect(14, 22, 6, 10)
CLOCK = (15, 25, 4, 4)
TERRACE = (0, 11, 12, 7)
PUB = 9
HOUSES = [(6, PINK, RED), (3, LBLUE, BLACK), (0, LYELLOW, DBLUE)]
GARDEN = rect(5, 19, 7, 13)
PLAZA = rect(0, 18, 5, 14)
GHERKIN = (1, 25)
EMBANKMENT = {(QUAY, y) for y in (*range(6, 10), *range(22, D))}
WATER = [(DBLUE, 4), (SBLUE, 3), (33, 1)]

PROMPT = "London, Mind the Gap: a 32x32 microscale diorama from a Tube platform up to Big Ben, with Tower Bridge"
STORY = [
    (
        "Hand-scripted by Claude, as a showcase of what HoloBricks' parts and checks can do. Every step went through "
        "the same validation Holo uses; ask for a change and Holo takes over."
    ),
    (
        "A slice of London in three levels: under the street, a Tube train waits at a platform behind Victorian brick "
        "arches, with a roundel on the tiled wall and stairs up to the pavement. Above, a Routemaster rolls under "
        "Tower Bridge's twin Gothic towers and blue walkway; a zebra crossing with Belisha beacons, red phone boxes, a "
        "pillar box, a corner pub and pastel terraces over lit basement areas; Parliament and Big Ben on the Thames, a "
        "tour boat and a red-sailed barge, a London plane in a railed garden square and the Gherkin behind."
    ),
]


def _block(x: int, y: int, c: int) -> int:
    if x == QUAY:
        return DBG if c == 0 or (3 * y + 5 * c) % 7 == 0 else LBG
    return RBROWN if y == 0 else DBG


def _tiles(x: int, z: int) -> int:
    r = z - 6
    if r == 3 and 12 <= x <= 17:
        return BLUE
    if r in (0, 6) and x in (14, 15):
        return RED
    if r in (1, 2, 4, 5) and x in (13, 16):
        return RED
    if r in (1, 2, 4, 5) and x in (14, 15):
        return WHITE
    if 6 <= z <= 10 and 3 <= x <= 5:
        return ORANGE
    if 6 <= z <= 10 and 1 <= x <= 2:
        return AZURE
    return DBG if z == PLATFORM else TAN


def _paint(kit: Kit, cells: set[tuple[int, int]], z: int, shade, sizes=BRICKS) -> None:
    """Covers cells in groups of the same `shade(x, y)` so no part spans two colors."""
    groups: dict[int, set[tuple[int, int]]] = {}
    for x, y in cells:
        groups.setdefault(shade(x, y), set()).add((x, y))
    for color, group in sorted(groups.items()):
        kit.cover(group, z, color, sizes)


def base(kit: Kit, rng: random.Random) -> None:
    kit.fill(0, 0, W, D, 0, BLACK)
    kit.step("Base plate")
    river = RIVER - rect(20, 0, 4, 6) - rect(28, 0, 4, 6) - rect(*BOAT) - rect(*BARGE)
    kit.cover(river, 1, DBLUE)
    kit.scatter(river, 2, WATER, rng)
    kit.step("The Thames")
    kit.ring(0, 0, QUAY + 1, D, 1, 4, _block, lambda x, y, c: y == 0 and 1 <= x < QUAY, EMBOSSED)
    for x in PIERS:
        for z in (1, 4):
            kit.add("3005", x, 0, z, RBROWN)
    for x in PIERS[::2]:
        kit.add("15254", x, 0, 7, RBROWN)
    for y in range(8, D, 4):
        kit.mount("98138", QUAY + 1, y, 6, PGOLD, "east")
    kit.step("Granite Embankment with bronze lion heads, brick arches over the station")


def station(kit: Kit) -> None:
    piers = {(x, 0) for x in PIERS}
    kit.cover(rect(1, 0, 18, 4) - piers, 1, DBG)
    for y in (1, 2):
        kit.run(1, y, 2, 18, LBG, "x", TILE_RUN)
    kit.cover(rect(1, 0, 18, 1) - piers | rect(1, 3, 18, 1), 2, DBG, TILES)
    kit.cover(rect(1, 4, 18, 5), 1, DBG, BRICKS)
    kit.step("Track bed, rails and the platform")
    stairs = {(x, y) for x, _ in STAIRS for y in (6, 7)}
    kit.cover(rect(1, 4, 18, 1), PLATFORM, YELLOW, TILES)
    kit.cover(rect(1, 5, 18, 3) - stairs, PLATFORM, LBG, TILES)
    for z in range(PLATFORM, 13):
        _paint(kit, {(x, 8) for x in range(1, QUAY)}, z, lambda x, y, z=z: _tiles(x, z), PLATES)
    kit.step("Mind the gap, and a tiled wall with the roundel and posters")
    for x, top in STAIRS:
        body = top - 1 - PLATFORM
        for c in range(body // 3):
            kit.add("3004", x, 6, PLATFORM + 3 * c, LBG, 90)
        for p in range(body % 3):
            kit.add("3023b", x, 6, PLATFORM + 3 * (body // 3) + p, LBG, 90)
        kit.add("3069b", x, 6, top - 1, DBG, 90)
    bench(kit, 2, 6, "x", PLATFORM)
    kit.step("Stairs up to the street and a platform bench")
    cells = rect(*TRAIN)
    kit.cover(cells, 3, BLUE)
    _paint(kit, cells, 4, lambda x, y: RED if x == CAB or x in DOORS else WHITE)
    _paint(
        kit,
        cells,
        7,
        lambda x, y: RED if x in DOORS else TBLACK if x == CAB else WHITE if x in (6, 11, 16) else TBLACK,
    )
    kit.cover(cells, 10, LBG)
    kit.step("A Tube train with red doors")
    for x in range(1, QUAY, 2):
        kit.add("3795" if x in (7, 9) else "3034", x, 0, 13, DBG, 90)
    kit.add("3460", 0, 0, 13, DBG, 90)
    kit.cover(rect(0, 8, QUAY, 1), 13, DBG)
    kit.step("Station ceiling")


def street_plates(kit: Kit) -> None:
    for y in (9, 10):
        for z in range(1, 13, 3):
            kit.add("3005", 9, y, z, WHITE)
    kit.step("Area wall")
    kit.cover(PIT | BASEMENT, 7, DBG)
    kit.step("Basement area floor")
    kit.cover(PIT, 8, DBG, TILES)
    lit = {(h + i, 11) for h, _, _ in HOUSES for i in (1, 2)}
    kit.cover(lit & BASEMENT, 8, TYELLOW, BRICKS)
    kit.cover(BASEMENT - lit, 8, WHITE, BRICKS)
    for z in (11, 12):
        kit.cover(BASEMENT, z, WHITE)
    kit.step("Lit basement windows below the terraces")
    kit.cover(rect(0, 0, QUAY + 1, D) - STATION - PIT, 13, DBG)
    kit.step("Street plates")


def tower_bridge(kit: Kit) -> None:
    towers = [rect(x0, 0, 4, 6) for x0 in TOWERS]
    piers = set().union(*towers)
    for z in range(1, 13, 3):
        kit.cover(piers, z, DBG if z == 1 else VLBG, BRICKS)
    kit.cover(rect(QUAY + 1, 0, W - QUAY - 1, 6), 13, LBG)
    kit.step("Tower Bridge piers and deck")
    legs = {(x, y) for x, y in piers if y in (0, 5)}
    springs = {(x, y) for x0 in TOWERS for x in (x0, x0 + 3) for y in (0, 5)}
    glass = {(x, y) for x, y in legs if (x, y) not in springs}
    for z in range(GROUND, GROUND + 9, 3):
        lit = glass if z > GROUND else set()
        kit.cover(legs - lit, z, VLBG, BRICKS)
        kit.cover(legs & lit, z, TBLACK, BRICKS)
    for x0 in TOWERS:
        for x in (x0, x0 + 3):
            kit.add("15254", x, 0, GROUND + 9, LBG, 90)
    for z in (GROUND + 9, GROUND + 12):
        kit.cover(legs - springs, z, VLBG, BRICKS)
    kit.cover(piers, GROUND + 15, LBG)
    kit.step("Tower legs astride the road, Gothic arches")

    def stone(x: int, y: int, c: int) -> int:
        if (x, y) in springs:
            return LBG
        return TBLACK if (y in (0, 5) or y in (2, 3)) and c % 3 else VLBG

    z = GROUND + 16
    for x0 in TOWERS:
        kit.ring(x0, 0, 4, 6, z, 1, stone)
    kit.step("Two towers with lancet windows")
    z += 3
    walkway = rect(TOWERS[0] + 3, 1, 6, 4)
    kit.cover(walkway, z, MBLUE)
    kit.cover(piers - walkway, z, LBG)
    for y in (1, 4):
        kit.add("3185", TOWERS[0] + 4, y, z + 1, MBLUE)
    kit.cover(rect(TOWERS[0] + 4, 1, 4, 4), z + 7, MBLUE)
    for x0 in TOWERS:
        kit.ring(x0, 0, 4, 6, z + 1, 3, stone, start=3)
    z += 10
    kit.cover(piers, z, LBG)
    kit.step("High-level walkways in blue lattice")
    z += 1
    spires = {(x0 + i, 2 + j) for x0 in TOWERS for i in (1, 2) for j in (0, 1)}
    for x, y in sorted(springs):
        kit.add("3062b", x, y, z, VLBG)
        kit.add("3062b", x, y, z + 3, VLBG)
        kit.add("4589", x, y, z + 6, DBG)
    for x0 in TOWERS:
        kit.add("3003", x0 + 1, 2, z, VLBG)
        kit.add("3003", x0 + 1, 2, z + 3, VLBG)
        kit.add("3688", x0 + 1, 2, z + 6, DBG)
    kit.cover(piers - springs - spires, z, LBG, TILES)
    kit.step("Corner turrets and slate spires")
    for y in (0, 5):
        kit.add("3633", TOWERS[0] + 4, y, GROUND, MBLUE)
        kit.run(TOWERS[0] + 4, y, GROUND + 3, 4, WHITE, "x", TILE_RUN)
    kit.step("Bascule parapets")


def barge(kit: Kit) -> None:
    x0, y0, w, d = BARGE
    kit.fill(x0, y0, w, d, 1, BLACK, BRICKS)
    kit.fill(x0, y0, w, d, 4, RBROWN)
    kit.step("Thames sailing barge hull")
    x = x0 + 1
    for z, y, n in ((5, y0 + 1, 4), (8, y0 + 1, 4), (11, y0 + 2, 3), (14, y0 + 2, 3), (17, y0 + 3, 2), (20, y0 + 4, 1)):
        kit.run(x, y, z, n, RBROWN, "y")
    kit.add("3957b", x, y0 + 5, 5, BLACK)
    kit.step("Red-brown sails")


def boat(kit: Kit) -> None:
    x0, y0, w, d = BOAT
    kit.fill(x0, y0, w, d, 1, DBLUE, BRICKS)
    kit.fill(x0, y0, w, d, 4, WHITE)
    kit.step("Tour boat hull")
    kit.add("2456", x0, y0, 5, TBLACK, 90)
    kit.add("3039", x0, y0 + 6, 5, WHITE, 180)
    kit.add("3795", x0, y0, 8, WHITE, 90)
    kit.step("Tour boat cabin")


def streets(kit: Kit) -> None:
    kit.cover(ROADS - ZEBRA, GROUND, DBG, TILES)
    for y in (1, 3):
        kit.add("2431", 14, y, GROUND, WHITE)
    kit.cover(rect(14, 2, 4, 1) | rect(14, 4, 4, 1), GROUND, DBG, TILES)
    kit.step("Tower Bridge Road, a side street and a zebra crossing")
    railings = rect(11, 6, 1, 2) | rect(7, 5, 4, 1) | rect(7, 8, 4, 1) | rect(4, 8, 2, 1) | rect(1, 8, 2, 1)
    steps = {(h, 8) for h, _, _ in HOUSES}
    over = {(x, y) for x, _ in steps for y in (8, 9, 10)}
    built = rect(*PALACE) | YARD | rect(*TERRACE) | GARDEN | PLAZA
    street = rect(0, 0, QUAY + 1, D) - ROADS - built - OPENING - PIT - EMBANKMENT - railings - over
    kerb = {(x, y) for x, y in street if {(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)} & ROADS}
    kit.cover(kerb, GROUND, LBG, TILES)
    kit.cover(street - kerb, GROUND, VLBG, TILES)
    kit.step("Pavements")
    kit.cover(EMBANKMENT, GROUND, LBG, BRICKS)
    lamps = {(QUAY, 7), (QUAY, 26)}
    kit.cover(EMBANKMENT - lamps, GROUND + 3, LBG, TILES)
    for x, y in sorted(lamps):
        for i, color in enumerate((DGREEN, BLACK, TYELLOW)):
            kit.add("3062b", x, y, GROUND + 3 + 3 * i, color)
        kit.add("4589", x, y, GROUND + 12, BLACK)
    kit.step("Embankment parapet with dolphin lamps")
    for x, y in ((11, 6), (11, 7)):
        kit.add("3062b", x, y, GROUND, BLACK)
    for y in (5, 8):
        kit.add("3633", 7, y, GROUND, BLACK)
    for x in (1, 4):
        kit.add("2877", x, 8, GROUND, BLACK)
    for x, y in sorted(steps):
        kit.add("3623", x, y, GROUND, WHITE, 90)
    kit.step("Railings round the Tube stairs and the basement areas, front steps over them")


def gothic(kit: Kit, x0: int, y0: int, w: int, d: int, courses: int) -> None:
    """A Parliament block: plinth, walls with a tight grid of lancet windows, a slab and a steep slate roof."""

    def glass(x, y, c):
        side = x in (x0, x0 + w - 1) and y not in (y0, y0 + d - 1)
        i, n = (y - y0, d) if side else (x - x0, w)
        return 0 < i < n - 1 and i % 2 == 1 and c % 3 != 0

    z = kit.ring(x0, y0, w, d, GROUND, 1, DTAN)
    z = kit.ring(x0, y0, w, d, z, courses, lambda x, y, c: TBLACK if glass(x, y, c) else TAN, start=1)
    kit.fill(x0, y0, w, d, z, TAN)
    x, y, rw, rd, top = kit.hip(x0, y0, w, d, z + 1, DBG, slope="4460b", rise=9)
    kit.ridge(x, y, rw, rd, top, DBG)


def westminster(kit: Kit, rng: random.Random) -> None:
    gothic(kit, *PALACE, 4)
    kit.step("The Palace of Westminster on the river")
    shaft = rect(*CLOCK)
    path = rect(15, 22, 4, 3)
    kit.cover(path, GROUND, TAN, TILES)
    kit.scatter(YARD - EMBANKMENT - shaft - path, GROUND, [(GREEN, 4), (BGREEN, 2), (DGREEN, 1)], rng)
    kit.step("New Palace Yard")
    x0, y0, w, d = CLOCK

    def face(x, y, c):
        if x in (x0, x0 + w - 1) and y in (y0, y0 + d - 1):
            return DTAN
        return TBLACK if c % 4 in (1, 2) else TAN

    z = kit.ring(x0, y0, w, d, GROUND, 1, DTAN)
    z = kit.ring(x0, y0, w, d, z, 18, face, start=1)
    kit.step("Elizabeth Tower shaft")
    kit.fill(x0 - 1, y0 - 1, w + 2, d + 2, z, DTAN)
    z += 1
    kit.ring(x0 - 1, y0 - 1, w + 2, d + 2, z, 2, TAN)
    kit.mount("4150p03", x0 + 1, y0 - 2, z, WHITE, "south")
    kit.mount("4150p03", x0 + 1, y0 + d + 1, z, WHITE, "north")
    kit.mount("4150p03", x0 - 2, y0 + 1, z, WHITE, "west")
    kit.mount("4150p03", x0 + w + 1, y0 + 1, z, WHITE, "east")
    z += 6
    kit.step("Clock stage with four faces")
    kit.fill(x0 - 1, y0 - 1, w + 2, d + 2, z, DTAN)
    z += 1
    for x, y in ((x0 - 1, y0 - 1), (x0 + w, y0 - 1), (x0 - 1, y0 + d), (x0 + w, y0 + d)):
        kit.add("3062b", x, y, z, TAN)
        kit.add("4589", x, y, z + 3, PGOLD)
    corner = {(x0, y0), (x0 + w - 1, y0), (x0, y0 + d - 1), (x0 + w - 1, y0 + d - 1)}
    z = kit.ring(x0, y0, w, d, z, 2, lambda x, y, c: TAN if (x, y) in corner else BLACK)
    kit.fill(x0, y0, w, d, z, PGOLD)
    kit.step("Belfry and gilded pinnacles")
    x, y, _, _, top = kit.hip(x0, y0, w, d, z + 1, DBG, slope="4460b", rise=9)
    kit.add("3688", x, y, top, DBG)
    kit.step("Big Ben's spire")


def _unit(x: int) -> int | None:
    """Index of the house at column x, None for the pub."""
    return None if x >= PUB else next(i for i, (h, _, _) in enumerate(HOUSES) if h <= x < h + 3)


def terrace(kit: Kit) -> None:
    x0, y0, w, d = TERRACE
    frames = [(PUB, 11, 0), (11, 12, 270), (11, 15, 270)] + [(h + 1, 11, 0) for h, _, _ in HOUSES]
    glass = {(9, 11), (10, 11), (11, 12), (11, 13), (11, 15), (11, 16)}
    glass |= {(h + i, 11) for h, _, _ in HOUSES for i in (1, 2)}
    doors = {(h, 11) for h, _, _ in HOUSES}
    backs = {(9, 12), (10, 12), (10, 13), (10, 15), (10, 16)} | {(h + i, 12) for h, _, _ in HOUSES for i in (1, 2)}
    floors = [(GROUND, 3, "60593"), (GROUND + 10, 3, "60593"), (GROUND + 20, 2, "60592")]
    for n, (z, courses, window) in enumerate(floors):

        def stucco(x, y, c, n=n):
            i = _unit(x)
            return (DGREEN if n == 0 else DRED) if i is None else HOUSES[i][1]

        opening = glass | doors if n == 0 else glass
        kit.ring(x0, y0, w, d, z, courses, stucco, lambda x, y, c, o=opening: (x, y) in o, start=n)
        for x, y, turn in frames:
            kit.add(window, x, y, z, DGREEN if n == 0 and x >= PUB else WHITE, turn)
        for c in range(courses):
            _paint(
                kit,
                backs,
                z + 3 * c,
                lambda x, y, n=n: TYELLOW if _unit(x) is None or (_unit(x) + n) % 2 == 0 else TBLACK,
            )
        if n == 0:
            for h, _, door in HOUSES:
                kit.add("14716", h, 11, z, door)
        top = z + 3 * courses
        if n < 2:
            kit.cover(rect(PUB, 11, 3, 7), top, PGOLD if n == 0 else DRED)
            kit.cover(rect(0, 11, PUB, 7), top, WHITE)
        kit.step(f"Corner pub and pastel terraces, floor {n + 1}")
    z = GROUND + 26
    kit.cover(rect(0, 10, 12, 8), z, WHITE)
    z += 1
    kit.cover(rect(0, 10, 12, 1), z, WHITE, TILES)
    kit.ring(x0, y0, w, d, z, 1, lambda x, y, c: DRED if _unit(x) is None else HOUSES[_unit(x)][1])
    stacks = {(x + i, 14) for x in (2, 5, 8) for i in (0, 1)}
    kit.cover(rect(1, 12, 10, 5) - stacks, z, DBG, TILES)
    for x in (2, 5, 8):
        kit.add("3004", x, 14, z, DRED)
        kit.add("3004", x, 14, z + 3, DRED)
        for i in (0, 1):
            kit.add("3062b", x + i, 14, z + 6, DORANGE)
    perimeter = {c for c in rect(*TERRACE) if c[0] in (x0, x0 + w - 1) or c[1] in (y0, y0 + d - 1)}
    kit.cover(perimeter, z + 3, WHITE, TILES)
    kit.step("Cornice, parapets and terracotta chimney pots")


def square(kit: Kit, rng: random.Random) -> None:
    fences = rect(8, 19, 4, 1) | rect(5, 19, 2, 1) | rect(11, 20, 1, 12) | rect(5, 20, 1, 12)
    path = {(7, y) for y in range(19, D)}
    kit.cover(path, GROUND, TAN, TILES)
    kit.scatter(GARDEN - fences - path, GROUND, [(GREEN, 4), (BGREEN, 2), (DGREEN, 1)], rng)
    gx, gy = GHERKIN
    kit.cover(PLAZA - rect(gx, gy, 4, 4), GROUND, VLBG, TILES)
    kit.add("3633", 8, 19, GROUND, BLACK)
    kit.add("2877", 5, 19, GROUND, BLACK)
    for x in (5, 11):
        for y in (20, 24, 28):
            kit.add("3633", x, y, GROUND, BLACK, 90)
    kit.step("A railed garden square and a plaza")
    plane(kit, 9, 24, GROUND)
    bench(kit, 7, 29, "x", GROUND)
    kit.step("A London plane and a bench")
    for c in range(12):
        kit.add("87081", gx, gy, GROUND + 3 * c, (DBLUE, DBLUE, SBLUE)[c % 3])
    kit.add("3943b", gx, gy, GROUND + 36, DBLUE)
    kit.add("3942c", gx + 1, gy + 1, GROUND + 42, TBLACK)
    kit.step("The Gherkin")


def roundel(kit: Kit, x: int, y: int) -> None:
    """A Tube roundel on a post: red ring over x..x+3, blue bar over x-1..x+4, facing south."""
    z = GROUND + 1
    for c in range(3):
        kit.add("3062b", x + 1, y, z + 3 * c, BLACK)
    z += 9
    kit.add("3004", x + 1, y, z, RED)
    kit.add("3023b", x + 1, y, z + 3, WHITE)
    kit.add("3666", x - 1, y, z + 4, BLUE)
    for sx in (x, x + 3):
        kit.add("3024", sx, y, z + 3, RED)
        kit.add("3024", sx, y, z + 5, RED)
    kit.add("3023b", x + 1, y, z + 5, WHITE)
    kit.add("3004", x + 1, y, z + 6, RED)


def street_life(kit: Kit) -> None:
    z = GROUND + 1
    roundel(kit, 4, 5)
    kit.step("Underground roundel at the station entrance")
    for x, y in ((13, 0), (18, 0), (18, 5)):
        for c, color in enumerate((BLACK, WHITE, BLACK)):
            kit.add("3062b", x, y, z + 3 * c, color)
        kit.add("3062b", x, y, z + 9, TORANGE)
    kit.step("Belisha beacons")
    for x in (16, 17):
        kit.add("14716", x, 7, z, RED)
        kit.add("3024", x, 7, z + 9, RED)
        kit.add("98138", x, 7, z + 10, RED)
    kit.add("6141", 14, 7, z, BLACK)
    kit.add("3062b", 14, 7, z + 1, RED)
    kit.add("3062b", 14, 7, z + 4, RED)
    kit.add("98138", 14, 7, z + 7, BLACK)
    kit.step("Red phone boxes and a pillar box")
    kit.add("3941", 10, 9, z, RBROWN)
    kit.add("3941", 10, 9, z + 3, RBROWN)
    kit.add("14769", 10, 9, z + 6, RBROWN)
    for x, y in ((9, 0), (3, 0), (1, 5)):
        lamp(kit, x, y, GROUND)
    kit.step("A barrel table outside the pub and street lamps")


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


def traffic(kit: Kit) -> None:
    bus(kit, 22, 1, "x")
    bus(kit, 6, 3, "x")
    cab(kit, 26, 3, "x")
    cab(kit, 12, 14)
    kit.step("Routemasters and black cabs")


def build() -> Kit:
    kit = Kit("london", "London, Mind the Gap", PROMPT)
    rng = random.Random(11)
    base(kit, rng)
    station(kit)
    street_plates(kit)
    tower_bridge(kit)
    boat(kit)
    barge(kit)
    streets(kit)
    westminster(kit, rng)
    terrace(kit)
    square(kit, rng)
    street_life(kit)
    traffic(kit)
    kit.save(STORY)
    return kit
