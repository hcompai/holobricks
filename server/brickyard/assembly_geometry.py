"""Conservative rigid insertion envelopes, in LDraw coordinates.

Full mesh bounds are used, never the stud-grid footprint. A protruding stud cap
is separated only when every mesh polygon outside its plane fits inside one
metadata-backed stud envelope. Cavities other than engaged sockets remain
filled: this can reject feasible builds, but does not infer empty space.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import cache
from itertools import product

from brickyard import ldraw
from brickyard.connectors import EPS, Port, Vec, add, dot, vector
from brickyard.model import Piece


@dataclass(frozen=True)
class Envelope:
    lo: Vec
    hi: Vec
    stud: Port | None = None


def axis_of(direction: Vec) -> tuple[int, int] | None:
    axis = max(range(3), key=lambda k: abs(direction[k]))
    if abs(abs(direction[axis]) - 1) > 1e-6 or any(abs(direction[k]) > 1e-6 for k in range(3) if k != axis):
        return None
    return axis, 1 if direction[axis] > 0 else -1


def rigid_grid(piece: Piece) -> bool:
    axes = [tuple(piece.rot[3 * r + c] for r in range(3)) for c in range(3)]
    a, b, c, d, e, f, g, h, i = piece.rot
    determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    return (
        abs(determinant - 1) < 1e-6
        and all(axis_of(a) is not None for a in axes)
        and all(abs(dot(a, b)) < 1e-6 for i, a in enumerate(axes) for b in axes[:i])
        and all(math.isfinite(x) for x in piece.pos)
    )


@cache
def polygons(name: str) -> tuple[tuple[Vec, ...], ...]:
    out = []
    for line in ldraw.read(name):
        words = line.split()
        if words and words[0] in {"3", "4"}:
            points = tuple(tuple(float(v) for v in words[i : i + 3]) for i in range(2, 2 + int(words[0]) * 3, 3))
            out.append(points)
    for values, child in ldraw._references(name):
        out.extend(tuple(add(values[:3], vector(values[3:], v)) for v in polygon) for polygon in polygons(child))
    return tuple(out)


def clip(polygon: tuple[Vec, ...], axis: int, plane: float, sign: int) -> tuple[Vec, ...]:
    """Clip a convex LDraw face to the outward half-space."""
    result = []
    for a, b in zip(polygon, (*polygon[1:], polygon[0]), strict=True):
        da, db = (a[axis] - plane) * sign, (b[axis] - plane) * sign
        if da >= 0:
            result.append(a)
        if (da < 0 < db) or (db < 0 < da):
            t = da / (da - db)
            result.append(tuple(x + t * (y - x) for x, y in zip(a, b, strict=True)))
    return tuple(result)


@cache
def local_envelopes(part: str, ports: tuple[Port, ...]) -> tuple[Envelope, ...]:
    faces = polygons(part)
    points = [v for face in faces for v in face]
    if not points:
        raise ValueError(f"No mesh for {part}")
    lo = [min(v[k] for v in points) for k in range(3)]
    hi = [max(v[k] for v in points) for k in range(3)]
    caps = []
    for axis in range(3):
        for sign in [-1, 1]:
            studs = [p for p in ports if p.gender == "M" and axis_of(p.axis) == (axis, sign)]
            if not studs:
                continue
            plane = max(sign * p.pos[axis] for p in studs) * sign
            studs = [p for p in studs if abs(p.pos[axis] - plane) < EPS]
            if ((hi[axis] if sign == 1 else lo[axis]) - plane) * sign > 4 + EPS:
                continue
            boxes = []
            for p in studs:
                a, b = list(p.pos), list(p.pos)
                for k in range(3):
                    if k == axis:
                        a[k] += min(0, sign * 4)
                        b[k] += max(0, sign * 4)
                    else:
                        a[k] -= 6
                        b[k] += 6
                boxes.append(Envelope(tuple(a), tuple(b), p))
            # Every outside polygon must fit wholly into one cap; checking only
            # individual vertices could incorrectly accept a bridge across caps.
            outside = [
                clip(face, axis, plane, sign) for face in faces if any((v[axis] - plane) * sign > EPS for v in face)
            ]
            if outside and all(
                any(
                    all(all(box.lo[k] - EPS <= v[k] <= box.hi[k] + EPS for k in range(3)) for v in face)
                    for box in boxes
                )
                for face in outside
            ):
                if sign == 1:
                    hi[axis] = plane
                else:
                    lo[axis] = plane
                caps.extend(boxes)
    return (Envelope(tuple(lo), tuple(hi)), *caps)


def envelopes(piece: Piece, ports: tuple[Port, ...]) -> tuple[Envelope, ...]:
    out = []
    for box in local_envelopes(piece.part, ports):
        points = [add(piece.pos, vector(piece.rot, v)) for v in product(*zip(box.lo, box.hi, strict=True))]
        out.append(
            Envelope(
                tuple(min(v[k] for v in points) for k in range(3)),
                tuple(max(v[k] for v in points) for k in range(3)),
                box.stud.transform(piece.pos, piece.rot) if box.stud else None,
            )
        )
    return tuple(out)


def swept_interval(moving: Envelope, fixed: Envelope, direction: Vec) -> tuple[float, float] | None:
    """Open volume intersection while translating moving + t*direction, t>=0.

    A tiny 0.001 LDU tolerance absorbs LDraw rounding, not LEGO clearances.
    Infinite travel proves an unobstructed straight approach from outside.
    """
    start, end = 0.0, math.inf
    tolerance = 0.001
    for k in range(3):
        d = direction[k]
        low, high = fixed.lo[k] - moving.hi[k] + tolerance, fixed.hi[k] - moving.lo[k] - tolerance
        if abs(d) < 1e-9:
            if low >= 0 or high <= 0:
                return None
        else:
            a, b = sorted((low / d, high / d))
            start, end = max(start, a), min(end, b)
    return (start, end) if end > start else None
