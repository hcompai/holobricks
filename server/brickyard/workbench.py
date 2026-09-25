"""The stateful model an agent edits: validated brick edits, part search, and renders from the open viewer."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from brickyard import ldraw
from brickyard.model import ROTATIONS, Piece, Placement, bounds, grid, place, with_accessories
from brickyard.session import Session

SIZE = 32 * ldraw.STUD
STUD_HEIGHT = 4
EPS = 0.5

COMMON_COLORS = (0, 15, 71, 72, 4, 320, 25, 14, 19, 28, 70, 2, 288, 10, 27, 1, 272, 73, 322, 5, 47, 43, 36, 46)

COMMON_PARTS = [
    "3005",
    "3004",
    "3622",
    "3010",
    "3009",
    "3008",
    "3003",
    "3002",
    "3001",
    "2456",
    "3007",
    "3024",
    "3023b",
    "3623",
    "3710",
    "3666",
    "3460",
    "3022",
    "3021",
    "3020",
    "3795",
    "3034",
    "3031",
    "3958",
    "3070b",
    "3069b",
    "3068b",
    "98138",
    "6141",
    "3040b",
    "3039",
    "3038",
    "3037",
    "3043",
    "3044b",
    "4286",
    "3298",
    "3300",
    "3688",
    "3062b",
    "3941",
    "4589",
    "3942c",
    "3659",
    "3455",
    "2877",
    "60592",
    "60596",
    "3633",
    "3742",
    "3471",
    "3470",
    "2423",
]


class Brick(BaseModel):
    part: str
    x: int
    y: int
    z: int
    color: int
    rotation: int = 0


@dataclass
class Result:
    text: str
    note: str | None = None
    image: bytes | None = None


def _overlap(a: tuple, b: tuple) -> tuple[float, float, float]:
    return tuple(min(a[1][k], b[1][k]) - max(a[0][k], b[0][k]) for k in range(3))  # type: ignore[return-value]


def _collides(a: tuple, b: tuple) -> bool:
    dx, dy, dz = _overlap(a, b)
    return dx > EPS and dz > EPS and dy > STUD_HEIGHT + EPS


def _touches(a: tuple, b: tuple) -> bool:
    """Stacked with no gap: one's bottom meets the other's top surface or stud tops."""
    dx, _, dz = _overlap(a, b)
    if dx <= EPS or dz <= EPS:
        return False
    return any(abs(lower[0][1] + s - upper[1][1]) < 1 for upper, lower in ((a, b), (b, a)) for s in (0, STUD_HEIGHT))


def _where(p: Placement | Piece) -> str:
    x, y, z, rotation = grid(p)
    return f"{p.part.removesuffix('.dat')} at x={x} y={y} z={z}" + (f" rot={rotation}" if rotation else "")


def part_line(part: str) -> str:
    info = ldraw.info(part)
    w, d = info.footprint
    height = f"{info.plates} plate" + ("s" if info.plates != 1 else "")
    return f"{part.removesuffix('.dat')}: {info.title} | W={w} along x, D={d} along y | {height} tall"


class Workbench:
    def __init__(self, session: Session):
        self.session = session

    @property
    def pieces(self) -> list[Piece]:
        return self.session.build.pieces

    def _check(self, bricks: list[Brick]) -> tuple[list[Placement], list[str], list[str]]:
        """Placements that fit, plus rejection and warning lines, for a batch checked against itself and the build."""
        taken = [(bounds(p), f"#{p.id} {_where(p)}") for p in self.pieces]
        accepted: list[tuple[Placement, tuple]] = []
        rejected, warnings = [], []
        for n, brick in enumerate(bricks, 1):
            label = f"brick {n} ({brick.part} at x={brick.x} y={brick.y} z={brick.z})"
            part = ldraw.resolve(brick.part)
            if part is None:
                rejected.append(f"{label}: unknown part; use find_parts")
                continue
            if brick.color not in ldraw.colors():
                rejected.append(f"{label}: unknown color {brick.color}")
                continue
            if brick.rotation not in ROTATIONS:
                rejected.append(f"{label}: rotation must be 0, 90, 180 or 270")
                continue
            placement = place(part, brick.x, brick.y, brick.z, brick.color, brick.rotation)
            box = bounds(placement)
            if box[0][0] < -EPS or box[0][2] < -EPS or box[1][0] > SIZE + EPS or box[1][2] > SIZE + EPS:
                rejected.append(f"{label}: outside the 32x32 baseplate")
                continue
            if brick.z < 0:
                rejected.append(f"{label}: below the baseplate")
                continue
            hit = next((what for other, what in taken if _collides(box, other)), None)
            if hit:
                rejected.append(f"{label}: overlaps {hit}")
                continue
            if not any(_touches(box, other) for other, _ in taken):
                warnings.append(f"{label}: floating, nothing directly under or above it")
            accepted.append((placement, box))
            taken.append((box, f"brick {n} of this step"))
        return [p for placement, _ in accepted for p in with_accessories(placement)], rejected, warnings

    async def add(self, title: str, bricks: list[dict]) -> Result:
        try:
            parsed = [Brick.model_validate(b) for b in bricks]
        except ValidationError as e:
            return Result(f"Invalid bricks: {e.errors(include_url=False)}")
        if not parsed:
            return Result("No bricks given.")
        placements, rejected, warnings = await asyncio.to_thread(self._check, parsed)
        lines = []
        if placements:
            step = await self.session.step(title, placements)
            new = [p for p in self.pieces if p.step == step.index]
            lines.append(f"Step {step.index} '{title}': placed {len(new)} pieces as #{new[0].id}-#{new[-1].id}.")
        if rejected:
            lines.append(f"Rejected {len(rejected)}, not placed:\n" + "\n".join(rejected))
        if warnings:
            lines.append("Placed but check:\n" + "\n".join(warnings))
        note = f"Added {len(placements)} pieces: {title}" if placements else f"Rejected every brick of '{title}'"
        return Result("\n".join(lines), note=note)

    async def remove(self, ids: list[int]) -> Result:
        removed = await self.session.remove(set(ids))
        missing = sorted(set(ids) - {p.id for p in removed})
        text = f"Removed {len(removed)} pieces." + (f" No such pieces: {missing}." if missing else "")
        return Result(text, note=f"Removed {len(removed)} pieces")

    async def look(self) -> Result:
        png = await self.session.render()
        summary = await asyncio.to_thread(self.summary)
        if png is None:
            return Result(f"No viewer is open, so no image this time.\n{summary}", note="Looked (no viewer open)")
        return Result(summary, note="Looked at the model", image=png)

    async def find_parts(self, query: str) -> Result:
        hits = await asyncio.to_thread(lambda: [part_line(p) for p in ldraw.search(query)])
        text = "\n".join(hits) if hits else f"No parts match '{query}'. Try fewer or simpler words."
        return Result(text, note=f"Searched parts for '{query}'")

    async def list_pieces(self) -> Result:
        return Result(await asyncio.to_thread(self.describe))

    async def rename(self, name: str) -> Result:
        await self.session.rename(name.strip()[:60] or "Untitled build")
        return Result(f"Build is now called '{self.session.build.name}'.")

    def summary(self) -> str:
        pieces = [p for p in self.pieces if p.part != "3811.dat"]
        if not pieces:
            return "The baseplate is empty."
        boxes = [grid(p) for p in pieces]
        top = max(round((-bounds(p)[0][1] - STUD_HEIGHT) / ldraw.PLATE) for p in pieces)
        xs, ys = [b[0] for b in boxes], [b[1] for b in boxes]
        return (
            f"{len(pieces)} pieces in {len(self.session.build.steps)} steps, spanning x {min(xs)}-{max(xs)}, "
            f"y {min(ys)}-{max(ys)}, up to plate height {top}."
        )

    def describe(self) -> str:
        if not self.pieces:
            return "No pieces yet."
        palette = ldraw.colors()
        lines = []
        for step in self.session.build.steps:
            pieces = [p for p in self.pieces if p.step == step.index]
            if pieces:
                lines.append(f"Step {step.index} {step.title}:")
                lines += [f"  #{p.id} {_where(p)} color={p.color} ({palette.get(p.color, ('?',))[0]})" for p in pieces]
        return "\n".join(lines)
