"""Solids on a stud-by-course grid, meshed into bricks: the outer shell only, slopes on steady steps, every brick held."""

from __future__ import annotations

import math
from collections import defaultdict, deque
from collections.abc import Callable, Hashable, Iterable

from brickyard import ldraw
from brickyard.shapes import BRICK_RUN, brick, footprint, split

Cell = tuple[int, int]
Voxel = tuple[int, int, int]
Color = int | Callable[[int, int, int], int]
Piece = tuple[float, Hashable, dict]
SIDES = {(0, -1): 0, (-1, 0): 90, (1, 0): 270, (0, 1): 180}
SLOPES = {1: "3040b", 2: "60481a", 3: "4460b"}


def circle(cx: float, cy: float, r: float) -> set[Cell]:
    """The studs whose centers lie within r of (cx, cy)."""
    return {
        (x, y)
        for x in range(math.floor(cx - r), math.ceil(cx + r))
        for y in range(math.floor(cy - r), math.ceil(cy + r))
        if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r
    }


def erode(cells: set[Cell], ridge: str | None = None) -> set[Cell]:
    """The cells kept by a roof's next step: in from every side for a hip, from the long sides for a ridge along x or y."""
    near = {
        None: [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy],
        "x": [(0, -1), (0, 1)],
        "y": [(-1, 0), (1, 0)],
    }[ridge]
    return {(x, y) for x, y in cells if all((x + dx, y + dy) in cells for dx, dy in near)}


class Sculpture:
    """Solids unioned voxel by voxel, one stud by one brick course; course k sits at plate z0 + 3k."""

    def __init__(self, z0: int = 1) -> None:
        self.z0 = z0
        self.solid: dict[Voxel, tuple[int, bool, Hashable]] = {}
        self.claimed: set[Voxel] = set()
        """The voxels pieces fill: the solids give way to them."""
        self.placed: dict[Voxel, Hashable] = {}
        """The claimed voxels of each piece in the solids' own step, which holds nothing up until a chain holds it."""
        self.core: set[Voxel] = set()
        self.owner: Hashable = ""

    def fill(self, cells: Iterable[Cell], k0: int, k1: int, color: Color, sloped: bool = False) -> None:
        for x, y in cells:
            for k in range(k0, k1):
                if (x, y, k) not in self.claimed:
                    self.solid[x, y, k] = (color(x, y, k) if callable(color) else color, sloped, self.owner)

    def carve(self, cells: Iterable[Cell], k0: int, k1: int) -> None:
        for x, y in cells:
            for k in range(k0, k1):
                self.solid.pop((x, y, k), None)

    def roof(self, cells: Iterable[Cell], k0: int, color: Color, pitch: int = 2, ridge: str | None = None) -> int:
        """A roof stepping in one stud every `pitch` courses from k0; returns the course above its top."""
        cells, k = set(cells), k0
        while cells:
            self.fill(cells, k, k + pitch, color, sloped=True)
            cells, k = erode(cells, ridge), k + pitch
        return k

    def cone(self, cx: float, cy: float, r: float, k0: int, height: int, color: Color) -> int:
        """A spire of shrinking circles; returns the course above its tip."""
        for i in range(height):
            cells = circle(cx, cy, r * (1 - i / height))
            if not cells:
                return k0 + i
            self.fill(cells, k0 + i, k0 + i + 1, color, sloped=True)
        return k0 + height

    def mesh(self, ground: Callable[[int, int], int]) -> list[Piece]:
        """Bricks for the shell of every course, with the course and owner of each, lowest first.

        A brick no chain of stacked bricks links to the ground or an earlier piece gets the hidden voxels under it as
        bricks, down to support.
        """
        pieces = self._mesh(ground)
        while True:
            core = set()
            for voxels in self._loose(pieces, ground):
                pillars = [p for p in (self._under(*v, ground) for v in voxels) if p]
                core.update(min(pillars, key=len, default=[]))
            if not core - self.core:
                break
            self.core |= core
            pieces = self._mesh(ground)
        return pieces

    def _loose(self, pieces: list[Piece], ground: Callable[[int, int], int]) -> list[list[Voxel]]:
        """The voxels of each brick, or piece placed in this step, that no chain of stacked bricks links to support."""
        owner: dict[Voxel, Hashable] = {v: ("placed", i) for v, i in self.placed.items()}
        for i, (_, _, b) in enumerate(pieces):
            w, d = footprint(b["part"], b["rotation"])
            courses = -(-ldraw.info(ldraw.resolve(b["part"]) or b["part"]).plates // 3)
            k0 = (b["z"] - self.z0) // 3
            for x in range(b["x"], b["x"] + w):
                for y in range(b["y"], b["y"] + d):
                    owner.update(dict.fromkeys(((x, y, k) for k in range(k0, k0 + courses)), i))
        earlier = self.claimed - self.placed.keys()
        links: dict[Hashable, set[Hashable]] = defaultdict(set)
        held = set()
        for (x, y, k), i in owner.items():
            if k <= ground(x, y) or (x, y, k - 1) in earlier or (x, y, k + 1) in earlier:
                held.add(i)
            for j in (owner.get((x, y, k - 1)), owner.get((x, y, k + 1))):
                if j is not None and j != i:
                    links[i].add(j)
        queue = deque(held)
        while queue:
            for j in links[queue.popleft()] - held:
                held.add(j)
                queue.append(j)
        loose: dict[Hashable, list[Voxel]] = defaultdict(list)
        for v, i in owner.items():
            if i not in held:
                loose[i].append(v)
        return list(loose.values())

    def _under(self, x: int, y: int, k: int, ground: Callable[[int, int], int]) -> list[Voxel]:
        """The solid voxels under a stud down to the ground, a placed part or a support; none over open space."""
        out = []
        while k > ground(x, y):
            below = (x, y, k - 1)
            if below in self.claimed or below in self.core:
                return out
            if below not in self.solid:
                return []
            out.append(below)
            k -= 1
        return out

    def _mesh(self, ground: Callable[[int, int], int]) -> list[Piece]:
        layers: dict[int, set[Cell]] = defaultdict(set)
        for x, y, k in self.solid:
            layers[k].add((x, y))
        shown = {k: {c for c in cells if self._shown(c, k, cells)} for k, cells in layers.items()}
        done: set[Voxel] = set()

        def held(x: int, y: int, k: int) -> bool:
            below = (x, y, k - 1)
            return k <= ground(x, y) or below in done or below in self.claimed or (x, y) in shown.get(k - 1, ())

        out = self._slopes(layers, shown, done, held)
        runs: dict[int, list[tuple[Cell, list[Cell]]]] = defaultdict(list)
        for k in sorted(layers, reverse=True):
            self._hold(k, layers[k], shown, runs[k], done, held)
        for k in sorted(layers):
            bridged = {c for _, run in runs[k] for c in run}
            for c, run in runs[k]:
                x, y = run[0]
                color, _, owner = self.solid[(*c, k)]
                along_x, along_y = run[0][1] == run[-1][1], run[0][0] == run[-1][0]
                part = BRICK_RUN[len(run)] if along_x or along_y else "3003"
                out.append((k, owner, brick(part, x, y, self.z0 + 3 * k, color, 90 if along_y else 0)))
            rest = {c for c in shown[k] - bridged if (*c, k) not in done}
            out += self._runs(rest, k, held)
        return sorted(out, key=lambda p: p[0])

    def _shown(self, c: Cell, k: int, cells: set[Cell]) -> bool:
        """Seen from outside or carrying something: near an empty stud of its course, or in the two courses under an
        open top, which bond into a slab its walls carry."""
        x, y = c
        if (x, y, k + 1) not in self.solid or (x, y, k + 2) not in self.solid or (x, y, k) in self.core:
            return True
        t = 2 if self.solid[x, y, k][1] else 1
        return any((x + dx, y + dy) not in cells for dx in range(-t, t + 1) for dy in range(-t, t + 1))

    def _slopes(self, layers, shown, done: set[Voxel], held) -> list[Piece]:
        """Slopes 1 to 3 courses tall on the steps of sloped solids, as steep as the step above them."""
        out = []
        solid = self.solid
        for k in sorted(layers):
            for x, y in sorted(shown[k]):
                color, sloped, owner = solid[x, y, k]
                if not sloped or (x, y, k) in done or (x, y, k + 1) in solid or (x, y, k + 1) in self.claimed:
                    continue
                sides = [d for d in SIDES if (x + d[0], y + d[1]) not in layers[k]]
                if len(sides) != 1 or (x + sides[0][0], y + sides[0][1], k) in self.claimed:
                    continue
                dx, dy = sides[0]
                wx, wy = x - dx, y - dy
                if (wx, wy, k) not in solid or (wx, wy, k) in done or (wx, wy, k + 1) not in solid:
                    continue
                rise = 1
                while rise < 3 and (wx, wy, k + 1 + rise) in solid:
                    rise += 1
                m = 1
                while m < rise and self._face(x, y, wx, wy, dx, dy, k - m, done):
                    m += 1
                b = k - m + 1
                if not (held(x, y, b) or held(wx, wy, b)):
                    continue
                for j in range(b, k + 1):
                    done.update(((x, y, j), (wx, wy, j)))
                out.append((b, owner, brick(SLOPES[m], min(x, wx), min(y, wy), self.z0 + 3 * b, color, SIDES[dx, dy])))
        return out

    def _face(self, x: int, y: int, wx: int, wy: int, dx: int, dy: int, j: int, done: set[Voxel]) -> bool:
        """Whether course j carries on the step's upright face, so a taller slope fits."""
        v, w = (x, y, j), (wx, wy, j)
        return (
            v in self.solid
            and self.solid[v][1]
            and v not in done
            and w in self.solid
            and w not in done
            and (x + dx, y + dy, j) not in self.solid
            and (x + dx, y + dy, j) not in self.claimed
        )

    def _bridge(self, c: Cell, k: int, layer, shown, taken, done, held) -> list[Cell] | None:
        """The shortest straight run of 2 to 4 studs from c that reaches a held one, keeping the facade's colors if it can."""
        for strict in (True, False):
            found = self._bridges(c, k, layer, shown, taken, done, held, strict)
            if found:
                return found[0]
        return None

    def _bridges(self, c: Cell, k: int, layer, shown, taken, done, held, strict: bool) -> list[list[Cell]]:
        """Every straight run of 2 to 4 free studs from c, or 2x2 square around it, reaching a held one, shortest first."""
        color = self.solid[(*c, k)][0]
        axes = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if k % 2:
            axes = axes[2:] + axes[:2]
        runs = [[(c[0] + dx * i, c[1] + dy * i) for i in range(n)] for n in (2, 3, 4) for dx, dy in axes]
        runs += [[(c[0] + sx + i, c[1] + sy + j) for i in (0, 1) for j in (0, 1)] for sx in (0, -1) for sy in (0, -1)]
        out = []
        for cells in runs:
            if all(
                q in layer
                and q not in taken
                and (*q, k) not in done
                and not (strict and q in shown and self.solid[(*q, k)][0] != color)
                for q in cells
            ) and any(held(*q, k) for q in cells if q != c):
                out.append(sorted(cells))
        return out

    def _hold(self, k: int, layer, shown, runs: list[tuple[Cell, list[Cell]]], done, held) -> None:
        """Bridges for the studs of course k with nothing under them, where one fits."""
        taken: dict[Cell, int] = {}
        hanging = {c for c in shown[k] if (*c, k) not in done and not held(*c, k)}
        options = {c: len(self._bridges(c, k, layer, shown[k], {}, done, held, strict=False)) for c in hanging}
        queue = deque(sorted(hanging, key=lambda c: (options[c], c)))
        budget = 4 * len(hanging)
        while queue:
            c = queue.popleft()
            if c in taken:
                continue
            run = self._bridge(c, k, layer, shown[k], taken, done, held)
            if run:
                taken.update(dict.fromkeys(run, len(runs)))
                shown[k].update(run)
                runs.append((c, run))
                continue
            grown = self._extend(c, runs, taken)
            if grown is not None:
                origin, run = runs[grown]
                runs[grown] = (origin, sorted([*run, c]))
                taken[c] = grown
                continue
            if budget > 0:
                budget -= 1
                freed = self._reroute(c, k, layer, shown[k], taken, runs, done, held)
                if freed is not None:
                    queue.extend(q for q in freed if q in hanging and q not in taken)

    def _reroute(self, c: Cell, k: int, layer, shown, taken, runs, done, held, depth: int = 3) -> list[Cell] | None:
        """Takes a run for c that crosses one bridge and moves that bridge elsewhere, recursively; returns the studs let go."""
        index = len(runs)
        runs.append((c, []))
        freed = self._claim(c, index, k, layer, shown, taken, runs, done, held, depth, {index})
        if freed is None:
            runs.pop()
        return freed

    def _claim(self, c: Cell, i: int, k: int, layer, shown, taken, runs, done, held, depth: int, busy: set[int]):
        """Gives run i a bridge from c, moving one blocking bridge at a time up to `depth` deep; None if it can't."""
        run = self._bridge(c, k, layer, shown, taken, done, held)
        if run:
            taken.update(dict.fromkeys(run, i))
            runs[i] = (c, run)
            shown.update(run)
            return []
        if depth == 0:
            return None
        for path in self._bridges(c, k, layer, shown, {}, done, held, strict=False):
            blockers = {taken[q] for q in path if q in taken}
            if len(blockers) != 1:
                continue
            j = blockers.pop()
            if j in busy:
                continue
            origin, old = runs[j]
            if origin in path:
                continue
            for q in old:
                del taken[q]
            taken.update(dict.fromkeys(path, i))
            freed = self._claim(origin, j, k, layer, shown, taken, runs, done, held, depth - 1, busy | {j})
            if freed is None:
                for q in path:
                    del taken[q]
                taken.update(dict.fromkeys(old, j))
                runs[j] = (origin, old)
                continue
            runs[i] = (c, path)
            shown.update(path)
            return freed + [q for q in old if q not in taken]
        return None

    @staticmethod
    def _extend(c: Cell, runs: list[tuple[Cell, list[Cell]]], taken: dict[Cell, int]) -> int | None:
        """The bridge c can join by carrying it on in a straight line, up to 4 studs."""
        for dx, dy in SIDES:
            i = taken.get((c[0] + dx, c[1] + dy))
            if i is None:
                continue
            run = runs[i][1]
            if len(run) < 4 and (c[0] + 2 * dx, c[1] + 2 * dy) in run:
                return i
        return None

    def _runs(self, cells: set[Cell], k: int, held) -> list[Piece]:
        """Greedy bonded runs of 1-stud-wide bricks, along x on even courses and y on odd ones where they can.

        A brick with nothing under it comes after the course above, so it hangs from the brick on top.
        """
        out = []
        free = set(cells)
        key = {c: self.solid[(*c, k)][::2] for c in cells}
        first = (1, 0) if k % 2 == 0 else (0, 1)
        for c in sorted(cells, key=lambda c: (c[1], c[0]) if first == (1, 0) else c):
            if c not in free:
                continue
            for dx, dy in (first, first[::-1]):
                n = 1
                while (c[0] + dx * n, c[1] + dy * n) in free and key[c[0] + dx * n, c[1] + dy * n] == key[c]:
                    n += 1
                if n > 1:
                    break
            color, owner = key[c]
            at = 0
            for size in split(n, BRICK_RUN, stagger=k % 2 == 1):
                x, y = c[0] + dx * at, c[1] + dy * at
                hangs = not any(held(x + dx * i, y + dy * i, k) for i in range(size))
                out.append(
                    (
                        k + 1.5 if hangs else k,
                        owner,
                        brick(BRICK_RUN[size], x, y, self.z0 + 3 * k, color, 0 if dx else 90),
                    )
                )
                at += size
            free -= {(c[0] + dx * i, c[1] + dy * i) for i in range(n)}
        return out
