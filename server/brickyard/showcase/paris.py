"""Place Saint-Germain-des-Prés, Paris: a 32x32 microscale diorama."""

from __future__ import annotations

import random

from brickyard.shapes import TILE_RUN, TILES, rect
from brickyard.showcase.kit import Frame, Kit

BLACK, WHITE, LBG, DBG, TAN, DTAN, VLG, VLBG = 0, 15, 71, 72, 19, 28, 503, 151
GREEN, BGREEN, DGREEN, DRED, RED, RBROWN, DORANGE = 2, 10, 288, 320, 4, 70, 484
TYELLOW, TORANGE, TBLACK, NOUGAT, LNOUGAT, YELLOW, DBLUE = 46, 57, 40, 84, 78, 14, 272
PLATE_2DEEP = {8: "3034", 6: "3795", 4: "3020", 3: "3021", 2: "3022"}

W = D = 32
GROUND = 8
TOWER = (1, 24, 6, 6)
GARDEN = (0, 15, 9, 8)
METRO_HOLE = {(x, y) for x in (2, 3) for y in range(5, 9)}

PROMPT = "Place Saint-Germain-des-Prés in Paris, microscale diorama with Haussmann buildings"
STORY = [
    (
        "Hand-scripted by Claude, as a showcase of what Brickyard's parts and checks can do. Every step went through "
        "the same validation Holo uses; ask for a change and Holo takes over."
    ),
    (
        "Nods: the Saint-Germain-des-Prés bell tower with its slate spire, Les Deux Magots (green awning) facing the "
        "church, the Café de Flore terrace on the boulevard, a Guimard metro entrance, a Wallace fountain, a Morris "
        "column, plane trees, and a zebra crossing on Boulevard Saint-Germain."
    ),
]


async def base(kit: Kit) -> None:
    kit.fill(0, 0, W, D, 0, BLACK)
    await kit.step("Base plate")
    kit.ring(0, 0, W, D, 1, 2, DBG)
    for x in range(2, W - 3, 4):
        for y in range(2, D - 3, 4):
            if not rect(x, y, 2, 2) & rect(1, 4, 4, 6):
                kit.add("3003", x, y, 1, DBG)
                kit.add("3003", x, y, 4, DBG)
    await kit.step("Base walls and pillars")
    for y, courses in ((5, 2), (6, 1), (7, 1)):
        for c in range(courses):
            kit.add("3004", 2, y, 1 + 3 * c, DBG)
    kit.add("3023b", 2, 5, 7, DBG)
    kit.add("3023b", 2, 6, 4, DBG)
    kit.add("3023b", 2, 6, 5, DBG)
    kit.add("3023b", 2, 8, 1, DBG)
    for x, y, part in ((1, 5, "3005"), (4, 5, "3005"), (5, 4, "3004"), (4, 29, "3004")):
        kit.add(part, x, y, 1, DBG)
        kit.add(part, x, y, 4, DBG)
    await kit.step("Metro stairs")
    kit.fill(0, 0, W, D, 7, DBG, skip=METRO_HOLE)
    await kit.step("Top plates")


async def streets(kit: Kit, rng: random.Random, buildings: set[tuple[int, int]]) -> None:
    zebra = {(x, y) for x in range(12, 19, 2) for y in range(4)}
    kit.fill(0, 0, W, 4, GROUND, DBG, TILES, skip=zebra)
    for x in range(12, 19, 2):
        kit.add("2431", x, 0, GROUND, WHITE, 90)
    await kit.step("Boulevard Saint-Germain with a zebra crossing")
    kit.run(0, 4, GROUND, W, VLBG, kind=TILE_RUN)
    await kit.step("Kerb")
    skip = buildings | rect(*TOWER) | METRO_HOLE | rect(*GARDEN) | {(x, 4) for x in range(W)}
    palette = [(VLBG, 5), (LBG, 4), (TAN, 2), (DTAN, 1)]
    kit.mosaic(0, 5, W, 12, GROUND, palette, rng, skip)
    await kit.step("Paving, front")
    kit.mosaic(0, 17, W, D - 17, GROUND, palette, rng, skip)
    await kit.step("Paving, back")
    kit.mosaic(*GARDEN, GROUND, [(GREEN, 4), (BGREEN, 2), (DGREEN, 1)], rng)
    await kit.step("Square Laurent-Prache lawn")


async def tower(kit: Kit) -> None:
    x0, y0, w, d = TOWER
    faces = [Frame(kit, x0, y0, w, d, f) for f in ("south", "west", "north", "east")]
    z = GROUND
    door = {faces[0].cell(u, 0) for u in (2, 3)}
    arch = {faces[0].cell(u, 0) for u in range(1, 5)}
    z = kit.ring(x0, y0, w, d, z, 5, LBG, lambda x, y, c: (x, y) in (door if c < 3 else arch))
    faces[0].put("6182", 1, 0, GROUND + 9, VLBG)
    faces[0].run(2, 1, GROUND, 2, RBROWN)
    faces[0].run(2, 1, GROUND + 3, 2, RBROWN)
    faces[0].run(2, 1, GROUND + 6, 2, RBROWN)
    await kit.step("Tower porch")
    stages = [(5, "3659", 4, 1), (5, "6182", 3, 2), (5, "6182", 3, 2), (4, "3659", 3, 1)]
    for n, (courses, part, arch_course, arch_height) in enumerate(stages, 1):
        kit.fill(x0 - 1, y0 - 1, w + 2, d + 2, z, VLBG)
        z += 1
        windows = {f.cell(u, 0) for f in faces for u in (2, 3)}
        arches = {f.cell(u, 0) for f in faces for u in range(1, 5)}

        def opening(x, y, c, windows=windows, arches=arches, arch_course=arch_course, arch_height=arch_height):
            if arch_course <= c < arch_course + arch_height:
                return (x, y) in arches
            return (x, y) in windows and c >= 1

        top = kit.ring(x0, y0, w, d, z, courses, LBG, opening)
        for f in faces:
            f.put(part, 1, 0, z + 3 * arch_course, VLBG)
            for c in range(arch_course + arch_height):
                f.run(2, 1, z + 3 * c, 2, BLACK)
        z = top
        await kit.step(f"Tower stage {n}")
    kit.fill(x0 - 1, y0 - 1, w + 2, d + 2, z, VLBG)
    kit.fill(x0, y0, w, d, z + 1, DBG)
    z += 2
    await kit.step("Tower cornice")
    x, y, _, _, z = kit.hip(x0, y0, w, d, z, DBG, slope="4460b", rise=9)
    kit.add("3688", x, y, z, DBG)
    await kit.step("Slate spire")


def haussmann(
    kit: Kit,
    frame: Frame,
    wall: int,
    shop: int,
    awning: tuple[int, int],
    windows: list[int],
    floors: int = 5,
    sides: tuple[str, ...] = (),
):
    """Yields step titles as it adds a Haussmann building facing `frame.facing`, with windows on the given `sides`."""
    x0, y0, w, d = frame.rect
    L, Dp = frame.length, frame.depth
    facade = {frame.cell(u, 0) for u in range(L)}
    side_windows = [
        (u, v, turn, inner)
        for side, u, turn, inner in (("left", 0, 90, 1), ("right", L - 1, 270, L - 2))
        if side in sides
        for v in ([2, Dp - 4] if Dp >= 10 else [(Dp - 2) // 2])
    ]
    z = GROUND
    kit.ring(x0, y0, w, d, z, 3, wall, lambda x, y, c: (x, y) in facade)
    frame.put("14716", 0, 0, z, shop)
    frame.put("14716", L - 1, 0, z, shop)
    u = 1
    while u < L - 1:
        size = 4 if L - 1 - u >= 4 and (u == 1 or L - 1 - u > 4) else 2
        frame.put("60594" if size == 4 else "60593", u, 0, z, shop)
        for c in range(3):
            frame.run(u, 1, z + 3 * c, size, NOUGAT)
        u += size
    z += 9
    yield "shopfront"
    kit.ring(x0, y0, w, d, z, 1, wall, lambda x, y, c: (x, y) in facade, start=1)
    frame.put("3005", 0, 0, z, wall)
    frame.put("3005", L - 1, 0, z, wall)
    for u in range(1, L - 1):
        frame.put("3040b", u, -1, z, awning[u % 2])
    z += 3
    yield "awning"
    for floor in range(1, floors + 1):
        balcony = floor in (2, floors)
        frame.run(0, -1, z, L, BLACK if balcony else WHITE, PLATE_2DEEP)
        kit.fill(*frame.area(0, 1, L, Dp - 1), z, wall)
        z += 1
        if balcony:
            frame.put("3062b", 0, -1, z, BLACK)
            frame.put("3062b", L - 1, -1, z, BLACK)
            u = 1
            while u + 4 <= L - 1:
                frame.put("3633", u, -1, z, BLACK)
                u += 4
            for post in range(u, L - 1):
                frame.put("3062b", post, -1, z, BLACK)
        glass = {frame.cell(u + i, 0) for u in windows for i in (0, 1)}
        glass |= {frame.cell(u, v + i) for u, v, _, _ in side_windows for i in (0, 1)}
        for c in range(2):
            for u in windows:
                frame.put("3004", u, 1, z + 3 * c, BLACK)
            for _, v, turn, inner in side_windows:
                frame.put("3004", inner, v, z + 3 * c, BLACK, 90)
        z = kit.ring(x0, y0, w, d, z, 2, wall, lambda x, y, c, glass=glass: (x, y) in glass, start=floor)
        for u in windows:
            frame.put("60592", u, 0, z - 6, WHITE)
        for u, v, turn, _ in side_windows:
            frame.put("60592", u, v, z - 6, WHITE, turn)
        yield f"floor {floor}"
    frame.run(0, -1, z, L, WHITE, PLATE_2DEEP)
    kit.fill(*frame.area(0, 1, L, Dp - 1), z, wall)
    z += 1
    frame.run(0, -1, z, L, WHITE, TILE_RUN)
    yield "cornice"
    roof_rows = {frame.cell(u, v) for u in range(L) for v in (0, 1, Dp - 2, Dp - 1)}
    kit.ring(x0, y0, w, d, z, 3, wall, lambda x, y, c: (x, y) in roof_rows)
    dormers = {u + i for u in windows for i in (0, 1)}
    for u in range(L):
        frame.put("4460b", u, Dp - 2, z, DBG, 180)
        if u not in dormers:
            frame.put("4460b", u, 0, z, DBG)
    for u in windows:
        frame.put("60592", u, 0, z, WHITE)
        frame.put("3004", u, 1, z, DBG)
        frame.put("3004", u, 1, z + 3, DBG)
        frame.put("3039", u, 0, z + 6, DBG)
    z += 9
    yield "mansard roof"
    kit.fill(*frame.area(0, 1, L, Dp - 2), z, DBG)
    z += 1
    for u in (0, L - 1):
        v = Dp // 2 - 1
        frame.put("3004", u, v, z, wall, 90)
        frame.put("3004", u, v, z + 3, wall, 90)
        frame.put("3062b", u, v, z + 6, DORANGE)
        frame.put("3062b", u, v + 1, z + 6, DORANGE)
    yield "roof and chimneys"


async def building(kit: Kit, name: str, frame: Frame, *args, **kwargs) -> None:
    for title in haussmann(kit, frame, *args, **kwargs):
        await kit.step(f"{name}: {title}")


def tree(kit: Kit, x: int, y: int, leaves: tuple[int, int, int]) -> None:
    for c in range(3):
        kit.add("3941", x + 1, y + 1, GROUND + 1 + 3 * c, RBROWN)
    kit.add("87081", x, y, GROUND + 10, leaves[0])
    kit.add("6222", x, y, GROUND + 13, leaves[1])
    kit.add("3941", x + 1, y + 1, GROUND + 16, leaves[2])


def lamp(kit: Kit, x: int, y: int) -> None:
    for c in range(3):
        kit.add("3062b", x, y, GROUND + 1 + 3 * c, BLACK)
    kit.add("3062b", x, y, GROUND + 10, TYELLOW)
    kit.add("4589", x, y, GROUND + 13, BLACK)


def table(kit: Kit, x: int, y: int, chairs: list[tuple[int, int]]) -> None:
    kit.add("3062b", x, y, GROUND + 1, BLACK)
    kit.add("98138", x, y, GROUND + 4, WHITE)
    for cx, cy in chairs:
        kit.add("3024", cx, cy, GROUND + 1, NOUGAT)
        kit.add("3070b", cx, cy, GROUND + 2, NOUGAT)


async def details(kit: Kit) -> None:
    z = GROUND + 1
    kit.add("3633", 1, 5, z, DGREEN, 90)
    kit.add("3633", 4, 5, z, DGREEN, 90)
    kit.add("3633", 1, 9, z, DGREEN)
    for x in (1, 4):
        for c in range(3):
            kit.add("3062b", x, 4, z + 3 * c, DGREEN)
    kit.add("3710", 1, 4, z + 9, DGREEN)
    for x in (1, 4):
        kit.add("3062b", x, 4, z + 10, TORANGE)
        kit.add("4589", x, 4, z + 13, DGREEN)
    kit.add("3069b", 2, 4, z + 10, YELLOW)
    await kit.step("Guimard metro entrance")
    kit.add("3941", 11, 11, z, DGREEN)
    for dx in (0, 1):
        for dy in (0, 1):
            kit.add("3062b", 11 + dx, 11 + dy, z + 3, DGREEN)
    kit.add("2654a", 11, 11, z + 6, DGREEN)
    await kit.step("Wallace fountain")
    for c, color in enumerate((DGREEN, WHITE, YELLOW, WHITE, DGREEN)):
        kit.add("3941", 14, 6, z + 3 * c, color)
    kit.add("2654a", 14, 6, z + 15, DGREEN)
    await kit.step("Morris column")
    kit.add("3003", 16, 13, z, DGREEN)
    kit.add("3003", 16, 13, z + 3, DGREEN)
    kit.add("3942c", 16, 13, z + 6, DGREEN)
    await kit.step("Newspaper kiosk")
    for x, y in ((6, 5), (16, 5)):
        tree(kit, x, y, (BGREEN, GREEN, BGREEN))
    for x, y in ((0, 16), (4, 18)):
        tree(kit, x, y, (GREEN, DGREEN, GREEN))
    await kit.step("Plane trees")
    for x in (0, 4):
        kit.add("3633", x, 14, z, BLACK)
    kit.add("3024", 8, 20, z, BLACK)
    kit.add("3024", 8, 17, z, BLACK)
    kit.add("3710", 8, 17, z + 1, DGREEN, 90)
    await kit.step("Garden railing and bench")
    for x, y in ((11, 4), (21, 4), (20, 17)):
        lamp(kit, x, y)
    await kit.step("Street lamps")
    for x in (23, 26, 29):
        table(kit, x, 5, [(x - 1, 5), (x + 1, 5)])
    for x in (12, 15, 18):
        table(kit, x, 19, [(x - 1, 19), (x + 1, 19)])
    await kit.step("Café terraces")
    for x, y, color in ((3, 1, LBG), (24, 1, DBLUE)):
        car(kit, x, y, color)
    await kit.step("Traffic on the boulevard")


def car(kit: Kit, x: int, y: int, color: int) -> None:
    kit.add("3020", x, y, GROUND + 1, BLACK)
    kit.add("3001", x, y, GROUND + 2, color)
    kit.add("3039", x + 1, y, GROUND + 5, TBLACK, 90)
    kit.add("3004", x + 3, y, GROUND + 5, color, 90)


async def build() -> Kit:
    kit = Kit("Place Saint-Germain-des-Prés", PROMPT, W, D)
    rng = random.Random(7)
    magots = Frame(kit, 10, 22, 10, 10, "south")
    boulangerie = Frame(kit, 20, 22, 12, 10, "south")
    flore = Frame(kit, 22, 8, 10, 8, "south")
    buildings = set().union(*(rect(*f.rect) for f in (magots, boulangerie, flore)))
    await base(kit)
    await streets(kit, rng, buildings)
    await tower(kit)
    await building(kit, "Les Deux Magots", magots, TAN, DGREEN, (DGREEN, DGREEN), [1, 4, 7], sides=("left",))
    await building(kit, "Boulangerie", boulangerie, VLG, DRED, (RED, WHITE), [1, 5, 9], sides=("right",))
    await building(kit, "Café de Flore", flore, LNOUGAT, WHITE, (WHITE, WHITE), [1, 4, 7], 4, ("left", "right"))
    await details(kit)
    kit.save(STORY)
    return kit
