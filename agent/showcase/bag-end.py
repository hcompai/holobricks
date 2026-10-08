import math
import random

# ---------------------------------------------------------------- constants
S = 2                      # terrain cell size in studs
W, D = 88, 78              # footprint in studs
CW, CD = W // S, D // S
T = 2                      # lower terrace, courses
F = 4                      # front yard (door sill level), courses
FY = 24                    # facade front plane (stud y)
FX0, FX1 = 18, 64          # facade x range [FX0, FX1)
WALLTOP = 17               # facade top / turf line, courses
BASE = 3 * F               # plate height of the door sill level

GRASS = [(2, 6), (10, 3), (288, 1)]
LEAFY = [(2, 4), (288, 3), (10, 2)]
STONE = [(19, 3), (28, 3), (72, 2), (71, 2), (84, 1)]
PLASTER, TIMBER, DOOR, FRAME = 226, 308, 2, 28
BRICKRED = (320, 70)

BRICKS = {1: "3005", 2: "3004", 3: "3622", 4: "3010", 6: "3009", 8: "3008"}
PLATES = {1: "3024", 2: "3023b", 3: "3623", 4: "3710", 6: "3666", 8: "3460"}
LENS = (1, 2, 3, 4, 6, 8)
GLASS_LENS = {"brick": (1,), "plate": (1, 2)}

NEAREST = {10: 2, 27: 2, 288: 2, 28: 19, 308: 70, 13: 29, 25: 14, 2: 15}   # the next shade to try


def fit(part, color):
    """The palette's color if the part comes in it, else the nearest shade it comes in."""
    while color not in colors(part):
        color = NEAREST[color]
    return color


def pick(weights):
    return random.choices([c for c, _ in weights], [n for _, n in weights])[0]


def noise(x, y):
    """Smooth value in -1..1."""
    return (0.5 * math.sin(0.37 * x + 0.11 * y)
            + 0.3 * math.sin(0.53 * y - 0.21 * x + 1.3)
            + 0.2 * math.sin(1.1 * x + 0.7 * y + 2.1))


def shade(weights, x, y, k=0.0, f=0.35):
    """A deterministic patchy choice from weighted colours (patches, not confetti)."""
    n = (noise(x * f + 3.1 * k, y * f - 1.7 * k) + 1) / 2 + 0.12 * math.sin(x * 12.9898 + y * 78.233 + k * 3.7)
    n = min(0.999, max(0.0, n))
    tot = sum(w for _, w in weights)
    acc = 0
    for c, w in weights:
        acc += w / tot
        if n <= acc:
            return c
    return weights[-1][0]


# ---------------------------------------------------------------- terrain shape
def dome(x, y, cx, cy, rx, ry, peak, p=0.7, seed=0.0):
    a = math.atan2(y - cy, x - cx)
    wob = 1 + 0.13 * math.sin(3 * a + 1.7 + seed) + 0.08 * math.sin(5 * a + 0.4 + 2 * seed)
    d = math.hypot((x - cx) / rx, (y - cy) / ry) / wob
    return peak * max(0.0, 1 - d * d) ** p


BLEND = 2.5                # courses over which neighbouring domes melt into one another
TREE = (44, 44)            # trunk centre (studs)
CHIMNEYS = [(26, 34), (62, 38)]


def hill(x, y):
    """A berm burying the facade, a broad crest rising gently behind it to the oak's seat, a back-right
    hump and two wings reaching forward around the garden like arms; soft folds and noise."""
    domes = (dome(x, y, 41, 30, 40, 13, WALLTOP + 4, 0.5),
             dome(x, y, 44, 47, 40, 32, 27, 0.8),
             dome(x, y, 64, 58, 19, 16, 22, 0.7, 2.0),
             dome(x, y, 12, 30, 13, 21, 18, 0.75, 1.0),
             dome(x, y, 75, 29, 12, 18, 16, 0.75, 3.0),
             dome(x, y, 22, 60, 19, 15, 21, 0.65, 4.0),
             dome(x, y, 10, 47, 11, 14, 17, 0.7, 5.0))
    h = BLEND * math.log(sum(math.exp(d / BLEND) for d in domes) - len(domes) + 1)
    if h > 0.5:
        a = math.atan2(y - 47, x - 42)
        h *= 1 + 0.035 * math.sin(7 * a + 0.5) + 0.025 * math.sin(11 * a + 2.0)
        h += 0.8 * noise(x * 0.19 + 5, y * 0.19) + 0.2 * noise(x * 0.55, y * 0.55 + 2)
    return h * min(1.0, max(0.0, (1 - rim(x, y)) / 0.3)) ** 0.8


def rim(x, y):
    """0 in the middle of the site, 1 on its edge: a rounded, wobbling outline, flattest along the lane."""
    dx, dy = (x - 44) / 43, (y - 37) / 40
    a = math.atan2(dy, dx)
    wob = 1 + 0.06 * math.sin(3 * a + 0.8) + 0.04 * math.sin(5 * a + 2.3) + 0.03 * noise(x * 0.15, y * 0.15)
    return (abs(dx) ** 3 + abs(dy) ** 3) ** (1 / 3) / wob


def front_edges(x):
    lane = 4.5 + 1.8 * math.sin(x * 0.07 + 0.6) + 0.6 * noise(x * 0.3, 1.0)
    e1 = 9 + 2.2 * noise(x * 0.12, 3.0) - 1.5 * math.cos((x - 42) * 0.07)
    e2 = 15 + 2.0 * noise(x * 0.11 + 4, 9.0) - 1.2 * math.cos((x - 42) * 0.06)
    return lane, e1, e2


# the garden stairs in front of the round door: lane -> lower terrace -> yard -> flagstones to the sill
STAIRS = {}
for X in (21, 22):
    STAIRS.update({(X, 1): 1, (X, 2): 1, (X, 3): 2, (X, 6): 3, (X, 7): 4, (X, 8): 4, (X, 9): 4, (X, 10): 4,
                   (X, 11): 4})


def build_heights():
    H, kind = {}, {}
    fx0, fx1 = FX0 // S, FX1 // S
    for X in range(CW):
        for Y in range(CD):
            x, y = S * X + 1, S * Y + 1
            lane, e1, e2 = front_edges(x)
            h = hill(x, y)
            garden = fx0 - 2 <= X <= fx1 + 1 and Y < FY // S
            if y < lane:
                hh, kk = 0, "lane"
            elif garden:
                pad = 0 if y < e1 - 3 else T if y < e2 else F
                hh, kk = pad, ("green" if pad == 0 else "yard")
                if h > pad + 1 and (X < fx0 or X >= fx1):
                    hh, kk = min(round(h), pad + 3), "hill"
            else:
                hh, kk = max(0, round(h)), "hill"
                if y < lane + 3:
                    hh = min(hh, 1)
            if Y == FY // S and fx0 <= X < fx1:
                H[X, Y], kind[X, Y] = WALLTOP, "house"
                continue
            if Y < FY // S and fx0 - 7 <= X <= fx0:
                stair = WALLTOP + 1 - 2 * (FY // S - Y) - 2 * max(0, X - (fx0 - 2), fx0 - 3 - X)
                if stair > hh:
                    hh, kk = stair, "hill"
            dist = max(fx0 - X, X - (fx1 - 1), 0)
            if FY // S - 1 <= Y <= FY // S + 1 and dist > 0:
                bump = WALLTOP + 1 - 1.6 * (dist - 1) - (3 if Y < FY // S else 0)
                if bump > hh:
                    hh, kk = int(bump), "hill"
            if FY // S < Y <= FY // S + 3 and fx0 <= X < fx1:
                bump = 1.2 + 1.3 * noise(X * 0.45, Y * 0.8 + 3) if Y > FY // S + 1 else 0.6 + 1.1 * noise(X * 0.7, 5)
                lip = WALLTOP + 1 + (Y - FY // S - 1) + round(bump + 3 * max(0.0, noise(X * 1.3 + 4 * Y, Y * 2.1)))
                hh, kk = max(hh, lip), "hill"
            H[X, Y], kind[X, Y] = hh, kk
    for (X, Y), h in STAIRS.items():
        H[X, Y], kind[X, Y] = h, "path"
    for (px, py), r in [(TREE, 2)] + [(c, 1) for c in CHIMNEYS]:
        PX, PY = px // S, py // S
        level = max(H[X, Y] for X in range(PX - r, PX + r + 1) for Y in range(PY - r, PY + r + 1))
        for X in range(PX - r, PX + r + 1):
            for Y in range(PY - r, PY + r + 1):
                H[X, Y] = level
    return {c: h for c, h in H.items() if rim(S * c[0] + 1, S * c[1] + 1) < 1}, kind


H, KIND = build_heights()
print("peak", max(H.values()), "tree pad", H[TREE[0] // S, TREE[1] // S])

OUTWARD = [((0, -1), 0), ((-1, 0), 90), ((1, 0), 270), ((0, 1), 180)]
BEVELS = {3: "3684c", 2: "3678b", 1: "3039"}
CORNERS = {3: "3045", 2: "3045", 1: "3045"}
CORNER_TURNS = {((0, -1), (1, 0)): 0, ((-1, 0), (0, -1)): 90, ((0, 1), (-1, 0)): 180, ((1, 0), (0, 1)): 270}
FLAT = set()
for (px, py), r in [(TREE, 2)] + [(c, 1) for c in CHIMNEYS]:
    FLAT |= {(X, Y) for X in range(px // S - r + 1, px // S + r) for Y in range(py // S - r + 1, py // S + r)}

claimed, slopes = set(), {}


def solid(X, Y, k):
    return (X, Y) in H and k < H[X, Y]


def closed(X, Y, k, side):
    if (X, Y, k) in slopes:
        return slopes[X, Y, k] == side
    return solid(X, Y, k)


def exposed(X, Y, k):
    if not solid(X, Y, k) or (X, Y, k) in claimed or KIND.get((X, Y)) == "house":
        return False
    return any(not closed(X + dx, Y + dy, k, (-dx, -dy)) for (dx, dy), _ in OUTWARD)


def plan_bevels():
    out = []
    for (X, Y), h in sorted(H.items()):
        if h == 0 or KIND.get((X, Y)) != "hill" or (X, Y) in FLAT:
            continue
        drops = {d: h - H.get((X + d[0], Y + d[1]), 0) for d, _ in OUTWARD
                 if H.get((X + d[0], Y + d[1]), 0) < h}
        if not drops:
            continue
        corner = next(((pair, turn) for pair, turn in CORNER_TURNS.items() if all(d in drops for d in pair)), None)
        if corner:
            size = 1
            part, rot, back = CORNERS[size], corner[1], None
        else:
            d, drop = max(drops.items(), key=lambda it: it[1])
            size = min(drop, 3, h)
            if size == 3 and random.random() < 0.3:
                size = 2
            part, rot, back = BEVELS[size], dict(OUTWARD)[d], (-d[0], -d[1])
        claimed.update((X, Y, k) for k in range(h - size, h))
        slopes.update(((X, Y, k), back) for k in range(h - size, h))
        color = shade(ROCK, X, Y, 9, 0.9) if rocky(X, Y) else shade(GRASS, X, Y, 9)
        out.append((part, S * X, S * Y, 3 * (h - size), fit(part, color), rot))
    return out


CELLRUNS = {1: "3003", 2: "3001", 3: "2456", 4: "3007"}


def blocks(cells, z, color):
    free = set(cells)
    for X, Y in sorted(cells, key=lambda c: (c[1], c[0])):
        if (X, Y) not in free:
            continue
        axis, target, n = random.choice(((1, 0), (0, 1))), random.choice((1, 2, 3, 4, 4)), 1
        while n < target and (X + axis[0] * n, Y + axis[1] * n) in free:
            n += 1
        free -= {(X + axis[0] * i, Y + axis[1] * i) for i in range(n)}
        brick(CELLRUNS[n], S * X, S * Y, z, fit(CELLRUNS[n], color), 0 if n == 1 or axis == (1, 0) else 90)


OUTCROPS = [(22, 62, 5.5), (55, 64, 4.5), (72, 57, 4.0)]   # stud centre x, y and radius, all behind the crest


def rocky(X, Y):
    x, y = S * X + 1, S * Y + 1
    return (KIND.get((X, Y)) == "hill" and H.get((X, Y), 0) > 5
            and any(math.hypot(x - ox, y - oy) < r * (1 + 0.3 * noise(x * 0.4, y * 0.4)) for ox, oy, r in OUTCROPS))


ROCK = [(71, 3), (72, 3), (19, 1), (28, 1)]


def face_color(X, Y, k):
    kd = KIND.get((X, Y))
    if rocky(X, Y):
        return shade(ROCK, X, Y, k, 0.9)
    if kd == "hill":
        return 28 if noise(X * 0.9 + k, Y * 0.9) > 0.93 else shade(GRASS, X, Y, k)
    return shade(STONE, X, Y, k, 0.8)


def top_color(X, Y):
    kd = KIND.get((X, Y))
    if kd == "path":
        return shade([(71, 3), (19, 2), (72, 1)], X, Y, 5, 0.9)
    if kd == "lane":
        return shade([(19, 4), (28, 3), (84, 1)], X, Y, 2, 0.5)
    if rocky(X, Y):
        return shade(ROCK, X, Y, 3, 0.9)
    return shade(GRASS, X, Y, 1)


PLATERUNS = {1: "3022", 2: "3020", 3: "3795", 4: "3034"}


# ---------------------------------------------------------------- facade: pixel walls
def split_run(xs, supported, lens=LENS):
    """Split a run of consecutive x into allowed lengths, each piece touching support."""
    out, i, n = [], 0, len(xs)
    while i < n:
        opts = [L for L in lens if L <= n - i]
        random.shuffle(opts)
        opts.sort(key=lambda L: -L if L <= 4 else 0)
        opts = opts[:3] + [L for L in lens if L <= n - i and L not in opts[:3]]
        chosen = None
        for L in opts:
            ok = any(supported(xs[j]) for j in range(i, i + L))
            rest = i + L == n or any(supported(xs[j]) for j in range(i + L, n))
            if ok and rest:
                chosen = L
                break
        if chosen is None:
            chosen = max(L for L in lens if L <= n - i)
        out.append((xs[i], chosen))
        i += chosen
    return out


TOKENS = {"brick": [(320, 3), (70, 2)], "turf": [(10, 5), (2, 4), (288, 1)],
          "plinth": [(19, 2), (28, 2), (72, 1)]}


def paint(tok):
    return pick(TOKENS[tok]) if isinstance(tok, str) else tok


def pixel_plane(y, x0, x1, z0, z1, color_at):
    """Build a 1-stud-thick wall from a map of colour tokens: bricks where 3 rows agree, plates elsewhere.
    A run with nothing under it takes its neighbour's token so every piece is carried."""
    g = {(x, z): color_at(x, z) for x in range(x0, x1) for z in range(z0, z1)}
    for z in range(z0 + 1, z1):
        for _ in range(6):
            changed = False
            x = x0
            while x < x1:
                c = g[x, z]
                if c is None:
                    x += 1
                    continue
                e = x
                while e + 1 < x1 and g[e + 1, z] == c:
                    e += 1
                if not any(g[xx, z - 1] is not None for xx in range(x, e + 1)):
                    left = g.get((x - 1, z))
                    right = g.get((e + 1, z))
                    new = left if left is not None else right
                    if new is not None:
                        for xx in range(x, e + 1):
                            g[xx, z] = new
                        changed = True
                x = e + 1
            if not changed:
                break
    at = lambda x, z: g.get((x, z))
    for zb in range(z0, z1, 3):
        rows = list(range(zb, min(zb + 3, z1)))
        cols = {x: [at(x, z) for z in rows] for x in range(x0, x1)}
        done = set()
        if len(rows) == 3:
            x = x0
            while x < x1:
                c = cols[x][0]
                ok = lambda xx, c: (all(v == c for v in cols[xx]) and
                                    all(at(n, z) is not None for n in (xx - 1, xx + 1) if x0 <= n < x1 for z in rows))
                if c is not None and ok(x, c):
                    run = [x]
                    while run[-1] + 1 < x1 and cols[run[-1] + 1][0] == c and ok(run[-1] + 1, c):
                        run.append(run[-1] + 1)
                    sup = lambda xx: zb == z0 or at(xx, zb - 1) is not None
                    for sx, L in split_run(run, sup, GLASS_LENS["brick"] if c in (40, 46) else LENS):
                        brick(BRICKS[L], sx, y, zb, fit(BRICKS[L], paint(c)))
                    done |= {(xx, z) for xx in run for z in rows}
                    x = run[-1] + 1
                else:
                    x += 1
        for z in rows:
            x = x0
            while x < x1:
                c = at(x, z)
                if c is None or (x, z) in done:
                    x += 1
                    continue
                run = [x]
                while run[-1] + 1 < x1 and (run[-1] + 1, z) not in done and at(run[-1] + 1, z) == c:
                    run.append(run[-1] + 1)
                sup = lambda xx, z=z: z == z0 or at(xx, z - 1) is not None
                for sx, L in split_run(run, sup, GLASS_LENS["plate"] if c in (40, 46) else LENS):
                    brick(PLATES[L], sx, y, z, fit(PLATES[L], paint(c)))
                x = run[-1] + 1


DCX, DR = 43.5, 5.0                 # door centre x, radius (studs)
DZ0 = BASE + 1                      # door bottom plate
DZC = DZ0 + DR / 0.4                # door centre height (plates)
WINDOWS = [(31.5, BASE + 15.5, 2.2, 40), (55.5, BASE + 15.5, 2.2, 46), (62.0, BASE + 16.0, 1.1, 40)]
ARCH = (22.5, BASE + 7, BASE + 16, 2.0)   # arched window: centre x, sill z, spring z, half width
POSTS = [27, 36, 51, 59]
BAYS = [(18, 27, BASE + 24, 4), (28, 36, BASE + 26, 3), (37, 51, BASE + 30, 5), (52, 59, BASE + 26, 3), (60, 64, BASE + 24, 2)]


def eave(x):
    for x0, x1, base, rise in BAYS:
        if x0 <= x < x1:
            cx, hw = (x0 + x1) / 2, (x1 - x0) / 2 + 0.5
            t = (x + 0.5 - cx) / hw
            return base + rise * math.sqrt(max(0.0, 1 - t * t))
    # posts: as high as the lower neighbour's end
    return max(eave(x - 1), eave(x + 1)) if FX0 < x < FX1 - 1 else BASE + 16


def dist(x, z, cx, cz):
    return math.hypot(x + 0.5 - cx, (z + 0.5 - cz) * 0.4)


def brickring(x, z):
    return "brick"


def front_px(x, z):
    """Front plane of the facade (y = FY)."""
    if z < BASE:
        return 72
    top = 3 * WALLTOP
    e = eave(x)
    d = dist(x, z, DCX, DZC)
    if d < DR:
        return None
    if d < DR + 0.75:
        return FRAME
    if d < DR + 1.8 and z >= DZ0 + 2:
        return brickring(x, z)
    for cx, cz, r, _ in WINDOWS:
        dw = dist(x, z, cx, cz)
        if dw < r:
            return None
        if dw < r + 0.7:
            return DOOR
        if dw < r + 1.5 and z + 0.5 >= cz - 1:
            return brickring(x, z)
    ax, sill, spring, hw = ARCH
    u = abs(x + 0.5 - ax)
    da = dist(x, max(z, spring), ax, spring) if z >= spring else u
    if z >= sill and da < hw:
        return None
    if z >= sill - 1 and da < hw + 1:
        return TIMBER
    if z >= spring and da < hw + 2:
        return brickring(x, z)
    if x in POSTS and z < e + 1:
        return TIMBER
    if z >= e + 1.2:
        return None                      # the turf overhang is built one stud proud, see turf_lip()
    if z >= e - 0.3:
        return TIMBER
    if z < BASE + 3:
        return "plinth"
    return PLASTER


def back_px(x, z):
    """Recessed plane (y = FY + 1): door, glass, and hidden backing under them."""
    if z < BASE:
        return 72
    d = dist(x, z, DCX, DZC)
    if d < DR:
        if abs(x + 0.5 - (DCX + 2)) < 0.6 and abs(z + 0.5 - DZC) < 1:
            return 297
        return DOOR if (x + 1) % 3 else 288
    for cx, cz, r, glass in WINDOWS:
        if dist(x, z, cx, cz) < r:
            return glass
    ax, sill, spring, hw = ARCH
    u = abs(x + 0.5 - ax)
    da = dist(x, z, ax, spring) if z >= spring else u
    if z >= sill and da < hw:
        return 40
    # backing: anything with an opening above it in this column
    for zz in range(z + 1, 3 * WALLTOP):
        above = back_open(x, zz)
        if above:
            return 0
    return 72 if z < eave(x) + 1.2 else None


def back_open(x, z):
    if dist(x, z, DCX, DZC) < DR:
        return True
    if any(dist(x, z, cx, cz) < r for cx, cz, r, _ in WINDOWS):
        return True
    ax, sill, spring, hw = ARCH
    u = abs(x + 0.5 - ax)
    da = dist(x, z, ax, spring) if z >= spring else u
    return z >= sill and da < hw


# ================================================================ the build
step("Foundations and the plastered face of Bag End")
pixel_plane(FY, FX0, FX1, 0, 3 * WALLTOP, front_px)
step("The green round door and the window glass, set back in their frames")
pixel_plane(FY + 1, FX0, FX1, 0, 3 * WALLTOP, back_px)

step("Turf over the eaves, bulging out and hanging over the door and windows")
LIP = range(FX0, FX1)
crest, x = {}, FX0
while x < FX1:
    n, lift = random.randint(2, 7), random.choice([0, 1, 2, 3, 3, 4, 5, 6, 8])
    for i in range(x, min(x + n, FX1)):
        crest[i] = 3 * WALLTOP + 1 + lift + round(noise(i * 0.4, 2.0))
    x += n
drip = {x: max(0, round(1.5 + 2 * noise(x * 0.47 + 3, 5.0) + math.sin(x * 1.7))) for x in LIP}
fringe = {x: noise(x * 0.31, 9.0) > -0.35 for x in LIP}
rows = {FY + 1: {x: (top(x, FY + 1), crest[x]) for x in LIP},
        FY: {x: (top(x, FY), crest[x]) for x in LIP},
        FY - 1: {x: (top(x, FY) - drip[x], crest[x]) for x in LIP},
        FY - 2: {x: (top(x, FY) - drip[x] - 1, crest[x]) for x in LIP if fringe[x]}}
low = {x: min(rows[y][x][0] for y in (FY - 1, FY - 2) if x in rows[y]) for x in LIP}
for y, span in rows.items():
    turf = lambda x, z, span=span, y=y: (shade(GRASS, x, z // 3, y, 0.3)
                                         if x in span and span[x][0] <= z < span[x][1] else None)
    pixel_plane(y, FX0, FX1, 0, max(crest.values()), turf)
for x in LIP:
    brick("3710", x, FY - 2, crest[x], fit("3710", shade(GRASS, x, 0, 7)), 90)

step("Ferns trailing from the turf, and long grass along its top")
hung = set()
for x in range(FX0, FX1 - 3, 4):
    z = min(low[i] for i in range(x, x + 4)) - 1
    if random.random() < 0.6 and z > 31 and any(low[i] == z + 1 for i in range(x, x + 4)):
        brick("2423", x, FY - 4 if fringe[x] else FY - 3, z, fit("2423", pick(LEAFY)), 90)
        hung.update(range(x, x + 4))
for x in LIP:
    if x not in hung and random.random() < 0.35:
        y = FY - 2 if fringe[x] else FY - 1
        for k in range(random.randint(1, 3)):
            brick("6141", x, y, low[x] - 1 - k, fit("6141", pick(LEAFY)))
for x in range(FX0, FX1 - 3, 2):
    if random.random() < 0.5:
        brick("2423", x, FY - 2, top(x, FY - 2, 4, 3), fit("2423", pick(LEAFY)), 90)
for x in range(FX0, FX1):
    if random.random() < 0.2 and top(x, FY - 1) == top(x, FY):
        brick("15279", x, FY - 1, top(x, FY - 1), random.choice([10, 27, 288, 330]))

# ---- terrain
bevels = plan_bevels()
top_course = max(H.values())
for k0 in range(0, top_course, 5):
    step(f"The hill of Bag End, courses {k0 + 1} to {min(k0 + 5, top_course)}")
    for k in range(k0, min(k0 + 5, top_course)):
        groups = {}
        for (X, Y) in H:
            if exposed(X, Y, k):
                groups.setdefault(face_color(X, Y, k), set()).add((X, Y))
        for color, cells in groups.items():
            blocks(cells, 3 * k, color)

step("Grassy shoulders: slopes rounding every edge of the hill")
for part, x, y, z, color, rot in bevels:
    brick(part, x, y, z, color, rot)

hollow = [(X, Y) for (X, Y), h in H.items()
          if KIND.get((X, Y)) != "house" and (h == 0 or ((X, Y, h - 1) not in claimed and not exposed(X, Y, h - 1)))]
runs = []
free = set(hollow)
for X, Y in sorted(hollow, key=lambda c: (c[1], c[0])):
    if (X, Y) not in free:
        continue
    h, c = H[X, Y], top_color(X, Y)
    n, target = 1, random.choice((1, 2, 2, 3, 4))
    while n < target and (X + n, Y) in free and H[X + n, Y] == h and top_color(X + n, Y) == c:
        n += 1
    free -= {(X + i, Y) for i in range(n)}
    runs.append((X, Y, n, h, c))
step("Turf on the hill, lawns, the lane and the stone stairs")
for X, Y, n, h, c in runs:
    brick(PLATERUNS[n], S * X, S * Y, max(0, 3 * h - 1), fit(PLATERUNS[n], c))

# ---------------------------------------------------------------- the oak on the crest
BARK = [(308, 5), (70, 3), (28, 1)]
LEAF = [(2, 5), (10, 4), (27, 1)]


def hilltop(x, y):
    return 3 * H[x // S, y // S]


OSIZE = {"3003": (2, 2, 3), "3022": (2, 2, 1), "2417": (5, 6, 1), "2423": (3, 4, 1), "2356": (6, 4, 3),
         "3001": (4, 2, 3), "3958": (6, 6, 1), "3031": (4, 4, 1), "3039": (2, 2, 3), "3941": (2, 2, 3)}
OCC = set()
LEAFOCC = set()


def oput(part, x, y, z, color, rot=0):
    """Place a part of the oak and remember the space it fills."""
    w, d, h = OSIZE[part]
    if rot in (90, 270):
        w, d = d, w
    brick(part, x, y, z, fit(part, color), rot)
    vox = [(x + i, y + j, z + k) for i in range(w) for j in range(d) for k in range(h)]
    OCC.update(vox)
    if part in ("2417", "2423"):
        LEAFOCC.update(vox)


def otop(x, y, w=1, d=1):
    return top(x, y, w, d)


def droop(cx, cy, palette, r0):
    """Leaves hanging under the rim of the crown, deeper the farther out, so its edge sags like an oak."""
    zs = [z for (_, _, z) in OCC]
    if not zs:
        return
    n = 0
    zb = min(z for (x, y, z) in LEAFOCC if math.hypot(x - cx, y - cy) > r0)
    zt = max(z for (x, y, z) in LEAFOCC)
    for z in range(zt, zb - 18, -1):
        ox, oy = random.randrange(3), random.randrange(3)
        for x in range(cx - 40 + ox, cx + 40, 3):
            for y in range(cy - 40 + oy, cy + 40, 3):
                part = random.choice(["2417", "2423", "2423"])
                rot = random.choice((0, 90))
                w, d, _ = OSIZE[part]
                if rot == 90:
                    w, d = d, w
                px, py = x - w // 2, y - d // 2
                dist = math.hypot(px + w / 2 - cx, py + d / 2 - cy)
                if px < 0 or py < 0 or dist < r0:
                    continue
                cells = [(px + i, py + j) for i in range(w) for j in range(d)]
                if any((u, v, z) in OCC for u, v in cells):
                    continue
                held = sum((u, v, z + 1) in OCC for u, v in cells)
                if held < len(cells) * 0.4:
                    continue
                depth = zb - z
                if depth > (dist - r0) * 0.8 or random.random() < 0.15:
                    continue
                if any(3 * H.get((u // S, v // S), 0) + 6 > z for u, v in cells):
                    continue
                oput(part, px, py, z, shade(palette, px, py, z * 0.15, 0.16), rot)
                n += 1
    print("droop", n)


def crown(blobs, palette):
    """The whole crown as one cloud: the union of leaf billows (x, y, z, r, hz) around the branch tips,
    filled layer by layer on jittered grids. A piece goes in only where it rests exactly on that layer
    (on a branch or on what is below), so the cloud grows up out of its branches; deep inside, hidden
    4x6 bricks stand in for leaves."""
    def inside(x, y, z, k=0.0):
        for (bx, by, bz, r, hz) in blobs:
            rr, hh = r - k, hz - 2.5 * k
            if rr > 0 and hh > 0 and ((x - bx) / rr) ** 2 + ((y - by) / rr) ** 2 + ((z - bz) / hh) ** 2 <= 1:
                return True
        return False
    x0 = int(min(b[0] - b[3] for b in blobs)) - 2
    x1 = int(max(b[0] + b[3] for b in blobs)) + 2
    y0 = int(min(b[1] - b[3] for b in blobs)) - 2
    y1 = int(max(b[1] + b[3] for b in blobs)) + 2
    z0 = int(min(b[2] - b[4] for b in blobs))
    z1 = int(max(b[2] + b[4] for b in blobs))
    counts = {"core": 0, "big": 0, "small": 0}
    for z in range(z0, z1 + 1):
        for size in ("core", "big", "small"):
            step_ = {"core": 3, "big": 4, "small": 2}[size]
            ox, oy = random.randrange(step_), random.randrange(step_)
            cells = [(x, y) for x in range(x0 + ox, x1, step_) for y in range(y0 + oy, y1, step_)]
            random.shuffle(cells)
            for (x, y) in cells:
                part, w, d = {"core": ("2356", 6, 4), "big": ("2417", 5, 6), "small": ("2423", 3, 4)}[size]
                rot = random.choice((0, 90))
                if rot == 90:
                    w, d = d, w
                x, y = x - w // 2, y - d // 2
                if x < 0 or y < 0:
                    continue
                if size == "core":
                    if not all(inside(px, py, pz, 3.5) for px in (x, x + w) for py in (y, y + d) for pz in (z, z + 3)):
                        continue
                elif not inside(x + w / 2, y + d / 2, z):
                    continue
                if otop(x, y, w, d) != z:
                    continue
                color = 288 if size == "core" else shade(palette, x, y, z * 0.15, 0.16)
                oput(part, x, y, z, color, rot)
                counts[size] += 1
    print("crown", counts)


def limb(px, py, z, a, length, thick, tips, depth=0):
    """A limb of 2x2 bricks (then plates) stepping out a stud at a time and climbing; its tip and a
    mid point become leaf billows, and main limbs fork once."""
    x, y = px, py
    last = None
    for i in range(length):
        a += random.uniform(-0.2, 0.2)
        nx, ny = x + math.cos(a), y + math.sin(a)
        ix, iy = round(nx) - 1, round(ny) - 1
        if ix < 0 or iy < 0:
            break
        z = max(z, otop(ix, iy, 2, 2))
        tall = i < thick or random.random() < (0.3 if depth == 0 else 0.5)
        oput("3003" if tall else "3022", ix, iy, z, pick(BARK))
        x, y = nx, ny
        z += 3 if tall else 1
        last = (x, y, z)
        if depth == 0 and i == length // 2:
            tips.append((x, y, z, 0.7))
            side = random.choice((-1, 1))
            limb(x, y, z, a + side * random.uniform(0.7, 1.1), max(4, length // 2), 0, tips, 1)
    if last:
        tips.append(last + ((1.0 if depth == 0 else 0.8),))
    return last


def oak(tx, ty):
    z0 = hilltop(tx, ty)
    x0, y0 = tx - 2, ty - 2
    step("The oak on the crest: roots and gnarled trunk")
    for i in range(0, 4, 2):
        oput("3039", x0 + i, y0 - 2, z0, pick(BARK), 0)
        oput("3039", x0 + i, y0 + 4, z0, pick(BARK), 180)
        oput("3039", x0 - 2, y0 + i, z0, pick(BARK), 90)
        oput("3039", x0 + 4, y0 + i, z0, pick(BARK), 270)
    z = z0
    lean = (1, 0)
    for c in range(6):
        if c == 4:
            x0, y0 = x0 + lean[0], y0 + lean[1]
        if c % 2 == 0:
            oput("3001", x0, y0, z, pick(BARK), 0)
            oput("3001", x0, y0 + 2, z, pick(BARK), 0)
        else:
            oput("3001", x0, y0, z, pick(BARK), 90)
            oput("3001", x0 + 2, y0, z, pick(BARK), 90)
        z += 3
    oput("3958", x0 - 1, y0 - 1, z, 308)
    zf = z + 1
    step("The oak's spreading limbs")
    tips = []
    cx, cy = x0 + 2, y0 + 2
    # wide along x like the photo, shorter toward front and back
    for k in range(7):
        a = k * 2 * math.pi / 7 + random.uniform(-0.25, 0.25)
        reach = 8 + 9 * abs(math.cos(a)) + random.randint(0, 2)
        sx, sy = cx + 2 * math.cos(a), cy + 2 * math.sin(a)
        limb(sx, sy, zf, a, int(reach), 1, tips)
    z = zf
    for c in range(5):
        oput("3003", cx - 1, cy - 1, z, pick(BARK))
        z += 3
    oput("3031", cx - 2, cy - 2, z, 308)
    z += 1
    for k in range(4):
        a = k * math.pi / 2 + random.uniform(0.3, 1.2)
        limb(cx + 1.5 * math.cos(a), cy + 1.5 * math.sin(a), z, a, random.randint(5, 8), 2, tips, 1)
    step("The oak's crown: billows of leaves on every branch")
    blobs = []
    for (x, y, zc, sc) in tips:
        r = sc * random.uniform(7, 10)
        hz = sc * random.uniform(16, 24)
        blobs.append((x, y, zc + hz * 0.45, r, hz))
    blobs.append((cx + random.uniform(-2, 2), cy + random.uniform(-2, 2), z + 18, 14, 36))
    crown(blobs, LEAF)
    step("Leaves hanging under the rim of the crown")
    droop(cx, cy, LEAF, 11)


oak(*TREE)


# ---------------------------------------------------------------- chimneys on the hill
def chimney(x, y, courses, palette, pots):
    z = hilltop(x, y)
    for c in range(courses):
        if c % 2 == 0:
            brick("3004", x, y, z, pick(palette)); brick("3004", x, y + 1, z, pick(palette))
        else:
            brick("3004", x, y, z, pick(palette), 90); brick("3004", x + 1, y, z, pick(palette), 90)
        z += 3
    brick("3022", x, y, z, 72)
    z += 1
    for i in range(pots):
        brick("3062b", x + i, y + i % 2, z, 484)


step("Chimneys poking out of the turf: red brick and old stone")
chimney(CHIMNEYS[0][0] - 1, CHIMNEYS[0][1] - 1, 3, [(320, 3), (4, 1), (70, 2)], 2)
chimney(CHIMNEYS[1][0] - 1, CHIMNEYS[1][1] - 1, 3, [(71, 3), (72, 2), (19, 1)], 1)


# ---------------------------------------------------------------- the garden
FLOWERS = [(4, 3), (14, 3), (15, 2), (13, 2), (25, 2), (5, 1), (1, 1)]
WOOD = [(70, 4), (308, 2), (28, 1)]


PH = {"2423": 1, "2417": 1, "3742": 1, "24866": 1, "6141": 1, "3068b": 1, "3069b": 1, "3070b": 1, "3710": 1,
      "2431": 1, "3024": 1, "3023b": 1, "3022": 1, "3062b": 3, "3941": 3, "3003": 3, "4589": 3, "3005": 3,
      "3633": 3, "3004": 3, "3040b": 3, "3039": 3, "3001": 3, "3622": 3}
GH = {}


def gtop(x, y, w=1, d=1, level=False):
    """The garden's own ground: highest surface over the rectangle, counting only lawns, lane and path
    (not the hill, and blind to the crown overhead); with level=True, None unless it is all one height."""
    vals = set()
    for i in range(w):
        for j in range(d):
            key = (x + i, y + j)
            if key not in GH:
                X, Y = key[0] // S, key[1] // S
                if KIND.get((X, Y)) in (None, "hill", "house") or (X, Y) not in H:
                    return None
                GH[key] = max(1, 3 * H[X, Y])
            vals.add(GH[key])
    if level and len(vals) > 1:
        return None
    return max(vals)


def put(part, x, y, z, color, rot=0):
    w, d = FOOT.get(part, (1, 1))
    if rot in (90, 270):
        w, d = d, w
    brick(part, x, y, z, fit(part, color), rot)
    for i in range(w):
        for j in range(d):
            GH[x + i, y + j] = z + PH[part]


FOOT = {"2423": (3, 4), "2417": (5, 6), "3068b": (2, 2), "3069b": (2, 1), "3710": (4, 1), "2431": (4, 1),
        "3023b": (2, 1), "3022": (2, 2), "3941": (2, 2), "3003": (2, 2), "3633": (4, 1), "3004": (2, 1),
        "3040b": (1, 2), "3039": (2, 2)}


def bush(x, y, size, flowers=True):
    """A shrub built from leaves: a wide leaf on the ground, round brick cores lifting smaller leaves
    turned every way, a few blooms caught on top."""
    z = gtop(x - 1, y - 2, 5, 6, True)
    if z is None:
        return
    put("2417", x - 1, y - 2, z, pick(LEAFY), 0)
    zc = z + 1
    for k in range(size):
        put("3941", x, y, zc, 288)
        zc += 3
        for _ in range(2):
            part = "2423" if k or size == 1 else random.choice(["2423", "2417"])
            rot = random.choice((0, 90))
            w, d = FOOT[part] if rot == 0 else FOOT[part][::-1]
            px, py = x + 1 - w // 2 + random.randint(-1, 1), y + 1 - d // 2 + random.randint(-1, 1)
            pz = gtop(px, py, w, d)
            if pz is not None and pz <= zc:
                put(part, px, py, pz, pick(LEAFY), rot)
                zc = max(zc, pz + 1)
    if flowers:
        c = pick(FLOWERS)
        for _ in range(random.randint(2, 4)):
            fx, fy = x + random.randint(-1, 2), y + random.randint(-1, 2)
            fz = gtop(fx, fy)
            if fz is not None and z < fz <= zc + 1:
                put(random.choice(["3742", "24866"]), fx, fy, fz, c)


def flowerbed(x0, y0, w, d, z):
    """A bed of blooms in clumps: round green plates as leaves, flowers in two or three colours."""
    cols = [pick(FLOWERS) for _ in range(3)]
    for x in range(x0, x0 + w):
        for y in range(y0, y0 + d):
            if gtop(x, y) != z or random.random() < 0.2:
                continue
            r = random.random()
            if r < 0.35:
                put("6141", x, y, z, pick(LEAFY))
                put(random.choice(["3742", "24866"]), x, y, z + 1, cols[(x // 2 + y) % 3])
            elif r < 0.7:
                put(random.choice(["3742", "24866"]), x, y, z, cols[(x // 3 + y // 2) % 3])
            else:
                put("3062b", x, y, z, pick(LEAFY))
                put("3742", x, y, z + 3, cols[(x + y) % 3])


def lamp(x, y):
    z = gtop(x, y)
    if z is None:
        return
    for k in range(4):
        put("3062b", x, y, z + 3 * k, 0)
    put("3062b", x, y, z + 12, 46)
    put("4589", x, y, z + 15, 0)


def bench(x, y):
    z = gtop(x, y, 4, 1, True)
    if z is None:
        return
    put("3005", x, y, z, 70)
    put("3005", x + 3, y, z, 70)
    put("3710", x, y, z + 3, 70)
    put("2431", x, y, z + 4, 19)


step("The garden path: a wooden gate in the hedge and flagstones up to the round door")
gz = gtop(41, 2)
for px in (41, 46):
    for k in range(3):
        put("3062b", px, 2, gz + 3 * k, 70)
    put("4589", px, 2, gz + 9, 70)
put("3633", 42, 2, gtop(42, 2, 4, 1), 70)
for k in range(2):
    put("3062b", 38, 4, gtop(38, 4) + 3 * k if k == 0 else GH[38, 4], 70)
put("3004", 37, 4, GH[38, 4], 15)       # the sign: no admittance except on party business
lamp(47, 4)
for y in range(16, 24, 2):
    for x in (42, 44):
        z = gtop(x, y, 2, 2)
        if z is not None:
            put("3068b", x, y, z, pick([(71, 3), (19, 2), (72, 1), (28, 1)]))
for (X, Y) in STAIRS:
    if Y < 6:
        z = gtop(S * X, S * Y, 2, 2)
        if z is not None:
            put(random.choice(["3068b", "3022"]), S * X, S * Y, z, pick([(71, 3), (19, 2), (72, 1)]))

def rail_fence(posts, y):
    """Weathered round posts with a rail across their tops; pickets fill some bays, and a few rails are gone."""
    tops = {}
    for x in posts:
        z = gtop(x, y)
        if z is not None:
            for k in range(3):
                put("3062b", x, y, z + 3 * k, pick(WOOD))
            tops[x] = z + 9
    for x in sorted(tops):
        if x + 3 not in tops or random.random() < 0.15:
            continue
        rail = tops[x]
        if random.random() < 0.5:
            for i in (1, 2):
                z = gtop(x + i, y)
                if z is not None and (rail - z) % 3 == 0:
                    for k in range((rail - z) // 3):
                        put("3062b", x + i, y, z + 3 * k, pick(WOOD))
        put("3623", x, y, rail, pick(WOOD))


PH["3623"], FOOT["3623"] = 1, (3, 1)
step("A rail fence along the lane, a low hedge behind it and a wooden fence on the terrace")
rail_fence(range(40, 10, -3), 2)
rail_fence(range(47, 76, 3), 2)
for x0, x1 in ((14, 40), (48, 70)):
    x = x0
    while x < x1 - 1:
        z = gtop(x, 4, 2, 2, True)
        if z is not None:
            put("3003", x, 4, z, random.choice([288, 2, 2]))
        x += 2
    for layer in range(3):
        x = x0 - 1
        while x < x1:
            part = random.choice(["2423", "2423", "2417"])
            rot = random.choice((0, 90))
            w, d = FOOT[part] if rot == 0 else FOOT[part][::-1]
            y = 5 - d // 2 + random.randint(0, 1)
            z = gtop(x, y, w, d)
            if z is not None and z <= 7 + layer and x + w <= x1 + 1:
                put(part, x, y, z, pick(LEAFY), rot)
            x += random.randint(1, 2)
fz = 3 * F
for x0, x1 in ((18, 41), (47, 64)):
    for x in range(x0, x1 - 3, 4):
        z = gtop(x, 12, 4, 1, True)
        if z == fz:
            put("3633", x, 12, z, 70)
            put("2431", x, 12, z + 3, 28) if random.random() < 0.5 else None

def fruit_tree(x, y):
    """A small apple tree: a slim leaning trunk, two tiers of leaves, red apples tucked in."""
    z = gtop(x, y)
    if z is None:
        return
    for k in range(4):
        put("3062b", x, y, z + 3 * k, 70)
    zc = z + 12
    for (dx, dy, part, rot) in ((-2, -2, "2417", 0), (-1, -1, "2423", 90), (-2, -1, "2417", 90), (0, -1, "2423", 0)):
        w, d = FOOT[part] if rot == 0 else FOOT[part][::-1]
        put(part, x + dx, y + dy, zc, pick(LEAFY), rot)
        if part == "2417" and dx == -2 and dy == -2:
            put("3062b", x, y, zc + 1, 70)
            zc += 3
        zc += 1
    for _ in range(6):
        ax, ay = x + random.randint(-2, 2), y + random.randint(-2, 2)
        az = gtop(ax, ay)
        if az is not None and az > z + 12:
            put("6141", ax, ay, az, random.choice([4, 4, 320, 14]))


def veg_patch(x0, y0, w, rows):
    """Sam's vegetables: rows of dark soil with cabbages, leeks and pumpkins."""
    for r in range(rows):
        y = y0 + 2 * r
        for x in range(x0, x0 + w - 3, 4):
            z = gtop(x, y, 4, 1, True)
            if z is None:
                continue
            put("3710", x, y, z, 308)
            for i in range(4):
                crop = random.random()
                if crop < 0.35:
                    put("6141", x + i, y, z + 1, random.choice([10, 2, 27]))
                elif crop < 0.5:
                    put("3062b", x + i, y, z + 1, 25)
                elif crop < 0.7:
                    put("3062b", x + i, y, z + 1, random.choice([2, 10]))

step("Sam's garden: an apple tree, a vegetable patch, a bench by the door")
fruit_tree(22, 9)
fruit_tree(64, 16)
veg_patch(50, 7, 14, 2)
bench(34, 20)
lamp(38, 21)
lamp(49, 21)

step("Flower beds under the windows and bushes along the terraces")
yz = 3 * F
for x0, x1 in ((FX0 + 1, 41), (47, FX1 - 1)):
    flowerbed(x0, 22, x1 - x0, 2, yz)
for x, y in ((20, 17), (28, 16), (53, 17), (58, 20), (38, 10), (29, 8), (46, 9), (17, 6), (33, 7), (60, 13)):
    bush(x, y, random.choice((1, 2, 3)))

PH["15279"], FOOT["15279"] = 8, (1, 2)
step("Weeds gone wild: tall stalks, long grass, dandelions and ferns through the lawns and round the beds")
for x in range(W):
    for y in range(FY):
        z = gtop(x, y)
        if z is None or z != max(1, 3 * H[x // S, y // S]) or random.random() > 0.4:
            continue
        r = random.random()
        if r < 0.35:
            n = random.randint(1, 4)
            reed = gtop(x, y, 1, 2, True) == z and random.random() < 0.5
            for j in range(1 + reed):
                for k in range(n):
                    put("3062b", x, y + j, z + 3 * k, random.choice([2, 2, 288]))
            if reed:
                put("15279", x, y, z + 3 * n, random.choice([10, 27, 288, 330]))
            else:
                part, color = random.choice([("6141", 330), ("6141", 27), ("3742", 14), ("3742", 15), ("4589", 2)])
                put(part, x, y, z + 3 * n, color)
        elif r < 0.6 and gtop(x, y, 1, 2, True) == z:
            put("15279", x, y, z, random.choice([10, 27, 288, 330]))
        elif r < 0.72:
            put("6141", x, y, z, random.choice([27, 330, 2]))
        elif r < 0.8:
            put("3742", x, y, z, random.choice([14, 14, 15]))
        elif gtop(x - 1, y - 1, 3, 4, True) == z:
            put("2423", x - 1, y - 1, z, random.choice([330, 288, 27]))

step("Wildflowers, grasses and weeds flourishing in patches across the hill")
pads = {(X, Y) for (px, py), r in [(TREE, 2)] + [(c, 1) for c in CHIMNEYS]
        for X in range(px // S - r, px // S + r + 1) for Y in range(py // S - r, py // S + r + 1)}
for (X, Y), h in H.items():
    if KIND.get((X, Y)) != "hill" or h < 2 or 3 * h + 11 > 96 or (X, Y) in pads or rocky(X, Y):
        continue
    sloped = (X, Y, h - 1) in slopes
    back = slopes.get((X, Y, h - 1))
    if sloped and back is None:
        continue
    studs = [(i, j) for i in (0, 1) for j in (0, 1)
             if not sloped or (back[0] and i == (back[0] > 0)) or (back[1] and j == (back[1] > 0))]
    lush = noise(X * 0.33 + 11, Y * 0.33 - 4) > 0.1
    grown = set()
    for i, j in studs:
        x, y, z = S * X + i, S * Y + j, 3 * h
        if random.random() > (0.4 if lush else 0.05) or (i, j) in grown:
            continue
        grown.add((i, j))
        r = random.random()
        if r < 0.3 and not sloped and j == 0 and (i, 1) not in grown:
            grown.add((i, 1))
            brick("15279", x, y, z, random.choice([10, 27, 288, 330]))
        elif r < 0.5:
            n = random.randint(1, 3)
            for k in range(n):
                brick("3062b", x, y, z + 3 * k, random.choice([2, 2, 288]))
            part, color = random.choice([("6141", 330), ("6141", 27), ("3742", 14), ("3742", 15), ("4589", 2)])
            brick(part, x, y, z + 3 * n, fit(part, color))
        elif r < 0.8:
            brick("3742", x, y, z, fit("3742", pick(FLOWERS)))
        else:
            brick("6141", x, y, z, fit("6141", random.choice([27, 330, 2, 288])))
