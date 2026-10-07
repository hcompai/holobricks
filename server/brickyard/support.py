"""Find detached groups in the complete model, independent of script step order.

This is a bounding-box contact check, not a stud/socket or strength proof.
Separate ground-level objects are allowed; hanging parts can reach the ground
through a roof or wall without filling the space beneath them.
"""

from collections import defaultdict
from itertools import product

from brickyard.model import ACCESSORIES, FACINGS, Piece, bounds

EPS = 0.5
CELL = 80
BACKS = {"south": (2, 1), "north": (2, -1), "west": (0, 1), "east": (0, -1)}


def overlap(a: tuple, b: tuple) -> tuple[float, float, float]:
    return tuple(min(a[1][k], b[1][k]) - max(a[0][k], b[0][k]) for k in range(3))


def touches(a: tuple, b: tuple) -> bool:
    """Stacked with no gap: body bottoms meet a top surface or stud tops."""
    dx, _, dz = overlap(a, b)
    return (
        dx > EPS
        and dz > EPS
        and any(abs(lower[0][1] + s - upper[1][1]) < 1 for upper, lower in ((a, b), (b, a)) for s in (0, 4))
    )


def behind(box: tuple, facing: str) -> tuple:
    axis, sign = BACKS[facing]
    lo, hi = list(box[0]), list(box[1])
    (hi if sign > 0 else lo)[axis] += sign
    return tuple(lo), tuple(hi)


def detached(pieces: list[Piece]) -> list[list[Piece]]:
    """Contact components with no path to a piece at ground level (LDraw y=0)."""
    parents = {p.id: p.id for p in pieces}
    boxes = {p.id: bounds(p) for p in pieces}
    backs = {
        p.id: behind(boxes[p.id], facing)
        for p in pieces
        if (facing := next((f for f, r in FACINGS.items() if tuple(p.rot) == r), None))
    }
    cells = defaultdict(set)
    placed = {}

    def root(pid):
        while parents[pid] != pid:
            parents[pid] = parents[parents[pid]]
            pid = parents[pid]
        return pid

    for p in pieces:
        box = boxes[p.id]
        # Include touching faces across cell boundaries and a mounted part's backing.
        occupied = list(
            product(*(range(int((box[0][k] - 1) // CELL), int((box[1][k] + 1) // CELL) + 1) for k in range(3)))
        )
        for other in {i for cell in occupied for i in cells[cell]}:
            q = placed[other]
            accessory = (
                p.pos == q.pos
                and p.rot == q.rot
                and (ACCESSORIES.get(p.part, (None,))[0] == q.part or ACCESSORIES.get(q.part, (None,))[0] == p.part)
            )
            contact = touches(box, boxes[other]) or accessory
            contact |= p.id in backs and min(overlap(backs[p.id], boxes[other])) > EPS
            contact |= other in backs and min(overlap(backs[other], box)) > EPS
            if contact:
                parents[root(p.id)] = root(other)
        for cell in occupied:
            cells[cell].add(p.id)
        placed[p.id] = p

    grounded = {root(p.id) for p in pieces if boxes[p.id][1][1] >= -EPS}
    groups = defaultdict(list)
    for p in pieces:
        if root(p.id) not in grounded:
            groups[root(p.id)].append(p)
    return sorted(groups.values(), key=lambda group: min(p.id for p in group))
