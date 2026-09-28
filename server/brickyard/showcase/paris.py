"""The Seine at Saint-Germain, Paris: a 32x32 microscale slice from the river up to the boulevard."""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from brickyard import ldraw
from brickyard.model import ROTATIONS, place
from brickyard.shapes import BRICKS, PLATES, TILE_RUN, TILES, rect
from brickyard.showcase.kit import Frame, Kit

BLACK, WHITE, LBG, DBG, TAN, DTAN, VLG, VLBG = 0, 15, 71, 72, 19, 28, 503, 151
GREEN, BGREEN, DGREEN, DRED, RED, RBROWN, DORANGE = 2, 10, 288, 320, 4, 70, 484
TYELLOW, TORANGE, TBLACK, NOUGAT, LNOUGAT, YELLOW, DBLUE, SBLUE = 46, 57, 40, 84, 78, 14, 272, 379
BLUE, PGOLD = 1, 297

GROUND = 27
DOCK = 8
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
    yield "shopfront"

    r = b.reach
    ledge = _deep(kit, b, z, b.stone) if r == 3 else _perimeter(b)
    if r != 3:
        kit.cover(ledge, z, b.stone)
    _interior(kit, b, z)
    z += 1
    awnings = {s for s in frames if faces[s].awning is not None}
    awning_corners = [p for p in corners if set(p) <= awnings]
    blocks = {p: {_out(b, p, i, j) for i in (r - 1, r) for j in (r - 1, r)} for p in awning_corners}
    covered: dict[tuple[int, int], int] = {}
    for side in sorted(awnings):
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
        _interior(kit, b, z)
        z += 1
        glass = {f.cell(u + i, 0) for s, f in frames.items() for u in faces[s].windows for i in (0, 1)}
        backs = {f.cell(u + i, 1) for s, f in frames.items() for u in faces[s].windows for i in (0, 1)}
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
    _interior(kit, b, z)
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


def _interior(kit: Kit, b: Haussmann, z: int, color: int | None = None) -> None:
    """Plates filling the inside at `z`."""
    kit.cover(_footprint(b) - _perimeter(b), z, b.stone if color is None else color)


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
    z += 9
    facade = {c for f in frames.values() for c in _row(f, 0)}
    kit.cover(_perimeter(b) - facade, z, DBG)
    _interior(kit, b, z, DBG)
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


def build_building(kit: Kit, name: str, b: Haussmann) -> None:
    for title in building(kit, name, b):
        kit.step(f"{name}: {title}")


W = D = 32
RIVER = 7
QUAY = 11
BRIDGE = (23, 0, 8, 11)
STAIRS = [(13 + k, 10 + 2 * k) for k in range(10)]
VAULTS = (2, 8)
CUTWATER = rect(21, 5, 2, 2)
EMBOSSED = {4: "15533", 2: "98283", 1: "3005"}
ROADS = rect(0, 14, W, 4) | rect(19, 18, 2, D - 18) | rect(25, 0, 4, 14)
WATER = [(43, 4), (33, 2), (SBLUE, 1)]
BARGE = (2, 4, 16, 3)

PROMPT = "The Seine at Saint-Germain-des-Prés, Paris: a 32x32 microscale diorama"
STORY = [
    (
        "Hand-scripted by Claude, as a showcase of what Brickyard's parts and checks can do. Every step went through "
        "the same validation Holo uses; ask for a change and Holo takes over."
    ),
    (
        "A slice of Paris in three levels: the Seine with a moored péniche, the low dock with a picnic and a buvette "
        "in the vaults of the quay wall, balustraded stairs climbing beside a stone bridge with a cutwater, ribbed "
        "vault and gilded medallion, then the quai with a plane tree and a chestnut in bloom, "
        "bouquinistes' green boxes on the parapet, "
        "and on top Café de Flore on its corner, Les Deux Magots and a bookshop."
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


def _vaulted(x: int, y: int, c: int) -> bool:
    if y != QUAY:
        return False
    if c >= 4:
        return 1 <= x <= 12
    return any(n <= x < n + 4 for n in VAULTS)


def _stone(x: int, y: int, c: int) -> int:
    if y != QUAY:
        return DBG
    return DTAN if c == 0 or (3 * x + 5 * c) % 7 == 0 else TAN


def base(kit: Kit, rng: random.Random) -> None:
    kit.fill(0, 0, W, D, 0, BLACK)
    kit.step("Base plate")
    river = rect(0, 0, W, RIVER) - rect(*BARGE) - _piers()
    kit.cover(river, 1, DBLUE)
    kit.scatter(river, 2, WATER, rng)
    kit.step("The Seine")
    kit.ring(
        0, RIVER, W, D - RIVER, 1, 2, lambda x, y, c: (DBG if c == 0 else LBG) if y == RIVER else DBG, kind=EMBOSSED
    )
    kit.step("Dock wall")
    kit.fill(0, RIVER, W, D - RIVER, 7, DBG)
    kit.step("Dock plates")
    kit.ring(0, QUAY, W, D - QUAY, DOCK, 6, _stone, _vaulted, EMBOSSED)
    kit.step("Quay wall in dressed stone")
    for n in VAULTS:
        kit.add("15254", n - 1, QUAY, DOCK + 12, TAN)
        for z in range(DOCK, 26, 3):
            kit.run(n, QUAY + 1, z, 4, TYELLOW if n == VAULTS[0] and z < DOCK + 12 else DBG)
    bar, gate = VAULTS
    kit.add("3010", bar, QUAY, DOCK, DRED)
    kit.add("2431", bar, QUAY, DOCK + 3, TAN)
    for z in (DOCK, DOCK + 6):
        kit.add("3185", gate, QUAY, z, BLACK)
    kit.step("Vaults under the quai: a lit buvette and an iron gate")
    kit.cover(rect(0, QUAY - 1, 12, 2), 26, TAN)
    kit.cover(rect(0, QUAY, W, D - QUAY) - rect(0, QUAY, 12, 1), 26, DBG)
    kit.step("Street plates")


def stairs(kit: Kit) -> None:
    for x, top in STAIRS:
        body = top - 1 - DOCK
        for c in range(body // 3):
            kit.add("3004", x, 9, DOCK + 3 * c, TAN, 90)
        for p in range(body % 3):
            kit.add("3023b", x, 9, DOCK + 3 * (body // 3) + p, TAN, 90)
        kit.add("3070b", x, 10, top - 1, LBG)
        kit.add("3062b", x, 9, top - 1, VLBG)
        kit.add("3070b", x, 9, top + 2, LBG)
    x, _ = STAIRS[0]
    kit.add("3005", x - 1, 9, DOCK, LBG)
    kit.add("98138", x - 1, 9, DOCK + 3, LBG)
    kit.step("Stairs up the quay wall with a stepped balustrade")


def _piers() -> set[tuple[int, int]]:
    x0, _, w, _ = BRIDGE
    return rect(x0, 5, w, 2) | {(x0, 0), (x0 + w - 1, 0)} | CUTWATER


def bridge(kit: Kit) -> None:
    x0, _, w, d = BRIDGE
    east = x0 + w - 1
    passage = {(x0, 6), (east, 6)}
    for z in range(1, 25, 3):
        cells = _piers() if z < 13 else rect(x0, 5, w, 2) - {(x0, 5), (east, 5)} - (passage if z >= 19 else set())
        kit.cover(cells, z, LBG, BRICKS)
    kit.add("3039", *min(CUTWATER), 13, LBG, 90)
    kit.step("Bridge pier with its cutwater")
    for x in (x0, east):
        kit.add("15254", x, 0, 13, LBG, 90)
        for z in (19, 22):
            kit.run(x, 0, z, 6, LBG, "y", EMBOSSED, stagger=z == 22)
        for z in range(DOCK, 26, 3):
            kit.add("3005", x, 10, z, LBG)
            if z < 20:
                kit.add("3005", x, 9, z, LBG)
        kit.add("3024", x, 6, 19, LBG)
        kit.add("6182", x, 6, 20, LBG, 90)
    kit.step("Arches over the river and a passage under the bridge")
    kit.cover(rect(x0, 0, w, RIVER) - passage, 25, LBG)
    for y, color in ((0, LBG), (2, DBG), (4, DBG)):
        kit.add("15254", x0 + 1, y, 19, color)
    kit.step("Vault ribs under the deck")
    kit.fill(x0 - 1, 0, w + 2, 9, 26, LBG)
    kit.fill(x0, 9, w, 2, 26, LBG)
    kit.step("Bridge deck with an overhanging cornice")
    for x in (x0 - 1, east + 1):
        for y in range(0, 9, 2):
            kit.add("3024", x, y, 25, LBG)
        kit.run(x, 0, GROUND, 9, VLBG, "y", TILE_RUN)
    kit.mount("14769", x0 - 1, 2, 19, PGOLD, "west")
    kit.add("3024", x0 + 3, 8, 25, BLACK)
    kit.add("3062b", x0 + 3, 8, 22, TYELLOW)
    kit.step("Corbels, a gilded medallion and a lantern in the passage")
    for x in (x0 + 1, east - 1):
        kit.run(x, 0, GROUND, d, LBG, "y", TILE_RUN)
    for x in (x0, east):
        for y in range(d):
            kit.add("3005" if y in (0, 5, d - 1) else "3062b", x, y, GROUND, LBG if y in (0, 5, d - 1) else VLBG)
        kit.run(x, 0, GROUND + 3, d, LBG, "y", TILE_RUN)
    for x, y in ((x0 + 1, 2), (x0 + w - 2, 2), (x0 + 1, 8), (x0 + w - 2, 8)):
        lamp(kit, x, y)
    kit.step("Bridge pavements, parapets and lamps")


def streets(kit: Kit, built: set[tuple[int, int]]) -> None:
    zebra = {(x, y) for x in range(15, 19) for y in (14, 16)}
    dashes = {(x + i, 15) for x in range(0, W, 4) for i in (0, 1)} - rect(13, 15, 8, 1) - rect(24, 15, 6, 1)
    kit.cover(ROADS - zebra - dashes, GROUND, DBG, TILES)
    for y in (14, 16):
        kit.add("2431", 15, y, GROUND, WHITE)
    kit.cover(dashes, GROUND, WHITE, TILES)
    kit.step("Quai, rue Saint-Benoît and the bridge road")
    parapet = {(x, QUAY) for x in range(W)} - rect(21, QUAY, 2, 1) - rect(24, QUAY, 6, 1)
    street = rect(0, QUAY, W, D - QUAY) - ROADS - built - parapet
    kerb = {(x, y) for x, y in street if {(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)} & ROADS}
    kit.cover(kerb, GROUND, LBG, TILES)
    kit.cover(street - kerb, GROUND, VLBG, TILES)
    kit.step("Pavements")
    kit.cover(parapet, GROUND, TAN, BRICKS)
    stalls = [x for x in (1, 7, 13) if all((x + i, QUAY) in parapet for i in range(4))]
    boxes = {(x + i, QUAY) for x in stalls for i in range(4)}
    kit.cover(parapet - boxes, GROUND + 3, LBG, TILES)
    for x in stalls:
        kit.add("3010", x, QUAY, GROUND + 3, DGREEN)
        kit.add("3710", x, QUAY, GROUND + 6, DGREEN)
    kit.step("Parapet with the bouquinistes' green boxes")


def dock(kit: Kit) -> None:
    stair_cells = {(x, y) for x, _ in STAIRS for y in (9, 10)} | {(STAIRS[0][0] - 1, 9)}
    sides = {(x, y) for x in (BRIDGE[0], BRIDGE[0] + BRIDGE[2] - 1) for y in (9, 10)}
    picnic = rect(4, 7, 2, 2)
    cells = rect(0, RIVER, W, QUAY - RIVER) - stair_cells - sides - picnic
    kit.cover(cells, DOCK, LBG, TILES)
    for i, (x, y) in enumerate(sorted(picnic)):
        kit.add("3070b", x, y, DOCK, RED if i % 3 == 0 else WHITE)
    kit.step("Dock paving and a picnic blanket")
    z = DOCK + 1
    kit.add("3062b", 6, 8, z, DGREEN)
    kit.add("6141", 6, 8, z + 3, DGREEN)
    kit.add("3069b", 6, 7, z, TAN)
    for x in (1, 8, 15, 21, 31):
        kit.add("3062b", x, RIVER, z, BLACK)
    bench(kit, 5, 10, "x", DOCK)
    bench(kit, 16, 7, "x", DOCK)
    kit.step("Life on the dock: bollards and benches")
    plane(kit, 8, 8, DOCK, YOUNG, 4)
    kit.step("A young plane tree on the dock")


def barge(kit: Kit) -> None:
    x0, y0, w, d = BARGE
    kit.fill(x0, y0, w, d, 1, BLACK, BRICKS)
    kit.fill(x0, y0, w, d, 4, RBROWN)
    kit.step("Péniche hull and deck")
    cabin = (x0 + 8, y0, 7, d)
    glass = {(x0 + 9, y0), (x0 + 11, y0), (x0 + 13, y0)}
    kit.ring(*cabin, 5, 1, WHITE, lambda x, y, c: (x, y) in glass)
    for x, y in glass:
        kit.add("3005", x, y, 5, 43)
    kit.fill(*cabin, 8, DBG)
    kit.step("Péniche cabin")
    for x in range(x0 + 1, x0 + 7, 2):
        kit.add("3062b", x, y0, 5, DBG)
        kit.add("6141", x, y0, 8, GREEN)
    table(kit, x0 + 4, y0 + 1, [(x0 + 3, y0 + 1), (x0 + 5, y0 + 1)], WHITE, 4)
    for x, y in ((x0 + 9, y0 + 1), (x0 + 12, y0 + 1)):
        kit.add("3062b", x, y, 9, DBG)
        kit.add("4589", x, y, 12, GREEN)
    kit.step("Flower pots and a deck table")


def square(kit: Kit) -> None:
    z = GROUND + 1
    kit.add("3941", 7, 12, z, DGREEN)
    for dx in (0, 1):
        for dy in (0, 1):
            kit.add("3062b", 7 + dx, 12 + dy, z + 3, DGREEN)
    kit.add("2654a", 7, 12, z + 6, DGREEN)
    kit.step("Wallace fountain")
    for c, color in enumerate((DGREEN, WHITE, YELLOW, WHITE, DGREEN)):
        kit.add("3941", 17, 12, z + 3 * c, color)
    kit.add("2654a", 17, 12, z + 15, DGREEN)
    kit.step("Morris column")
    for x, y in ((16, 13), (1, 19), (18, 18), (21, 18)):
        lamp(kit, x, y)
    kit.step("Street lamps")
    plane(kit, 4, 13)
    kit.step("A plane tree on the quai")
    chestnut(kit, 13, 13)
    kit.step("A horse chestnut in bloom")


def centered(kit: Kit, part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> None:
    """`part` with its origin stud on (x, y), for parts whose stud is off their footprint's center."""
    pos = place(ldraw.resolve(part), 0, 0, z, color, rotation).pos
    kit.add(part, x - round(pos[0] / ldraw.STUD - 0.5), y - round(pos[2] / ldraw.STUD - 0.5), z, color, rotation)


LEAF_TIPS = [(2, 2), (-2, 0), (0, -3)]
FAR_TIP = [(0, -3)]
PLANE = [
    [("2417", 90, -1, 0, DGREEN), ("2417", 270, 1, 0, GREEN)],
    [("2417", 0, 0, -1, BGREEN), ("2417", 180, 0, 1, GREEN)],
    [("2423", 90, 0, 0, GREEN), ("2423", 270, 0, 0, BGREEN)],
]
YOUNG = [
    [("2417", 90, -1, 0, GREEN), ("2417", 270, 1, 0, BGREEN)],
    [("2423", 90, 0, 0, BGREEN), ("2423", 270, 0, 0, GREEN)],
]
CHESTNUT = [("2417", 0, DGREEN), ("2417", 90, GREEN), ("2417", 180, DGREEN), ("2417", 270, GREEN)]


def leaf(kit: Kit, part: str, x: int, y: int, z: int, color: int, rotation: int, tips, bloom: tuple[str, int]) -> None:
    """A leaf plate stud-centered on (x, y), with `bloom` parts on the given tip studs."""
    centered(kit, part, x, y, z, color, rotation)
    r = ROTATIONS[rotation]
    for sx, sy in tips:
        kit.add(bloom[0], x + r[0] * sx + r[2] * sy, y + r[6] * sx + r[8] * sy, z + 1, bloom[1])


def plane(kit: Kit, x: int, y: int, ground: int = GROUND, tiers=PLANE, trunk: int = 5) -> None:
    z = ground + 1
    for c in range(trunk):
        kit.add("3062b", x, y, z + 3 * c, (DTAN, TAN)[c % 2])
    z += 3 * trunk
    kit.add("11212", x - 1, y - 1, z, DGREEN)
    z += 1
    for n, tier in enumerate(tiers):
        if n:
            kit.add("3062b", x, y, z, GREEN)
            z += 3
        for i, (part, rotation, dx, dy, color) in enumerate(tier):
            leaf(kit, part, x + dx, y + dy, z + i, color, rotation, FAR_TIP, ("6141", BGREEN))
        z += len(tier)
    kit.add("6141", x, y, z, BGREEN)


def chestnut(kit: Kit, x: int, y: int) -> None:
    z = GROUND + 1
    for c in range(5):
        kit.add("3062b", x, y, z + 3 * c, RBROWN)
    z += 15
    for part, rotation, color in CHESTNUT:
        leaf(kit, part, x, y, z, color, rotation, LEAF_TIPS, ("24866", WHITE))
        kit.add("3062b", x, y, z + 1, DGREEN)
        z += 4
    leaf(kit, "2423", x, y, z, DGREEN, 0, FAR_TIP, ("24866", WHITE))
    leaf(kit, "2423", x, y, z + 1, GREEN, 180, FAR_TIP, ("24866", WHITE))
    kit.add("24866", x, y, z + 2, WHITE)


def lamp(kit: Kit, x: int, y: int, ground: int = GROUND) -> None:
    for c in range(3):
        kit.add("3062b", x, y, ground + 1 + 3 * c, BLACK)
    kit.add("3062b", x, y, ground + 10, TYELLOW)
    kit.add("4589", x, y, ground + 13, BLACK)


def table(kit: Kit, x: int, y: int, chairs: list[tuple[int, int]], color: int, ground: int = GROUND) -> None:
    kit.add("3062b", x, y, ground + 1, BLACK)
    kit.add("98138", x, y, ground + 4, WHITE)
    for cx, cy in chairs:
        kit.add("3024", cx, cy, ground + 1, color)
        kit.add("3070b", cx, cy, ground + 2, color)


def bench(kit: Kit, x: int, y: int, axis: str = "x", ground: int = GROUND) -> None:
    far = (x + 3, y) if axis == "x" else (x, y + 3)
    kit.add("3024", x, y, ground + 1, BLACK)
    kit.add("3024", *far, ground + 1, BLACK)
    kit.add("3710", x, y, ground + 2, DGREEN, 0 if axis == "x" else 90)


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


def terraces(kit: Kit) -> None:
    for x in (5, 8, 11, 14):
        table(kit, x, 19, [(x - 1, 19), (x + 1, 19)], NOUGAT)
    for y in (23, 26, 29):
        table(kit, 17, y, [(17, y - 1), (17, y + 1)], NOUGAT)
    kit.step("Café de Flore terrace")
    for x in (23, 26, 29):
        table(kit, x, 19, [(x - 1, 19), (x + 1, 19)], DGREEN)
    kit.step("Les Deux Magots terrace")


def traffic(kit: Kit) -> None:
    bus(kit, 2, 14)
    car(kit, 24, 14, BLACK)
    car(kit, 10, 16, RED)
    kit.add("3020", 26, 3, GROUND + 1, BLACK, 90)
    kit.add("3001", 26, 3, GROUND + 2, SBLUE, 90)
    kit.add("3039", 26, 4, GROUND + 5, TBLACK)
    kit.add("3004", 26, 6, GROUND + 5, SBLUE)
    kit.step("Traffic")


def build() -> Kit:
    kit = Kit("paris", "Paris, the Seine at Saint-Germain", PROMPT)
    rng = random.Random(7)
    houses = blocks()
    built = set().union(*(_footprint(b) for b in houses.values()))
    base(kit, rng)
    barge(kit)
    stairs(kit)
    dock(kit)
    bridge(kit)
    streets(kit, built)
    for name, b in houses.items():
        build_building(kit, name, b)
    square(kit)
    terraces(kit)
    traffic(kit)
    kit.save(STORY)
    return kit
