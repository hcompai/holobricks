"""Hogwarts' south front above the Black Lake, the first film's arrival shot, after Stuart Craig's design and LEGO 71043.

Each building is planned first, as solids in brick courses; the crag is then shaped to carry the plans, and each
building rises in its own step on top of it.
"""

import heapq
import math
import random

BLACK, TAN, DTAN, LBG, DBG, GOLD, LIT = 0, 19, 28, 71, 72, 297, 46
GREEN, DGREEN, OLIVE = 2, 288, 330
DBLUE, TLBLUE, TMBLUE = 272, 43, 41
DBROWN, BROWN, RED = 308, 70, 4
WHITE, YELLOW, ORANGE, LAVENDER, PINK, AZURE, CLEAR, SQUID = 15, 14, 25, 31, 29, 322, 47, 320
FLOWERS = (WHITE, YELLOW, LAVENDER, PINK, YELLOW)
PINES = (("3471", GREEN), ("3470", GREEN), ("3471", GREEN), ("2435", DGREEN), ("2435", OLIVE))
NEAREST = {DTAN: (TAN,), OLIVE: (DGREEN, GREEN), GOLD: (YELLOW,), SQUID: (RED,), LBG: (DBG,), DGREEN: (GREEN,)}

SITE_W, SITE_D = 192, 164
"""The crag and the lake around it, in studs."""
S = 2
"""The crag is shaped on 2x2-stud cells, so its faces are big facets and not a noise of small bricks."""
PLATEAU = 40
"""Courses of rock under the castle's floors."""
CLIFF = 3.2
"""Courses the crag falls per stud away from the buildings on it."""
CX, CY = 92, 84
"""The Marble Staircase Tower's center: every building is placed from it, after the film castle's ground-floor plan."""
YARD = PLATEAU - 2
"""The Viaduct Courtyard's floor, level with the viaduct's deck."""
LAKE = 12
"""Studs of water from the foot of the crag to the lake's edge, on average; the shore wanders from 4 to 23."""
FRONT = 14
"""Studs more of lake in front, where the boats cross."""
SIDES = ((1, 0), (-1, 0), (0, 1), (0, -1))


def z(k):
    """The plate a course starts at: the lake bed is plate 0, course 0 sits on it."""
    return 1 + 3 * k


def noise(x, y):
    """Smooth value in -1..1."""
    return (
        0.5 * math.sin(0.37 * x + 0.11 * y)
        + 0.3 * math.sin(0.53 * y - 0.21 * x + 1.3)
        + 0.2 * math.sin(1.1 * x + 0.7 * y + 2.1)
    )


def fit(part, color):
    """`color` if the part comes in it, else the nearest shade it comes in."""
    for option in (color, *NEAREST.get(color, ())):
        if option in colors(part):
            return option
    raise ValueError(f"{part} comes in none of {color}, {NEAREST.get(color)}")


def erode(cells, ridge=None):
    """The cells a roof keeps one step up: in from every side, or only from the long sides along a ridge x or y."""
    near = {"x": ((0, -1), (0, 1)), "y": ((-1, 0), (1, 0))}.get(
        ridge, [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    )
    return {(x, y) for x, y in cells if all((x + dx, y + dy) in cells for dx, dy in near)}


class Plan:
    """A building's solids and parts in brick courses, laid out before the crag is shaped to carry it."""

    def __init__(self, title, footing=False):
        """`footing`: only what stands at the water's edge raises the crag, like a viaduct's piers."""
        self.title, self.footing, self.calls = title, footing, []

    def fill(self, cells, k0, k1, color, sloped=False):
        self.calls.append(("fill", set(cells), k0, k1, color, sloped))

    def roof(self, cells, k0, color, pitch=2):
        """A hipped roof stepping in a stud every `pitch` courses; returns the course above its top."""
        self.calls.append(("roof", set(cells), k0, color, pitch))
        cells, k = set(cells), k0
        while cells:
            cells, k = erode(cells), k + pitch
        return k

    def cone(self, cx, cy, r, k0, height, color):
        """A spire of shrinking circles; returns the course above its tip."""
        self.calls.append(("cone", cx, cy, r, k0, height, color))
        return k0 + next((i for i in range(height) if not disc(cx, cy, r * (1 - i / height))), height)

    def part(self, part, x, y, k, color, rotation=0):
        self.calls.append(("part", part, x, y, k, color, rotation))

    def feet(self):
        """The lowest course of each stud the plan's walls stand on, up to the plateau."""
        out = {}
        for call in self.calls:
            if call[0] == "fill" and call[2] <= (1 if self.footing else PLATEAU):
                for c in call[1]:
                    out[c] = min(call[2], out.get(c, call[2]))
        return out


def courses(color):
    """A color by stud and course, as `fill` takes it by stud and plate."""
    return (lambda x, y, plate: color(x, y, (plate - 1) // 3)) if callable(color) else color


def build(plan, ground):
    """The plan's step: solids from the crag's surface up, parts in colors they come in."""
    step(plan.title)
    for kind, *args in plan.calls:
        if kind == "fill":
            cells, k0, k1, color, sloped = args
            starts = {}
            for c in cells:
                starts.setdefault(max(k0, ground(*c)), set()).add(c)
            for k, group in starts.items():
                if k < k1:
                    fill(group, z(k), 3 * (k1 - k), courses(color), sloped)
        elif kind == "roof":
            cells, k0, color, pitch = args
            roof(cells, z(k0), courses(color), pitch=3 * pitch)
        elif kind == "cone":
            cx, cy, r, k0, height, color = args
            cone(cx, cy, r, z(k0), 3 * height, courses(color))
        else:
            part, x, y, k, color, rotation = args
            brick(part, x, y, z(k), fit(part, color), rotation)


# The crag


def terrain(pads):
    """Height in courses and the kind of each 2x2 cell: the castle's pads, crags falling from them, the lake at 0."""
    height, kind = {}, {}
    reach = math.ceil(PLATEAU / CLIFF / S) + 3
    for X in range(SITE_W // S):
        for Y in range(SITE_D // S):
            x, y = S * X + 1, S * Y + 1
            wobble = noise(x * 0.18, y * 0.18), noise(x * 0.7, y * 0.7)
            stretch = 1 + 0.35 * noise(X * 0.45 + 7, Y * 0.45) + 0.1 * (random.random() - 0.5)
            best, name = 0.0, "lake"
            for PX in range(X - reach, X + reach + 1):
                for PY in range(Y - reach, Y + reach + 1):
                    if (PX, PY) not in pads or pads[PX, PY][1] == "footing":
                        continue
                    d = max(0.0, S * math.hypot(X - PX, Y - PY) - 0.6 * (1 + wobble[0]) - 0.8 * wobble[1]) * stretch
                    if pads[PX, PY][0] - d * CLIFF > best:
                        best, name = pads[PX, PY][0] - d * CLIFF, "crag"
            height[X, Y], kind[X, Y] = max(0, math.floor(best)), name
    for c, (h, name) in pads.items():
        if c in height and (name != "footing" or height[c] < h):
            height[c], kind[c] = h, name
    keep = shore(height)
    return {c: h for c, h in height.items() if c in keep}, {c: k for c, k in kind.items() if c in keep}


def shore(height):
    """The crag and the lake around it: water reaches an uneven distance from the rock, filling any bay it encloses."""
    far = {c: 0.0 for c, h in height.items() if h > 0}
    queue = [(0.0, c) for c in far]
    while queue:
        d, (X, Y) = heapq.heappop(queue)
        if d > far[X, Y]:
            continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            c, d2 = (X + dx, Y + dy), d + S * math.hypot(dx, dy)
            if c in height and d2 < far.get(c, math.inf) and d2 <= LAKE + FRONT + 11:
                far[c] = d2
                heapq.heappush(queue, (d2, c))

    def reach(X, Y):
        x, y = S * X, S * Y
        front = FRONT * min(1.0, max(0.0, (34 - y) / 24))
        return max(2.0 * S, LAKE + front + 8 * noise(x * 0.05 + 3, y * 0.05) + 3 * noise(x * 0.21, y * 0.21 + 5))

    keep = {c for c, d in far.items() if d <= reach(*c)}
    edge = [c for c in height if c not in keep and not all((c[0] + dx, c[1] + dy) in height for dx, dy in SIDES)]
    outside = set(edge)
    while edge:
        X, Y = edge.pop()
        for dx, dy in SIDES:
            c = (X + dx, Y + dy)
            if c in height and c not in keep and c not in outside:
                outside.add(c)
                edge.append(c)
    return set(height) - outside


def pads(plans, grounds):
    """Flat ground under every building and lawn, one stud wider, and the cells a building stands in.

    A cell's ground meets the highest foot in it and the lower feet there are cut, so no stud hangs over the ground.
    Footings at the water's edge only raise the ground to course 1, so the crag keeps its height where it is higher.
    """
    base = {}
    for plan in plans:
        for c, k in plan.feet().items():
            base[c] = min(k, base.get(c, k))
    for cells, k, _ in grounds:
        for c in cells:
            base[c] = min(k, base.get(c, k))
    own = {}
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


def rock(x, y, k):
    n = noise(x * 0.25 + k * 0.5, y * 0.25 - k * 0.3)
    return DBG if n > -0.15 else DTAN if n < -0.75 else LBG


def grass(x, y):
    n = noise(x * 0.5 + 11, y * 0.5)
    return DGREEN if n > 0.45 else OLIVE if n < -0.6 else GREEN


def studs(X, Y):
    return box(S * X, S * Y, S, S)


BEVELS = {3: "3684c", 2: "3678b", 1: "3039"}
CORNERS = {3: "3685", 2: "3688", 1: "3045"}
OUTWARD = {(0, -1): 0, (-1, 0): 90, (1, 0): 270, (0, 1): 180}
CORNER_TURNS = {((0, -1), (1, 0)): 0, ((-1, 0), (0, -1)): 90, ((0, 1), (-1, 0)): 180, ((1, 0), (0, 1)): 270}


def bevels(height, kind, own):
    """2x2 slopes on the crag's step edges, as tall as the drop allows; returns the cells they cap."""
    capped = set()
    for (X, Y), h in sorted(height.items()):
        if h == 0 or kind[X, Y] == "footing" or (X, Y) in own:
            continue
        drops = {
            d: h - height[X + d[0], Y + d[1]]
            for d in OUTWARD
            if (X + d[0], Y + d[1]) in height and height[X + d[0], Y + d[1]] < h
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
            if size == 3 and random.random() < 0.3:
                size = 2
            part, rotation = BEVELS[size], OUTWARD[d]
        color = OLIVE if random.random() < 0.1 else rock(S * X, S * Y, h - 1)
        brick(part, S * X, S * Y, z(h - size), fit(part, color), rotation)
        capped.add((X, Y))
    return capped


# The castle


def windows(r, n, rows, tall=2):
    """Window colors on a round wall of radius r: n per row, each 1 stud wide and `tall` courses, mostly lit."""
    spacing = 2 * math.pi / n

    def color(a, k):
        i = round(a / spacing)
        if abs(a - i * spacing) * r > 0.6:
            return None
        for row, k0 in enumerate(rows):
            if k0 <= k < k0 + tall:
                return BLACK if (3 * i + row) % 4 == 0 else LIT
        return None

    return color


def round_wall(cx, cy, bands, window):
    def color(x, y, k):
        if k in bands:
            return DTAN
        return window(math.atan2(y + 0.5 - cy, x + 0.5 - cx), k) or TAN

    return color


def slate(cx, cy, k0, dormers=0):
    """Dark grey slate, with rows of small black dormer windows every 8 courses."""
    spacing = 2 * math.pi / max(dormers, 1)

    def color(x, y, k):
        if dormers and (k - k0) % 8 == 5:
            a = math.atan2(y + 0.5 - cy, x + 0.5 - cx) + ((k - k0) // 8) * spacing / 2
            if abs(a - round(a / spacing) * spacing) < 0.08:
                return BLACK
        return DBG

    return color


def stone(bands):
    return lambda x, y, k: DTAN if k in bands else TAN


def ivy(x, y, k, k0):
    """Ivy climbing a wall from its foot in patches, thinning out with height."""
    n = noise(x * 0.6 + k * 0.35, y * 0.6 - k * 0.25)
    if n > 0.3 + 0.1 * (k - k0):
        return DGREEN if n > 0.55 + 0.1 * (k - k0) else GREEN
    return None


def spire(p, cx, cy, r, k0, height, finials, dormers=0):
    """A slate cone on a round tower centered on a stud corner, and its finial."""
    tip = p.cone(cx, cy, r, k0, height, slate(cx, cy, k0, dormers))
    finials.append((cx - 1, cy - 1, tip))


def round_tower(p, cx, cy, r, k0, k1, spire_courses, finials):
    """A round stone tower with bands, windows, a corbelled crown and a slate spire `spire_courses` tall."""
    bands = {k0, k0 + 1, *range(k0 + 10, k1 - 4, 12)}
    p.fill(disc(cx, cy, r), k0, k1 - 2, round_wall(cx, cy, bands, windows(r, 8, list(range(k0 + 5, k1 - 6, 6)))))
    p.fill(disc(cx, cy, r + 0.5), k1 - 2, k1, DTAN)
    spire(p, cx, cy, r + 0.5, k1, spire_courses, finials)


def gable_roof(p, x0, y0, w, d, k0, ridge, pitch=2, slates=DBG):
    """A steep slate roof with tan crow-stepped gables at both ends of its ridge; returns the course above it."""
    cells, k = box(x0, y0, w, d), k0
    ends = {x0, x0 + w - 1} if ridge == "x" else {y0, y0 + d - 1}
    while cells:
        gable = {c for c in cells if (c[0] if ridge == "x" else c[1]) in ends}
        p.fill(cells - gable, k, k + pitch, slates, sloped=True)
        p.fill(gable, k, k + pitch + 1, TAN)
        cells, k = erode(cells, ridge), k + pitch
    return k + 1


def pinnacle(p, x, y, k, rounds=3):
    for i in range(rounds):
        p.part("3062b", x, y, k + i, TAN)
    p.part("4589", x, y, k + rounds, DBG)


def great_hall(finials):
    """41x14 on the cliff edge: ten bays of tall lit lancets between buttresses, pinnacles above a steep gabled roof."""
    p = Plan("The Great Hall: lit lancets between buttresses, pinnacles, a steep slate roof")
    x0, y0, w, d = CX - 53, CY - 29, 41, 14
    x1, y1, eaves = x0 + w - 1, y0 + d - 1, PLATEAU + 26

    def color(x, y, k):
        u = (x - x0) % 4
        if y in (y0, y1) and u and PLATEAU + 4 <= k <= PLATEAU + (22 if u == 2 else 20):
            return LIT
        if x in (x0, x1) and 4 <= y - y0 <= 9 and PLATEAU + 5 <= k <= PLATEAU + 22 and (y - y0) not in (6, 7):
            return LIT
        if k < PLATEAU + 2 or k in (PLATEAU + 13, eaves - 1):
            return DTAN
        return TAN

    p.fill(box(x0, y0, w, d), PLATEAU, eaves, color)
    for x in range(x0 + 4, x1 + 1, 4):
        for y, outer, turn in ((y0 - 1, y0 - 2, 0), (y1 + 1, y1 + 1, 180)):
            p.fill([(x, y0 - 2 if turn == 0 else y1 + 2)], PLATEAU, PLATEAU + 17, stone({PLATEAU, PLATEAU + 13}))
            p.part("3040b", x, outer, PLATEAU + 17, TAN, turn)
            p.fill([(x, y)], PLATEAU, eaves, stone({PLATEAU, PLATEAU + 13, eaves - 1}))
            pinnacle(p, x, y, eaves)
    dormers = lambda x, y, k: BLACK if k - eaves in (4, 5) and (x - x0) % 4 == 2 else DBG
    gable_roof(p, x0, y0, w, d, eaves, ridge="x", slates=dormers)
    ridge_y = y0 + d // 2 - 1
    for x in (x0 + 12, x1 - 13):
        for i in range(5):
            p.part("3941", x, ridge_y, eaves + 14 + i, TAN if i < 4 else DTAN)
        p.part("3942c", x, ridge_y, eaves + 19, DBG)
        finials.append((x, ridge_y, eaves + 21))
    for i in range(46):
        p.part("87081", x0 - 2, y0 - 2, PLATEAU + i, DTAN if i % 9 == 0 else TAN)
    turret = p.cone(x0, y0, 2.5, PLATEAU + 46, 5, DBG)
    finials.append((x0 - 1, y0 - 1, turret))
    edge = box(x0 - 6, y0 - 2, 6, d + 4) - box(x0 - 5, y0 - 1, 5, d + 2)
    p.fill(edge, PLATEAU, PLATEAU + 1, DTAN)
    p.fill({(x, y) for x, y in edge if (x + y) % 2 == 0}, PLATEAU + 1, PLATEAU + 2, TAN)
    return p


def block(p, x0, y0, w, d, tall, ridge=None, every=3, k0=PLATEAU):
    """A tan wing with rows of small windows every `every` studs, under a gabled or hipped roof; returns the course above it."""
    eaves = k0 + tall
    rows = range(k0 + 4, eaves - 3, 5)

    def color(x, y, k):
        u = x - x0 if y in (y0, y0 + d - 1) else y - y0
        if u % every == every // 2 and any(r <= k < r + 2 for r in rows):
            return LIT if (u + k) % 3 else BLACK
        if green := ivy(x, y, k, k0):
            return green
        return DTAN if k < k0 + 1 or k == eaves - 1 else TAN

    p.fill(box(x0, y0, w, d), k0, eaves, color)
    return gable_roof(p, x0, y0, w, d, eaves, ridge) if ridge else p.roof(box(x0, y0, w, d), eaves, DBG)


def hall_front():
    """The Great Hall's gabled front on the courtyard: a pointed door, two tall lancets, pinnacles, a clock in the gable."""
    p = Plan("The Great Hall's gabled front: a pointed door, two tall lancets, pinnacles")
    x0, y0, w, d = CX - 12, CY - 28, 4, 12
    x1, mid, eaves = x0 + w - 1, y0 + d / 2, PLATEAU + 30

    def color(x, y, k):
        off = abs(y + 0.5 - mid)
        if x == x1 and off < 2:
            if k < YARD + 7 + (off < 1):
                return BLACK
            for a, b in ((PLATEAU + 7, PLATEAU + 15), (PLATEAU + 18, PLATEAU + 27)):
                if a <= k < b + (off < 1):
                    return LIT
        return DTAN if k in (YARD, PLATEAU + 16, eaves - 1) else TAN

    p.fill(box(x0, y0, w, d), YARD, eaves, color)
    gable_roof(p, x0, y0, w, d, eaves, ridge="x")
    for y in (y0, y0 + d - 1):
        pinnacle(p, x1, y, eaves, rounds=6)
    return p


def staircase_tower(finials):
    """The Marble Staircase Tower: 24 studs across, a corbelled crown, a spire twice as tall with Dumbledore's turrets."""
    p = Plan("The Marble Staircase Tower: corbelled crown, tall spire, Dumbledore's turrets")
    cx, cy, r = CX, CY, 12
    crown = PLATEAU + 48
    bands = {YARD, YARD + 1, PLATEAU + 18, PLATEAU + 34}
    wall = round_wall(cx, cy, bands, windows(r, 14, list(range(PLATEAU + 5, crown - 2, 7))))
    p.fill(disc(cx, cy, r), YARD, crown, wall)
    p.fill(disc(cx, cy, r + 0.5), crown, crown + 1, DTAN)
    p.fill(disc(cx, cy, r + 1), crown + 1, crown + 4, DTAN)
    ring = disc(cx, cy, r + 1) - disc(cx, cy, r + 0.5)
    p.fill({(x, y) for x, y in ring if (x + y) % 2 == 0}, crown + 4, crown + 5, TAN)
    spire(p, cx, cy, r + 0.5, crown + 4, 46, finials, dormers=9)
    for angle, tall in ((205, 9), (180, 12), (155, 8)):
        a = math.radians(angle)
        x, y, k0 = round(cx + 9 * math.cos(a)) - 2, round(cy + 9 * math.sin(a)) - 2, crown + 16
        k1 = k0 + tall
        for k in range(k0, k1):
            p.part("87081", x, y, k, DTAN if k in (k0, k1 - 1) else TAN)
        turret = p.cone(x + 2, y + 2, 2.5, k1, 5, DBG)
        finials.append((x + 1, y + 1, turret))
    return p


def chamber(finials):
    """The Chamber of Reception: the fat round tower at the front corner of the Great Hall and the courtyard, on a lower ledge."""
    p = Plan("The Chamber of Reception, a fat round tower on a lower ledge")
    round_tower(p, CX - 10, CY - 37, 5, PLATEAU - 6, PLATEAU + 18, 9, finials)
    return p


def viaduct_courtyard(finials):
    """The open yard from the Great Hall's end to the viaduct, at the great tower's door, ringed by a gabled arcade."""
    p = Plan("The Viaduct Courtyard: a gabled arcade and two round towers")
    x0, y0, x1, y1 = CX - 12, CY - 38, CX + 23, CY - 14
    round_tower(p, x1 + 1, y0, 5, YARD, PLATEAU + 30, 16, finials)
    round_tower(p, x1 + 1, y1 + 1, 4, YARD, PLATEAU + 20, 10, finials)
    eaves = YARD + 10

    def color(x, y, k):
        u = x if y in (y0, y1, y0 + 3, y1 - 3) else y
        if u % 4 in (1, 2) and YARD + 2 <= k <= YARD + 6:
            return LIT
        if green := ivy(x, y, k, YARD):
            return green
        return DTAN if k in (YARD, eaves - 1) else TAN

    for x, y, w, d, ridge in (
        (x0, y0, x1 - x0 + 1, 4, "x"),
        (x1 - 3, y0 + 4, 4, y1 - y0 - 3, "y"),
        (CX + 8, y1 - 3, x1 - CX - 11, 4, "x"),
    ):
        p.fill(box(x, y, w, d), YARD, eaves, color)
        gable_roof(p, x, y, w, d, eaves, ridge)
    return p


def south_courtyard(finials):
    """Four gabled wings round a lawn behind the great tower, which stands in its front corner; Gryffindor Tower at the far one."""
    p = Plan("The South Courtyard's four wings, and Gryffindor Tower at the far corner")
    x0, y0, x1, y1 = CX - 40, CY - 4, CX + 11, CY + 45
    round_tower(p, x0, y1 + 1, 6, PLATEAU, PLATEAU + 58, 24, finials)
    block(p, x0, y0, 8, y1 - y0 + 1, 20, ridge="y")
    block(p, x0 + 8, y0, CX - 12 - x0 - 8, 8, 16, ridge="x")
    block(p, x0 + 8, y1 - 7, x1 - x0 - 7, 8, 20, ridge="x")
    block(p, x1 - 7, CY + 10, 8, y1 - CY - 17, 18, ridge="y")
    return p


def gate_tower(finials):
    p = Plan("The gate tower at the viaduct's far end")
    round_tower(p, 157, CY - 21, 5, PLATEAU - 2, PLATEAU + 24, 10, finials)
    return p


def viaduct():
    """Tall slender piers rising from the lake, pointed arches, and a parapeted deck from the courtyard to the gate tower."""
    p = Plan("The viaduct: slender piers from the lake, pointed arches, a parapeted deck", footing=True)
    x0, x1, y0, y1, deck = CX + 24, 152, CY - 24, CY - 19, YARD
    soffit = {0: 1, 1: 1, 2: deck - 6, 3: deck - 3, 4: deck - 2, 5: deck - 3, 6: deck - 6}
    for x in range(x0, x1 + 1):
        low = soffit[(x - x0 - 2) % 7]
        for y in range(y0, y1 + 1):
            p.fill([(x, y)], low, deck + 2, stone({deck + 1, low, low + 1}))
            if y in (y0, y1):
                p.fill([(x, y)], deck + 2, deck + 3 + (x % 2 == 0), TAN)
    for x in range(x0 + 3, x1, 7):
        for y in (y0, y1):
            p.part("3062b", x, y, deck + 3 + (x % 2 == 0), LIT)
    return p


def stairs():
    """The walled stair switching back down the cliff from the courtyard's corner tower to the boathouse."""
    p = Plan("The walled stair down the cliff to the boathouse", footing=True)
    x0, x1, flights = 120, 140, 4
    drop = (YARD - 2) // flights
    level = {}
    for i in range(flights):
        y, landing = 41 - 4 * i, YARD - 1 - drop * i
        for x in range(x0, x1 + 1):
            run = x - x0 if i % 2 == 0 else x1 - x
            for dy in range(3):
                level[x, y + dy] = landing - round(run * drop / (x1 - x0))
        if i < flights - 1:
            turn = x1 + 1 if i % 2 == 0 else x0 - 3
            for x in range(turn, turn + 3):
                for dy in range(-4, 3):
                    level[x, y + dy] = landing - drop
    ends = {(x0, y) for y in (41, 42, 43, 29, 30, 31)}
    for c, k in level.items():
        wall = c not in ends and any((c[0] + dx, c[1] + dy) not in level for dx, dy in SIDES)
        p.fill([c], 1, k + (3 if wall else 1), stone({k, k + 2} if wall else {k}))
    return p


def boathouse():
    p = Plan("The boathouse at the foot of the stair")
    x0, y0, w, d = 112, 26, 8, 7

    def color(x, y, k):
        if y == y0 and x0 + 3 <= x <= x0 + 4 and k < 5:
            return BLACK
        return DTAN if k == 1 else TAN

    p.fill(box(x0, y0, w, d), 1, 7, color)
    gable_roof(p, x0, y0, w, d, 7, ridge="y", pitch=1)
    return p


def hagrid():
    """Hagrid's round hut and pumpkin patch on a ledge below the Great Hall."""
    p = Plan("Hagrid's hut and pumpkin patch on a ledge below the Great Hall")
    cx, cy, k0 = 25, 42, 9

    def wall(x, y, k):
        if y < cy - 2 and abs(x + 0.5 - cx) < 1 and k < k0 + 3:
            return DBROWN
        if abs(y + 0.5 - cy) < 1 and k == k0 + 2:
            return LIT
        return LBG if noise(x * 0.9, y * 0.9 + k) > 0.3 else DBG

    p.fill(disc(cx, cy, 3.5), k0, k0 + 5, wall)
    p.cone(cx, cy, 3.5, k0 + 5, 5, DBROWN)
    p.fill([(cx + 1, cy + 1)], k0 + 5, k0 + 10, DBG)
    p.fill(box(cx - 5, cy - 7, 10, 3), k0 - 1, k0, DBROWN)
    for x, y in ((cx - 4, cy - 7), (cx - 1, cy - 6), (cx + 2, cy - 7), (cx + 3, cy - 5)):
        p.part("3062b", x, y, k0, ORANGE)
        p.part("32607", x, y, k0 + 1, GREEN)
    return p


def paths(cx, cy):
    """A lawn crossed by two paths meeting at (cx, cy)."""
    return lambda x, y: TAN if abs(x - cx) <= 1 or abs(y - cy) <= 1 else GREEN


GROUNDS = [
    (box(CX - 59, CY - 15, 47, 11), PLATEAU, lambda x, y: GREEN),
    (box(CX - 32, CY + 4, 36, 34), PLATEAU, paths(CX - 14, CY + 21)),
    (box(CX - 12, CY - 34, 32, 22), YARD, lambda x, y: LBG),
]
"""Lawns and paving between the buildings: the crag's surface there, level with their floors."""


# Life


def centered(part, x, y, k, color, plates):
    """A 1x1 part on the point between four studs, like a finial on a 2x2 tip; x, y is the 2x2's corner."""
    place(part, fit(part, color), (20 * x + 20, -8 * (z(k) + plates), 20 * y + 20))


def gardens():
    """Trees, a fountain and flower borders in the South Courtyard; trees, lamps and a gold statue in the Viaduct Courtyard."""
    step("Gardens: a fountain, trees, flower borders, lamps and a gold statue")
    lx, ly = CX - 14, CY + 21
    brick("87081", lx - 2, ly - 2, z(PLATEAU), fit("87081", LBG))
    brick("3941", lx - 1, ly - 1, z(PLATEAU + 1), LBG)
    for x, y in ((lx - 1, ly - 1), (lx, ly)):
        brick("3062b", x, y, z(PLATEAU + 2), TLBLUE)
    for part, x, y, color in (
        ("3470", CX - 28, CY + 8, GREEN),
        ("3471", CX - 28, CY + 30, GREEN),
        ("3471", CX - 4, CY + 30, GREEN),
        ("2435", CX - 4, CY + 16, GREEN),
    ):
        brick(part, x, y, z(PLATEAU), fit(part, color))
    lawn = {(x, y) for cells, k, color in GROUNDS[:2] for x, y in cells if k == PLATEAU and color(x, y) == GREEN}
    lawn = {c for c in lawn if top(*c) == z(PLATEAU)}
    for x, y in sorted(lawn):
        edge = any((x + dx, y + dy) not in lawn for dx, dy in SIDES)
        if edge and (x + y) % 2 == 0 and top(x, y) == z(PLATEAU):
            brick("24866", x, y, z(PLATEAU), FLOWERS[(7 * x + 3 * y) % len(FLOWERS)])
    for x, y in ((CX - 3, CY - 21), (CX + 16, CY - 21)):
        brick("2435", x, y, z(YARD), fit("2435", DGREEN))
    for x, y in ((CX + 2, CY - 31), (CX + 13, CY - 31), (CX + 2, CY - 23), (CX + 13, CY - 23)):
        for i, color in enumerate((DBG, DBG, LIT)):
            brick("3062b", x, y, z(YARD + i), color)
        brick("4589", x, y, z(YARD + 3), BLACK)
    x, y = CX + 7, CY - 27
    brick("3941", x, y, z(YARD), LBG)
    for i in (1, 2):
        brick("3062b", x, y, z(YARD + i), fit("3062b", GOLD))
    brick("4589", x, y, z(YARD + 3), GOLD)


def life(height, kind, capped):
    """The clock, the Whomping Willow with the Ford Anglia in its branches, the forest and flowers, the giant squid."""
    step("The clock in the Great Hall's gable")
    mount("4150p03", CX - 8, CY - 23, z(PLATEAU + 33), WHITE, "east")
    step("The Whomping Willow, with a flying Ford Anglia stuck in it")
    x, y = CX - 36, CY - 10
    k = top(x, y)
    for i in range(3):
        brick("3941", x, y, k + 3 * i, BROWN)
    brick("2417", x - 2, y - 2, k + 9, fit("2417", OLIVE))
    brick("3941", x, y, k + 10, BROWN)
    brick("2417", x - 2, y - 2, k + 13, DGREEN, 90)
    brick("3021", x - 1, y, k + 14, AZURE)
    brick("3065", x, y, k + 15, CLEAR, 90)
    brick("3023b", x, y, k + 18, AZURE, 90)

    step("Pines of the Forbidden Forest and bushes on the crag")
    tops = {c: h for c, h in height.items() if h > 0 and kind[c] == "crag" and c not in capped}
    used = set()
    for (X, Y), h in sorted(tops.items()):
        cells = [(X, Y), (X + 1, Y), (X, Y + 1), (X + 1, Y + 1)]
        forest = S * Y > CY + 36 or S * X < 32
        if (
            random.random() < (0.45 if forest else 0.06)
            and all(tops.get(c) == h and c not in used for c in cells)
            and top(S * X, S * Y, 2 * S, 2 * S) == z(h)
        ):
            part, color = random.choice(PINES)
            brick(part, S * X, S * Y, z(h), fit(part, color))
            used.update(cells)
    step("Wild flowers and ferns on the ledges")
    for (X, Y), h in sorted(tops.items()):
        if (X, Y) in used:
            continue
        for x, y in sorted(studs(X, Y)):
            if random.random() < 0.06 and top(x, y) == z(h):
                flower = random.random() < 0.6
                brick("24866" if flower else "32607", x, y, z(h), random.choice(FLOWERS) if flower else DGREEN)

    step("The giant squid's tentacles out of the Black Lake")
    water = lambda x, y: height.get((x // S, y // S)) == 0
    for x, y in ((142, 27), (147, 30), (153, 26)):
        if not all(water(u, v) for u in range(x, x + 3) for v in (y, y + 1)):
            continue
        for part, dx, plate in (
            ("3941", 0, 2),
            ("3062b", 1, 5),
            ("3062b", 1, 8),
            ("3023b", 1, 11),
            ("3062b", 2, 12),
            ("4589", 2, 15),
        ):
            brick(part, x + dx, y, plate, fit(part, SQUID))
    step("Boats with lanterns crossing the Black Lake")
    for i in range(12):
        x, y = 22 + 9 * i, 28 + round(3 * math.sin(i * 0.9))
        if all(water(u, v) for u in range(x - 1, x + 3) for v in range(y - 1, y + 5)):
            brick("3020", x, y, 2, BROWN, 90)
            brick("3062b", x, y + 3, 3, LIT)
    step("Trevor the toad, found at the foot of the boathouse stairs")
    brick("33320", 120, 30, top(120, 30), GREEN)


finials = []
plans = [
    great_hall(finials),
    hall_front(),
    staircase_tower(finials),
    chamber(finials),
    viaduct_courtyard(finials),
    south_courtyard(finials),
    gate_tower(finials),
    viaduct(),
    stairs(),
    boathouse(),
    hagrid(),
]
pad, own = pads(plans, GROUNDS)
height, kind = terrain(pad)
surface = {c: color(*c) for cells, k, color in GROUNDS for c in cells if height.get((c[0] // S, c[1] // S)) == k}
ground = lambda x, y: height.get((x // S, y // S), 0)

step("The bed of the Black Lake")
cover({s for c in height for s in studs(*c)}, 0, DBLUE)
step("The Black Lake")
waves = lambda x, y: TLBLUE if noise(x * 0.9, y * 0.35) > 0.62 else TMBLUE
cover({s for c, h in height.items() if h == 0 for s in studs(*c)}, 1, waves, tiles=True)

step("The crag, rising from the lake to the castle's floors")
capped = bevels(height, kind, own)
for (X, Y), h in height.items():
    if h:
        paving = DBG if kind[X, Y] == "footing" else LBG if kind[X, Y] == "castle" else None

        def color(x, y, k, h=h, paving=paving):
            if k < h - 1:
                return rock(x, y, k)
            return surface.get((x, y)) or paving or grass(x, y)

        fill(studs(X, Y), z(0), 3 * h, courses(color))

for plan in plans:
    build(plan, ground)
gardens()
life(height, kind, capped)
step("Gold finials on every spire")
for x, y, k in finials:
    centered("4589", x, y, k, DBG, 3)
    centered("30374", x, y, k + 1, GOLD, 10)
