"""Hogwarts on its cliff above the Black Lake: a 64x64 microscale diorama."""

from __future__ import annotations

import math
import random

from brickyard.showcase.kit import Kit, rect

W = D = 64
P = 8
GROUND = 8 + 3 * P + 1

BLACK, WHITE, STONE, DARK, ROOF, LIT = 0, 15, 71, 72, 272, 46
GREEN, BGREEN, DGREEN, TAN, DTAN, RBROWN, DBROWN, ORANGE = 2, 10, 288, 19, 28, 70, 308, 25
WATER_BLUE = 272

ROCK = [(DARK, 5), (STONE, 3), (DTAN, 2), (BLACK, 1)]
WATER = [(33, 5), (WATER_BLUE, 1), (43, 1)]
SAND = [(TAN, 3), (DTAN, 2), (GREEN, 1)]
ROCK_SIZES = ((1, 1, "3005"), (2, 1, "3004"), (3, 1, "3622"), (4, 1, "3010"), (6, 1, "3009"), (2, 2, "3003"))
PAVING = [(STONE, 4), (DARK, 2), (151, 2)]

RAVINE = range(46, 51)
STREAM = range(47, 49)
LANDING = range(32, 45)

PROMPT = "A large Hogwarts castle on its cliff above the Black Lake, microscale diorama"
STORY = [
    (
        "Hand-scripted by Claude, as a showcase of what Brickyard's parts and checks can do. Every step went through "
        "the same validation Holo uses; ask for a change and Holo takes over."
    ),
    (
        "Nods: the Great Hall with its lit lancet windows, the Astronomy Tower, Gryffindor and Ravenclaw towers, the "
        "clock tower courtyard, the covered bridge over the ravine, the boathouse with the first-years' boats "
        "crossing the Black Lake, Hagrid's hut with its pumpkin patch, and the Forbidden Forest."
    ),
]


def shore(x: int) -> int:
    if x in LANDING:
        return 13
    return round(13 + 2.5 * math.sin(x / 5.5) + 1.5 * math.sin(x / 2.3 + 1))


def height(x: int, y: int) -> int:
    """Terrain height in courses; -1 is the lake."""
    if y < shore(x):
        return -1
    if x in RAVINE:
        return 0
    start = shore(x) + (7 if x in LANDING else 2)
    if y < start:
        return 0
    rise = (y - start) * 1.5 + 0.7 * math.sin(x * 0.9) + 0.5 * math.sin(y * 1.7)
    return max(0, min(P, math.floor(rise)))


H = {(x, y): height(x, y) for x in range(W) for y in range(D)}


EDGE = {
    (x, y)
    for (x, y), h in H.items()
    if h >= 1 and any(H.get((x + dx, y + dy), -1) < h for dx in (-1, 0, 1) for dy in (-1, 0, 1))
}
"""Terrain columns seen from outside; they are built solid, the rest of the terrain is hollow."""


def column(courses: int) -> list[tuple[str, int]]:
    return [("14716", 9)] * (courses // 3) + [("3005", 3)] * (courses % 3)


async def terrain(kit: Kit, rng: random.Random) -> None:
    kit.fill(0, 0, W, D, 0, BLACK)
    await kit.step("Base plate")
    kit.ring(0, 0, W, D, 1, 2, DARK)
    await kit.step("Base walls")
    kit.cover(set(H), 7, lambda x, y: WATER_BLUE if y < 20 or x in RAVINE else DARK)
    walls = {c for c in H if c[0] in (0, W - 1) or c[1] in (0, D - 1)}
    plates = kit.support(7, walls, [("3005", 3), ("3005", 3)], DARK)
    await kit.step("Hidden base pillars")
    kit.pending = plates
    await kit.step("Top plates")
    lake = {c for c, h in H.items() if h < 0}
    stream = {(x, y) for x in STREAM for y in range(D) if H[x, y] == 0}
    kit.scatter(lake | stream, 8, WATER, rng)
    await kit.step("The Black Lake")
    for k in range(1, P + 1):
        kit.scatter({c for c in EDGE if H[c] >= k}, 8 + 3 * (k - 1), ROCK, rng, ROCK_SIZES)
        await kit.step(f"Cliff, course {k}")
    for k in range(1, P + 1):
        cells = {c for c, h in H.items() if h == k}
        if k == P:
            kit.cover(cells, 8 + 3 * k, lambda x, y: BGREEN if (x * 7 + y * 13) % 5 == 0 else GREEN)
        else:
            kit.cover(cells, 8 + 3 * k, lambda x, y: rng.choice((GREEN, DGREEN, DARK)))
        plates = kit.support(8 + 3 * k, EDGE, column(k), DARK)
        await kit.step(f"Hidden pillars, level {k}")
        kit.pending = plates
        await kit.step(f"Grass and ledges, level {k}")


async def shores(kit: Kit, rng: random.Random, taken: set[tuple[int, int]]) -> None:
    beach = {c for c, h in H.items() if h == 0 and c[0] not in STREAM} - taken
    kit.scatter(beach, 8, SAND, rng)
    await kit.step("Shore and ravine floor")


def windows_ring(kit: Kit, x0, y0, w, d, z, courses, lit, openings=lambda x, y, c: False) -> int:
    return kit.ring(x0, y0, w, d, z, courses, lambda x, y, c: LIT if lit(x, y, c) else STONE, openings)


def round_tower(kit: Kit, x: int, y: int, z: int, courses: int) -> int:
    sides = [(x + 1, y, 0), (x + 3, y + 1, 90), (x + 1, y + 3, 0), (x, y + 1, 90)]
    for c in range(courses):
        zc = z + 3 * c
        if c % 3 == 1:
            for i, (px, py, rotation) in enumerate(sides):
                kit.add("3004", px, py, zc, LIT if i == (c // 3) % 2 else STONE, rotation)
        else:
            kit.add("87081" if c % 3 == 0 else "6222", x, y, zc, STONE)
    return z + 3 * courses


def cone_spire(kit: Kit, x: int, y: int, z: int) -> None:
    kit.add("6222", x, y, z, DARK)
    kit.add("272", x, y, z + 3, ROOF)
    kit.add("3942c", x + 1, y + 1, z + 12, ROOF)


def turret(kit: Kit, x: int, y: int, z: int, courses: int) -> None:
    for c in range(courses):
        kit.add("3941", x, y, z + 3 * c, LIT if c % 3 == 1 else STONE)
    kit.add("3942c", x, y, z + 3 * courses, ROOF)


def curtain(kit: Kit, x: int, y: int, length: int, z: int, axis: str = "x", courses: int = 3) -> None:
    for c in range(courses):
        kit.run(x, y, z + 3 * c, length, DARK if c == 0 else STONE, axis, stagger=c % 2 == 1)
    for i in range(0, length, 2):
        kit.add("3005", x + i if axis == "x" else x, y if axis == "x" else y + i, z + 3 * courses, STONE)


def wing(kit: Kit, x0: int, y0: int, w: int, d: int, courses: int, steep: bool = True, lit=None) -> tuple:
    """A castle wing: plinth, walls with lit windows, a slab, and a hipped roof; returns what is left on top."""

    def default(x, y, c):
        i = y - y0 if x in (x0, x0 + w - 1) and y not in (y0, y0 + d - 1) else x - x0
        return i % 3 == 2 and c % 3 != 2

    z = kit.ring(x0, y0, w, d, GROUND, 1, DARK)
    z = windows_ring(kit, x0, y0, w, d, z, courses, lit or default)
    kit.fill(x0, y0, w, d, z, DARK)
    slope, rise = ("4460b", 9) if steep else ("3040b", 3)
    x, y, rw, rd, top = kit.hip(x0, y0, w, d, z + 1, ROOF, slope=slope, rise=rise)
    if rw == rd == 2:
        return x, y, top
    kit.ridge(x, y, rw, rd, top, ROOF)
    return x, y, top + 3


async def castle(kit: Kit) -> None:
    x0, y0, w, d = 16, 28, 20, 8

    def lancets(x, y, c):
        if y in (y0, y0 + d - 1):
            return (x - x0) % 3 == 2 and x0 < x < x0 + w - 1 and 1 <= c <= 4
        return y in (y0 + 3, y0 + 4) and 2 <= c <= 4

    wing(kit, x0, y0, w, d, 6, lit=lancets)
    await kit.step("Great Hall")
    x, y, top = wing(kit, 16, 38, 12, 12, 8, steep=False)
    turret(kit, x, y, top, 2)
    await kit.step("Keep and Grand Staircase")
    gallery = windows_ring(kit, 20, 36, 4, 2, GROUND, 4, lambda x, y, c: x in (21, 22) and c in (1, 2))
    kit.add("3039", 20, 36, gallery, ROOF)
    kit.add("3039", 22, 36, gallery, ROOF)
    await kit.step("Gallery between the hall and the keep")
    wing(kit, 6, 36, 8, 10, 6)
    await kit.step("West wing")
    wing(kit, 28, 38, 10, 8, 6)
    await kit.step("East wing")
    wing(kit, 14, 52, 20, 8, 7)
    await kit.step("Library wing")
    for name, x, y, courses in (
        ("Astronomy Tower", 5, 30, 26),
        ("Ravenclaw Tower", 8, 46, 15),
        ("Gryffindor Tower", 40, 40, 18),
        ("Headmaster's Tower", 28, 46, 22),
        ("North Tower", 9, 53, 14),
    ):
        top = round_tower(kit, x, y, GROUND, courses)
        cone_spire(kit, x, y, top)
        await kit.step(name)
    for name, x0, y0, courses in (("Clock Tower", 40, 34, 16), ("Bell Tower", 35, 53, 18)):
        lit = lambda x, y, c, x0=x0, y0=y0: c % 4 in (1, 2) and (x in (x0 + 1, x0 + 2) or y in (y0 + 1, y0 + 2))
        top = windows_ring(kit, x0, y0, 4, 4, GROUND, courses, lit)
        x, y, _, _, z = kit.hip(x0, y0, 4, 4, top, ROOF, slope="4460b", rise=9)
        kit.add("3688", x, y, z, ROOF)
        await kit.step(name)
    for x, y in ((14, 36), (28, 36), (36, 28)):
        turret(kit, x, y, GROUND, 8)
    await kit.step("Turrets")
    curtain(kit, 9, 31, 7, GROUND)
    curtain(kit, 36, 35, 4, GROUND)
    curtain(kit, 12, 47, 4, GROUND)
    curtain(kit, 38, 42, 2, GROUND)
    curtain(kit, 14, 42, 2, GROUND)
    await kit.step("Battlements")
    for x0, y0 in ((2, 52), (2, 58)):
        kit.ring(x0, y0, 6, 4, GROUND, 1, DARK)
        x, y, rw, rd, z = kit.hip(x0, y0, 6, 4, GROUND + 3, 47)
        kit.ridge(x, y, rw, rd, z, 47)
    await kit.step("Greenhouses")


async def courtyard_and_bridge(kit: Kit, rng: random.Random) -> None:
    deck = rect(44, 36, 10, 2)
    castle = rect(40, 34, 4, 4) | rect(36, 28, 2, 2) | rect(36, 35, 4, 1) | deck
    kit.mosaic(36, 29, 10, 9, GROUND, PAVING, rng, skip=castle)
    await kit.step("Clock Tower courtyard")
    terrace = {c for c in rect(3, 20, 40, 8) | rect(38, 28, 8, 1) if H[c] == P}
    kit.scatter(terrace, GROUND, PAVING, rng)
    await kit.step("Terrace above the lake")
    for c in range(P):
        kit.add("3004", 49, 36, 8 + 3 * c, DARK, 90)
    kit.add("3023b", 49, 36, 8 + 3 * P, DARK, 90)
    kit.add("3034", 44, 36, GROUND, RBROWN)
    kit.add("3022", 52, 36, GROUND, RBROWN)
    for x in (44, 48):
        for y in (36, 37):
            kit.add("3633", x, y, GROUND + 1, RBROWN)
    for x in (44, 46, 48, 50):
        kit.add("3043", x, 36, GROUND + 4, ROOF)
    await kit.step("Covered bridge over the ravine")


async def lakeside(kit: Kit) -> None:
    x0, y0, w, d = 36, 16, 6, 4
    top = windows_ring(
        kit,
        x0,
        y0,
        w,
        d,
        8,
        2,
        lambda x, y, c: y != y0 and c == 1,
        lambda x, y, c: y == y0 and x in range(38 - c, 40 + c),
    )
    kit.add("3659", 37, y0, 11, STONE)
    x, y, rw, rd, z = kit.hip(x0, y0, w, d, top, ROOF)
    kit.ridge(x, y, rw, rd, z, ROOF)
    await kit.step("Boathouse")
    kit.add("3020", 38, 11, 9, RBROWN, 90)
    for x, y in ((38, 8), (36, 7), (40, 7), (34, 5), (42, 5), (32, 3), (44, 3)):
        kit.add("3023b", x, y, 9, RBROWN, 90)
        kit.add("6141", x, y + 1, 10, LIT)
    await kit.step("First-years' boats on the Black Lake")


async def grounds(kit: Kit, rng: random.Random) -> None:
    hut = (55, 27)
    kit.add("87081", *hut, GROUND, DTAN)
    kit.add("87081", *hut, GROUND + 3, DTAN)
    kit.add("3943b", *hut, GROUND + 6, DBROWN)
    for x, y in ((53, 31), (60, 28)):
        kit.add("3062b", x, y, GROUND, ORANGE)
    for x, y in ((54, 32), (59, 31), (60, 30), (52, 29)):
        kit.add("6141", x, y, GROUND, ORANGE)
    await kit.step("Hagrid's hut and pumpkin patch")
    willow = (56, 21)
    for c in range(3):
        kit.add("3941", willow[0] + 1, willow[1] + 1, GROUND + 3 * c, DBROWN)
    kit.add("6222", *willow, GROUND + 9, DGREEN)
    kit.add("87081", *willow, GROUND + 12, GREEN)
    kit.add("3941", willow[0] + 1, willow[1] + 1, GROUND + 15, DGREEN)
    await kit.step("Whomping Willow")
    kit.run(54, 36, GROUND, 2, TAN, kind={2: "3069b"})
    kit.run(54, 37, GROUND, 2, TAN, kind={2: "3069b"})
    for x, y in ((57, 35), (59, 35), (61, 37), (61, 39), (59, 41), (57, 41), (56, 39)):
        kit.add("3005", x, y, GROUND, DARK)
        kit.add("3005", x, y, GROUND + 3, STONE)
    await kit.step("Stone circle at the end of the bridge")
    taken = rect(52, 20, 10, 14) | rect(44, 36, 10, 2) | rect(54, 34, 9, 9)
    trees = 0
    for _ in range(400):
        big = rng.random() < 0.4
        size = 4 if big else 2
        x, y = rng.randrange(52, W - size + 1), rng.randrange(34, D - size + 1)
        spot = rect(x, y, size, size)
        if spot & taken or any(H[c] != P for c in spot):
            continue
        taken |= rect(x - 1, y - 1, size + 2, size + 2)
        leaves = rng.choice((DGREEN, DGREEN, GREEN))
        if big:
            kit.add("3941", x + 1, y + 1, GROUND, RBROWN)
            kit.add("3943b", x, y, GROUND + 3, leaves)
            kit.add("3942c", x + 1, y + 1, GROUND + 9, leaves)
            kit.add("3942c", x + 1, y + 1, GROUND + 15, leaves)
        else:
            kit.add("3941", x, y, GROUND, RBROWN)
            kit.add("3942c", x, y, GROUND + 3, leaves)
            kit.add("3942c", x, y, GROUND + 9, leaves)
        trees += 1
    await kit.step(f"The Forbidden Forest, {trees} trees")


async def build() -> Kit:
    kit = Kit("Hogwarts", PROMPT, W, D)
    rng = random.Random(11)
    await terrain(kit, rng)
    await shores(kit, rng, rect(36, 16, 6, 4) | {(49, 36), (49, 37)})
    await castle(kit)
    await courtyard_and_bridge(kit, rng)
    await lakeside(kit)
    await grounds(kit, rng)
    kit.save(STORY)
    return kit
