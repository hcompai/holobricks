"""Saint-Germain-des-Prés, Paris: a 64x64 microscale slice around the Café de Flore."""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from brickyard import shapes
from brickyard.shapes import BRICKS, MOSAIC, PLATES, TILE_RUN, TILES, rect
from brickyard.showcase.kit import Frame, Kit

BLACK, WHITE, LBG, DBG, TAN, DTAN, VLG, VLBG = 0, 15, 71, 72, 19, 28, 503, 151
GREEN, BGREEN, DGREEN, DRED, RED, RBROWN, DORANGE = 2, 10, 288, 320, 4, 70, 484
TYELLOW, TORANGE, TBLACK, NOUGAT, LNOUGAT, YELLOW, DBLUE, SBLUE = 46, 57, 40, 84, 78, 14, 272, 379
BLUE, PGOLD = 1, 297

GROUND = 8
BAND = [p for p in PLATES if 2 in p[:2] and max(p[:2]) <= 8] + [(1, 1, "3024")]
CORNERS = {("south", "east"), ("south", "west"), ("north", "east"), ("north", "west")}


@dataclass
class Face:
    """One street front of a building: windows start at these u offsets and are 2 studs wide."""

    side: str
    windows: list[int]
    shop: int | None = None
    lit: int = TYELLOW
    awning: int | None = None
    trim: int | None = None


@dataclass
class Haussmann:
    x0: int
    y0: int
    w: int
    d: int
    stone: int
    faces: list[Face]
    floors: int = 5
    balconies: tuple[int, ...] = (2, 5)
    garden: bool = False
    reach: int = 1
    frames: dict[str, Frame] = field(default_factory=dict)


def _frame(kit: Kit, b: Haussmann, side: str) -> Frame:
    length, depth = (b.w, b.d) if side in ("south", "north") else (b.d, b.w)
    return Frame(kit, b.x0, b.y0, length, depth, side)


def _corners(b: Haussmann) -> list[tuple[str, str]]:
    sides = {f.side for f in b.faces}
    return [pair for pair in CORNERS if set(pair) <= sides]


def _corner_cells(b: Haussmann, pair: tuple[str, str]) -> tuple[tuple[int, int], tuple[int, int]]:
    """The facade corner cell and the diagonal cell just outside it."""
    x = b.x0 + b.w - 1 if "east" in pair else b.x0
    y = b.y0 if "south" in pair else b.y0 + b.d - 1
    dx = 1 if "east" in pair else -1
    dy = -1 if "south" in pair else 1
    return (x, y), (x + dx, y + dy)


def _row(frame: Frame, v: int) -> list[tuple[int, int]]:
    return [frame.cell(u, v) for u in range(frame.length)]


def building(kit: Kit, name: str, b: Haussmann):
    """Yields step titles while adding a corner-aware Haussmann block: shopfronts, awnings, balconies, mansard."""
    for face in b.faces:
        b.frames[face.side] = _frame(kit, b, face.side)
    faces = {f.side: f for f in b.faces}
    frames = b.frames
    corners = _corners(b)
    facade = {c for f in frames.values() for c in _row(f, 0)}
    outside = {c for f in frames.values() for c in _row(f, -1)} | {_corner_cells(b, p)[1] for p in corners}
    shopfront = {c for s, f in frames.items() if faces[s].shop is not None for c in _row(f, 0)}
    x0, y0, w, d = b.x0, b.y0, b.w, b.d

    z = GROUND
    kit.ring(x0, y0, w, d, z, 3, b.stone, lambda x, y, c: (x, y) in shopfront)
    ends = {frames[s].cell(u, 0) for s in frames if faces[s].shop is not None for u in (0, frames[s].length - 1)}
    for x, y in sorted(ends):
        kit.add("14716", x, y, z, b.stone)
    lit: dict[tuple[int, int], int] = {}
    for side, frame in frames.items():
        face = faces[side]
        if face.shop is None:
            continue
        u = 1
        while u < frame.length - 1:
            size = 4 if frame.length - 1 - u >= 4 and (u == 1 or frame.length - 1 - u > 4) else 2
            if frame.length - 1 - u == 1:
                size = 1
            if size == 1:
                frame.put("14716", u, 0, z, b.stone)
            else:
                frame.put("60594" if size == 4 else "60593", u, 0, z, face.shop)
                for i in range(size):
                    lit.setdefault(frame.cell(u + i, 1), face.lit)
            u += size
    for c in range(3):
        for color in set(lit.values()):
            kit.cover({cell for cell, col in lit.items() if col == color}, z + 3 * c, color, BRICKS)
    z += 9
    below, solid = GROUND, _perimeter(b) | set(lit)
    yield "shopfront"

    r = b.reach
    ledge = _deep(kit, b, z, b.stone) if r == 3 else _perimeter(b)
    if r != 3:
        kit.cover(ledge, z, b.stone)
    _interior(kit, b, z, below, solid)
    below, solid, z = z + 1, _perimeter(b), z + 1
    awnings = {s for s in frames if faces[s].awning is not None}
    awning_corners = [p for p in corners if set(p) <= awnings]
    blocks = {p: {_out(b, p, i, j) for i in (r - 1, r) for j in (r - 1, r)} for p in awning_corners}
    covered: dict[tuple[int, int], int] = {}
    for side in awnings:
        frame, face = frames[side], faces[side]
        extra: list[int] = []
        for pair in awning_corners:
            if side in pair:
                extra += (
                    list(range(-(r - 2), 0))
                    if frame.cell(0, 0) == _corner_cells(b, pair)[0]
                    else list(range(frame.length, frame.length + r - 2))
                )
        for u in list(range(frame.length)) + extra:
            cells = {frame.cell(u, -r), frame.cell(u, 1 - r)}
            if not any(cells & block for block in blocks.values()):
                frame.put("3040b", u, -r, z, face.awning)
                covered.update(dict.fromkeys(cells, face.trim or face.awning))
    for pair, block in blocks.items():
        x, y = min(block)
        kit.add(
            "3045",
            x,
            y,
            z,
            faces[pair[0]].awning,
            {("south", "west"): 0, ("south", "east"): 270, ("north", "east"): 180, ("north", "west"): 90}[pair],
        )
        covered.update(dict.fromkeys(block, faces[pair[0]].trim or faces[pair[0]].awning))
    kit.ring(x0, y0, w, d, z, 1, b.stone, lambda x, y, c: (x, y) in covered)
    for color in set(covered.values()):
        kit.cover({c for c, col in covered.items() if col == color} - ledge, z - 1, color)
    z += 3
    yield "awning"

    band = facade | outside
    for floor in range(1, b.floors + 1):
        balcony = floor in b.balconies
        garden = b.garden and floor == 1
        if garden:
            _deep(kit, b, z, BLACK)
        else:
            _slab(kit, b, z, band, band if balcony else set())
        _interior(kit, b, z, below, solid)
        z += 1
        glass = {f.cell(u + i, 0) for s, f in frames.items() for u in faces[s].windows for i in (0, 1)}
        backs = {f.cell(u + i, 1) for s, f in frames.items() for u in faces[s].windows for i in (0, 1)}
        below, solid = z, _perimeter(b) | backs
        for c in range(2):
            kit.cover(backs, z + 3 * c, BLACK, BRICKS)
        top = kit.ring(x0, y0, w, d, z, 2, b.stone, lambda x, y, c, glass=glass: (x, y) in glass, start=floor)
        for side, frame in frames.items():
            for u in faces[side].windows:
                frame.put("60592", u, 0, z, WHITE)
        if garden:
            _planted_balcony(kit, b, z)
        elif balcony:
            _railing(kit, b, z, -1)
        else:
            for side, frame in frames.items():
                for u in faces[side].windows:
                    frame.put("2412b", u, -1, z, BLACK)
        z = top
        yield f"floor {floor}"

    _slab(kit, b, z, band, set())
    _interior(kit, b, z, below, solid)
    z += 1
    for side, frame in frames.items():
        frame.run(0, -1, z, frame.length, WHITE, TILE_RUN)
    for pair in corners:
        kit.add("3070b", *_corner_cells(b, pair)[1], z, WHITE)
    yield "cornice"

    yield from _mansard(kit, b, z)


def _footprint(b: Haussmann) -> set[tuple[int, int]]:
    return {(x, y) for x in range(b.x0, b.x0 + b.w) for y in range(b.y0, b.y0 + b.d)}


def _perimeter(b: Haussmann) -> set[tuple[int, int]]:
    return {(x, y) for x, y in _footprint(b) if x in (b.x0, b.x0 + b.w - 1) or y in (b.y0, b.y0 + b.d - 1)}


def _interior(
    kit: Kit, b: Haussmann, z: int, below: int, solid: set[tuple[int, int]], color: int | None = None
) -> None:
    """Plates filling the inside at `z`, each on a hidden column from `below` unless it already rests on `solid`."""
    held, kit.pending = kit.pending, []
    kit.cover(_footprint(b) - _perimeter(b), z, b.stone if color is None else color)
    plates = kit.support(z, solid, [("3005", 3)] * ((z - below) // 3), b.stone)
    kit.pending = held + kit.pending + plates


def _corner_block(b: Haussmann, pair: tuple[str, str]) -> tuple[int, int]:
    """Min corner of the 2x2 made of the facade corner cell and the three outside cells around it."""
    corner, diagonal = _corner_cells(b, pair)
    return min(corner[0], diagonal[0]), min(corner[1], diagonal[1])


def _slab(kit: Kit, b: Haussmann, z: int, band: set[tuple[int, int]], black: set[tuple[int, int]]) -> None:
    """A floor plate whose facade band sticks out one stud; corners first so every outside plate also sits on wall."""
    taken: set[tuple[int, int]] = set()
    for pair in _corners(b):
        x, y = _corner_block(b, pair)
        block = {(x + i, y + j) for i in (0, 1) for j in (0, 1)}
        kit.add("3022", x, y, z, BLACK if block & black else b.stone)
        taken |= block
    kit.cover(black - taken, z, BLACK, BAND)
    kit.cover(band - black - taken, z, b.stone, BAND)
    kit.cover(_perimeter(b) - band, z, b.stone)


def _out(b: Haussmann, pair: tuple[str, str], i: int, j: int) -> tuple[int, int]:
    """The cell i studs sideways and j studs out from the facade corner, diagonally away from the building."""
    (cx, cy), _ = _corner_cells(b, pair)
    return cx + (i if "east" in pair else -i), cy + (-j if "south" in pair else j)


def _deep(kit: Kit, b: Haussmann, z: int, color: int) -> set[tuple[int, int]]:
    """A 3-deep ledge of 2x3 plates reaching out from the facade, a 3x3 plate at each corner; returns its cells."""
    taken: set[tuple[int, int]] = set()
    for pair in _corners(b):
        block = {_out(b, pair, i, j) for i in range(3) for j in range(3)}
        kit.add("11212", *min(block), z, color)
        taken |= block
    for frame in b.frames.values():
        u = 0
        while u < frame.length:
            cells = {frame.cell(u + i, v) for i in (0, 1) for v in (-2, -1, 0)}
            if u + 2 <= frame.length and not cells & taken:
                frame.put("3021", u, -2, z, color, 90)
                taken |= cells
                u += 2
                continue
            cells = {frame.cell(u, v) for v in (-2, -1, 0)}
            if not cells & taken:
                frame.put("3623", u, -2, z, color, 90)
                taken |= cells
            u += 1
    kit.cover(_perimeter(b) - taken, z, b.stone)
    return taken | _perimeter(b)


def _railing(kit: Kit, b: Haussmann, z: int, v: int, skip: tuple[int, int] | None = None) -> None:
    for frame in b.frames.values():
        u = 0
        while u < frame.length:
            if u + 4 <= frame.length:
                frame.put("3633", u, v, z, BLACK)
                u += 4
            else:
                frame.put("3062b", u, v, z, BLACK)
                u += 1
    for pair in _corners(b):
        for x, y in _outer_corner(b, pair, -v) - {skip}:
            kit.add("3062b", x, y, z, BLACK)


def _outer_corner(b: Haussmann, pair: tuple[str, str], depth: int) -> set[tuple[int, int]]:
    (cx, cy), _ = _corner_cells(b, pair)
    dx = 1 if "east" in pair else -1
    dy = -1 if "south" in pair else 1
    return {(cx + i * dx, cy + j * dy) for i in range(1, depth + 1) for j in range(1, depth + 1) if depth in (i, j)}


def _planted_balcony(kit: Kit, b: Haussmann, z: int) -> None:
    """Railing at the slab edge, a hedge of shrubs behind it and a palm on the street corner."""
    palm = None
    if _corners(b):
        pair = _corners(b)[0]
        (cx, cy), _ = _corner_cells(b, pair)
        dx, dy = (1 if "east" in pair else -1), (-1 if "south" in pair else 1)
        palm = (cx + 2 * dx, cy + 2 * dy)
    _railing(kit, b, z, -2, palm)
    greens = [GREEN, DGREEN, BGREEN]
    cells = [f.cell(u, -1) for f in b.frames.values() for u in range(f.length)]
    cells += [c for p in _corners(b) for c in _outer_corner(b, p, 1)]
    for n, (x, y) in enumerate(cells):
        kit.add("3062b", x, y, z, greens[n % 3])
        kit.add("6141" if n % 2 else "4589", x, y, z + 3, greens[(n + 1) % 3])
    if palm:
        x, y = palm
        for c in range(3):
            kit.add("3062b", x, y, z + 3 * c, RBROWN)
        kit.add("2423", x - 1, y - 3 if dy < 0 else y, z + 9, GREEN)
        kit.add("2423", x - 2 if dx > 0 else x - 1, y - 2 if dy < 0 else y - 1, z + 10, BGREEN, 90)


def _mansard(kit: Kit, b: Haussmann, z: int):
    frames, faces = b.frames, {f.side: f for f in b.faces}
    corners = _corners(b)
    slopes = {c for f in frames.values() for v in (0, 1) for c in _row(f, v)}
    kit.ring(b.x0, b.y0, b.w, b.d, z, 3, b.stone, lambda x, y, c: (x, y) in slopes)
    claimed: set[tuple[int, int]] = set()
    for pair in corners:
        (cx, cy), _ = _corner_cells(b, pair)
        x = cx - 1 if "east" in pair else cx
        y = cy if "south" in pair else cy - 1
        kit.add(
            "3685",
            x,
            y,
            z,
            DBG,
            {("south", "west"): 0, ("south", "east"): 270, ("north", "east"): 180, ("north", "west"): 90}[pair],
        )
        claimed |= {(x + i, y + j) for i in (0, 1) for j in (0, 1)}
    for side, frame in frames.items():
        free = [u for u in faces[side].windows if not {frame.cell(u + i, 0) for i in (0, 1)} & claimed]
        dormers = {u + i for u in free for i in (0, 1)}
        for u in range(frame.length):
            if frame.cell(u, 0) not in claimed and u not in dormers:
                frame.put("4460b", u, 0, z, DBG)
        for u in free:
            frame.put("60592", u, 0, z, WHITE)
            frame.put("3004", u, 1, z, DBG)
            frame.put("3004", u, 1, z + 3, DBG)
            frame.put("3039", u, 0, z + 6, DBG)
    yield "mansard"
    below, z = z, z + 9
    facade = {c for f in frames.values() for c in _row(f, 0)}
    kit.cover(_perimeter(b) - facade, z, DBG)
    _interior(kit, b, z, below, _perimeter(b) | slopes, DBG)
    z += 1
    for x, y in _chimneys(b):
        kit.add("3004", x, y, z, b.stone, 90)
        kit.add("3004", x, y, z + 3, b.stone, 90)
        kit.add("3062b", x, y, z + 6, DORANGE)
        kit.add("3062b", x, y + 1, z + 6, DORANGE)
    yield "roof and chimneys"


def _chimneys(b: Haussmann) -> list[tuple[int, int]]:
    sides = {f.side for f in b.faces}
    out = []
    if "west" not in sides:
        out.append((b.x0, b.y0 + b.d // 2 - 1))
    if "east" not in sides:
        out.append((b.x0 + b.w - 1, b.y0 + b.d // 2 - 1))
    if "north" not in sides:
        out.append((b.x0 + b.w // 2, b.y0 + b.d - 3))
    return out


async def build_building(kit: Kit, name: str, b: Haussmann) -> None:
    for title in building(kit, name, b):
        await kit.step(f"{name}: {title}")


W = D = 32
LAWN = (0, 0, 8, 10)
METRO_HOLE = {(x, y) for x in (21, 22) for y in range(3, 7)}
ROADS = rect(0, 12, W, 6) | rect(19, 18, 2, D - 18)

PROMPT = "Café de Flore and Saint-Germain-des-Prés, Paris: a 32x32 microscale diorama"
STORY = [
    (
        "Hand-scripted by Claude, as a showcase of what Brickyard's parts and checks can do. Every step went through "
        "the same validation Holo uses; ask for a change and Holo takes over."
    ),
    (
        "Café de Flore on its corner of rue Saint-Benoît: white awning, planted first-floor balcony and its palm. "
        "Around it: Les Deux Magots, a striped carousel with a balloon seller, café parasols, a Guimard metro entrance "
        "going down into the base, a Wallace fountain, a Morris column, a kiosk, plane trees and a green bus."
    ),
]


def windows(length: int) -> list[int]:
    return list(range(1, length - 2, 3))


def blocks() -> dict[str, Haussmann]:
    def face(side: str, length: int, **kwargs) -> Face:
        return Face(side, windows(length), **kwargs)

    return {
        "Café de Flore": Haussmann(
            4,
            22,
            12,
            10,
            TAN,
            [
                face("south", 12, shop=DGREEN, awning=WHITE, trim=DGREEN),
                face("east", 10, shop=DGREEN, awning=WHITE, trim=DGREEN),
            ],
            balconies=(5,),
            garden=True,
            reach=3,
        ),
        "Les Deux Magots": Haussmann(
            22,
            22,
            10,
            10,
            VLG,
            [face("south", 10, shop=DGREEN, awning=DGREEN), face("west", 10, shop=DGREEN, awning=DGREEN)],
        ),
        "Bookshop": Haussmann(
            0, 22, 4, 10, LNOUGAT, [face("south", 4, shop=DBLUE, lit=TORANGE)], floors=6, balconies=(2, 6)
        ),
    }


async def base(kit: Kit) -> None:
    kit.fill(0, 0, W, D, 0, BLACK)
    await kit.step("Base plate")
    kit.ring(0, 0, W, D, 1, 1, DBG)
    kit.ring(0, 0, W, D, 4, 1, LBG, start=1)
    for y, bricks, plates in ((3, 2, 1), (4, 1, 2), (5, 1, 0)):
        for c in range(bricks):
            kit.add("3004", 21, y, 1 + 3 * c, DBG)
        for p in range(plates):
            kit.add("3023b", 21, y, 1 + 3 * bricks + p, DBG)
    kit.add("3023b", 21, 6, 1, DBG)
    await kit.step("Base walls and metro stairs")
    kit.fill(0, 0, W, D, 7, DBG, skip=METRO_HOLE)
    walls = {c for c in rect(0, 0, W, D) if c[0] in (0, W - 1) or c[1] in (0, D - 1)}
    plates = kit.support(7, walls, [("3005", 3), ("3005", 3)], DBG)
    await kit.step("Hidden base pillars")
    kit.pending = plates
    await kit.step("Top plates")


async def streets(kit: Kit, rng: random.Random, built: set[tuple[int, int]]) -> None:
    zebra = {(x, y) for x in range(17, 21) for y in (12, 14, 16)}
    dashes = {(x + i, 14) for x in range(0, W, 4) for i in (0, 1)} - rect(15, 14, 8, 1)
    kit.cover(ROADS - zebra - dashes, GROUND, DBG, TILES)
    await kit.step("Boulevard Saint-Germain and rue Saint-Benoît")
    for y in (12, 14, 16):
        kit.add("2431", 17, y, GROUND, WHITE)
    kit.cover(dashes, GROUND, WHITE, TILES)
    await kit.step("Zebra crossing and lane markings")
    ground = rect(0, 0, W, D) - ROADS - built - METRO_HOLE
    kerb = {(x, y) for x, y in ground if {(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)} & ROADS}
    kit.cover(kerb, GROUND, LBG, TILES)
    await kit.step("Kerbs")
    lawn = rect(*LAWN) & ground
    kit.scatter(lawn, GROUND, [(GREEN, 4), (BGREEN, 2), (DGREEN, 1)], rng, MOSAIC["plate"])
    await kit.step("Carousel lawn")
    plaza = rect(0, 0, W, 12) & ground - kerb - lawn
    kit.scatter(plaza, GROUND, [(TAN, 5), (DTAN, 2), (VLBG, 3), (LBG, 1)], rng)
    await kit.step("Place Saint-Germain-des-Prés paving")
    kit.cover(ground - kerb - plaza - lawn, GROUND, VLBG, TILES)
    await kit.step("Sidewalks")


CAROUSEL = (1, 2, 6, 6)
FLOWERS = [RED, YELLOW, 5, 13, 22, WHITE, 25]


async def carousel(kit: Kit, rng: random.Random) -> None:
    x0, y0, w, d = CAROUSEL
    z = GROUND + 1
    kit.add("11213", x0, y0, z, DRED)
    await kit.step("Carousel platform")
    for i, (dx, dy) in enumerate(
        ((1, 1), (1, 2), (1, 3), (1, 4), (2, 1), (3, 1), (4, 1), (4, 2), (4, 3), (4, 4), (2, 4), (3, 4))
    ):
        x, y = x0 + dx, y0 + dy
        if (dx, dy) in ((1, 1), (1, 4), (4, 1), (4, 4)):
            for c in range(3):
                kit.add("3062b", x, y, z + 1 + 3 * c, PGOLD)
            continue
        low = i % 2 == 0
        horse = [WHITE, TAN, BLACK, LBG][i % 4]
        stack = (
            [("3005", horse), ("3062b", PGOLD), ("3062b", PGOLD)]
            if low
            else [("3062b", PGOLD), ("3005", horse), ("3062b", PGOLD)]
        )
        for c, (part, color) in enumerate(stack):
            kit.add(part, x, y, z + 1 + 3 * c, color)
    for c, color in enumerate((PGOLD, WHITE, PGOLD)):
        kit.add("3941", x0 + 2, y0 + 2, z + 1 + 3 * c, color)
    await kit.step("Carousel horses and gold poles")
    top = z + 10
    kit.add("3958", x0, y0, top, WHITE)
    rim = [c for c in rect(x0, y0, w, d) if c[0] in (x0, x0 + w - 1) or c[1] in (y0, y0 + d - 1)]
    for x, y in rim:
        kit.add("6141", x, y, top - 1, TYELLOW if (x + y) % 2 else RED)
    await kit.step("Carousel canopy with fairy lights")
    roof, (x, y, _, _, peak) = shapes.hip(x0, y0, w, d, top + 1, RED)
    for piece in roof:
        if piece["part"] == "3040b" and (piece["x"] + piece["y"]) % 2:
            piece["color"] = WHITE
    kit.pending += roof
    kit.add("3942c", x, y, peak, RED)
    await kit.step("Striped carousel roof")
    for (x, y), base, color in (((0, 0), 0, RED), ((1, 0), 1, YELLOW), ((0, 1), 2, BLUE), ((7, 0), 1, 5)):
        for c in range(base):
            kit.add("3062b", x, y, z + 3 * c, WHITE)
        kit.add("3957a", x, y, z + 3 * base, WHITE)
        kit.add("3062b", x, y, z + 3 * base + 12, color)
        kit.add("6141", x, y, z + 3 * base + 15, color)
    await kit.step("Balloon seller")
    lawn = rect(*LAWN) - rect(*CAROUSEL) - {(0, 0), (1, 0), (0, 1), (7, 0)} - rect(8, 6, 4, 4)
    for x, y in sorted(lawn):
        if rng.random() < 0.55:
            kit.add("6141", x, y, z, rng.choice(FLOWERS))
    await kit.step("Flowerbeds")


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


def table(kit: Kit, x: int, y: int, chairs: list[tuple[int, int]], color: int) -> None:
    kit.add("3062b", x, y, GROUND + 1, BLACK)
    kit.add("98138", x, y, GROUND + 4, WHITE)
    for cx, cy in chairs:
        kit.add("3024", cx, cy, GROUND + 1, color)
        kit.add("3070b", cx, cy, GROUND + 2, color)


def bench(kit: Kit, x: int, y: int, axis: str = "x") -> None:
    far = (x + 3, y) if axis == "x" else (x, y + 3)
    kit.add("3024", x, y, GROUND + 1, BLACK)
    kit.add("3024", *far, GROUND + 1, BLACK)
    kit.add("3710", x, y, GROUND + 2, DGREEN, 0 if axis == "x" else 90)


def car(kit: Kit, x: int, y: int, color: int) -> None:
    kit.add("3020", x, y, GROUND + 1, BLACK)
    kit.add("3001", x, y, GROUND + 2, color)
    kit.add("3039", x + 1, y, GROUND + 5, TBLACK, 90)
    kit.add("3004", x + 3, y, GROUND + 5, color, 90)


def bus(kit: Kit, x: int, y: int) -> None:
    z = GROUND + 1
    kit.add("3795", x, y, z, BLACK)
    kit.add("2456", x, y, z + 1, DGREEN)
    for level in (z + 4, z + 5):
        for sy in (y, y + 1):
            kit.add("3666", x, sy, level, TBLACK)
    kit.add("3795", x, y, z + 6, WHITE)


async def square(kit: Kit) -> None:
    z = GROUND + 1
    kit.add("3633", 20, 3, z, DGREEN, 90)
    kit.add("3633", 23, 3, z, DGREEN, 90)
    kit.add("3633", 20, 7, z, DGREEN)
    for x in (20, 23):
        for c in range(3):
            kit.add("3062b", x, 2, z + 3 * c, DGREEN)
    kit.add("3710", 20, 2, z + 9, DGREEN)
    for x in (20, 23):
        kit.add("3062b", x, 2, z + 10, TORANGE)
        kit.add("4589", x, 2, z + 13, DGREEN)
    kit.add("3069b", 21, 2, z + 10, YELLOW)
    await kit.step("Guimard metro entrance")
    kit.add("3941", 14, 4, z, DGREEN)
    for dx in (0, 1):
        for dy in (0, 1):
            kit.add("3062b", 14 + dx, 4 + dy, z + 3, DGREEN)
    kit.add("2654a", 14, 4, z + 6, DGREEN)
    await kit.step("Wallace fountain")
    for c, color in enumerate((DGREEN, WHITE, YELLOW, WHITE, DGREEN)):
        kit.add("3941", 9, 1, z + 3 * c, color)
    kit.add("2654a", 9, 1, z + 15, DGREEN)
    await kit.step("Morris column")
    kit.add("3003", 29, 7, z, DGREEN)
    kit.add("3003", 29, 7, z + 3, YELLOW)
    kit.add("3003", 29, 7, z + 6, DGREEN)
    kit.add("3942c", 29, 7, z + 9, DGREEN)
    await kit.step("Newspaper kiosk")
    tree(kit, 8, 6, (GREEN, DGREEN, BGREEN))
    await kit.step("Plane tree")
    for (x, y), color in (((26, 2), RED), ((30, 2), WHITE), ((26, 7), WHITE)):
        kit.add("3062b", x, y, z, WHITE)
        kit.add("6141", x, y, z + 3, WHITE)
        kit.add("3062b", x, y, z + 4, WHITE)
        kit.add("43898", x - 1, y - 1, z + 7, color)
        for cx, cy in ((x - 1, y), (x + 1, y), (x, y - 1)):
            if cx < W:
                kit.add("3024", cx, cy, z, RED if color == WHITE else WHITE)
                kit.add("3070b", cx, cy, z + 1, RED if color == WHITE else WHITE)
    await kit.step("Café tables under parasols")
    for x, y in ((18, 9), (19, 8), (11, 5), (24, 5)):
        kit.add("6141", x, y, z, LBG)
    await kit.step("Pigeons")
    for x, y, axis in ((12, 1, "x"), (12, 8, "x"), (17, 3, "y")):
        bench(kit, x, y, axis)
    for x in range(8, W, 3):
        kit.add("3062b", x, 11, z, BLACK)
    await kit.step("Benches and bollards")
    for x, y in ((13, 10), (25, 10), (1, 19), (18, 18), (21, 18)):
        lamp(kit, x, y)
    await kit.step("Street lamps")


async def terraces(kit: Kit) -> None:
    for x in (5, 8, 11, 14):
        table(kit, x, 19, [(x - 1, 19), (x + 1, 19)], NOUGAT)
    for y in (23, 26, 29):
        table(kit, 17, y, [(17, y - 1), (17, y + 1)], NOUGAT)
    await kit.step("Café de Flore terrace")
    for x in (23, 26, 29):
        table(kit, x, 19, [(x - 1, 19), (x + 1, 19)], DGREEN)
    await kit.step("Les Deux Magots terrace")


async def traffic(kit: Kit) -> None:
    bus(kit, 2, 13)
    car(kit, 24, 12, BLACK)
    car(kit, 10, 15, RED)
    kit.add("3020", 19, 25, GROUND + 1, BLACK, 90)
    kit.add("3001", 19, 25, GROUND + 2, SBLUE, 90)
    kit.add("3039", 19, 26, GROUND + 5, TBLACK)
    kit.add("3004", 19, 28, GROUND + 5, SBLUE)
    await kit.step("Traffic")


async def build() -> Kit:
    kit = Kit("Café de Flore, Saint-Germain-des-Prés", PROMPT, W, D)
    rng = random.Random(7)
    houses = blocks()
    built = set().union(*(_footprint(b) for b in houses.values()))
    await base(kit)
    await streets(kit, rng, built)
    await carousel(kit, rng)
    for name, b in houses.items():
        await build_building(kit, name, b)
    await square(kit)
    await terraces(kit)
    await traffic(kit)
    kit.save(STORY)
    return kit
