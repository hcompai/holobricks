"""The stateful model an agent edits: validated brick edits, part search, and renders from the open viewer."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import httpx
from pydantic import BaseModel, ValidationError

from brickyard import ldraw, reference
from brickyard.model import ROTATIONS, Piece, Placement, bounds, grid, place, with_accessories
from brickyard.session import Session

STUD_HEIGHT = 4
EPS = 0.5
CELL = 4 * ldraw.STUD
DESCRIBE_LIMIT = 300
LIST_LIMIT = 600

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
    images: list[tuple[bytes, str]] = field(default_factory=list)
    """(data, mime) pairs the agent should see."""
    kind: str | None = None
    """What the images are, like `render`; an agent keeps only the latest images of each kind in context."""
    caption: str = ""


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
        self._boxes: dict[int, tuple] = {}

    @property
    def pieces(self) -> list[Piece]:
        return self.session.build.pieces

    def _box(self, p: Piece) -> tuple:
        if p.id not in self._boxes:
            self._boxes[p.id] = bounds(p)
        return self._boxes[p.id]

    def _check(
        self, bricks: list[Brick], mounted: list[Placement] = ()
    ) -> tuple[list[Placement], list[str], list[str]]:
        """Placements that fit, plus rejection and warning lines, for a batch checked against itself and the build.

        Mounted placements hang on a wall, so they only have to stay in bounds and clear of other pieces.
        """
        width, depth = self.session.build.width * ldraw.STUD, self.session.build.depth * ldraw.STUD
        grid_index: dict[tuple[int, int], list[tuple[tuple, str]]] = {}

        def cells(box: tuple) -> list[tuple[int, int]]:
            xs = range(int(box[0][0] // CELL), int(box[1][0] // CELL) + 1)
            return [(cx, cz) for cx in xs for cz in range(int(box[0][2] // CELL), int(box[1][2] // CELL) + 1)]

        def take(box: tuple, what: str) -> None:
            for cell in cells(box):
                grid_index.setdefault(cell, []).append((box, what))

        def near(box: tuple) -> list[tuple[tuple, str]]:
            found = {id(entry): entry for cell in cells(box) for entry in grid_index.get(cell, [])}
            return list(found.values())

        for p in self.pieces:
            take(self._box(p), f"#{p.id} {_where(p)}")
        accepted: list[tuple[Placement, tuple]] = []
        rejected, warnings = [], []
        candidates: list[tuple[str, Placement, bool]] = []
        for n, brick in enumerate(bricks, 1):
            label = f"brick {n} ({brick.part} at x={brick.x} y={brick.y} z={brick.z})"
            part = ldraw.resolve(brick.part)
            if part is None:
                rejected.append(f"{label}: unknown part; use find_parts")
            elif brick.color not in ldraw.colors():
                rejected.append(f"{label}: unknown color {brick.color}")
            elif brick.rotation not in ROTATIONS:
                rejected.append(f"{label}: rotation must be 0, 90, 180 or 270")
            elif brick.z < 0:
                rejected.append(f"{label}: below the baseplate")
            else:
                placement = place(part, brick.x, brick.y, brick.z, brick.color, brick.rotation)
                candidates.append((label, placement, brick.z > 0))
        candidates += [(f"mounted {p.part.removesuffix('.dat')}", p, False) for p in mounted]
        for label, placement, needs_support in candidates:
            box = bounds(placement)
            if box[0][0] < -EPS or box[0][2] < -EPS or box[1][0] > width + EPS or box[1][2] > depth + EPS:
                rejected.append(f"{label}: outside the {self.session.build.width}x{self.session.build.depth} baseplate")
                continue
            neighbors = near(box)
            hit = next((what for other, what in neighbors if _collides(box, other)), None)
            if hit:
                rejected.append(f"{label}: overlaps {hit}")
                continue
            if needs_support and not any(_touches(box, other) for other, _ in neighbors):
                warnings.append(f"{label}: floating, nothing directly under or above it")
            accepted.append((placement, box))
            take(box, f"{label.split(' (')[0]} of this step")
        return [p for placement, _ in accepted for p in with_accessories(placement)], rejected, warnings

    async def add(self, title: str, bricks: list[dict], mounted: list[Placement] = ()) -> Result:
        try:
            parsed = [Brick.model_validate(b) for b in bricks]
        except ValidationError as e:
            return Result(f"Invalid bricks: {e.errors(include_url=False)}")
        if not parsed and not mounted:
            return Result("No bricks given.")
        placements, rejected, warnings = await asyncio.to_thread(self._check, parsed, list(mounted))
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
        await self.session.say(
            "Looked at the model", role="tool", images=[self.session.store.save_image(png, "image/png")]
        )
        caption = "The render from look: 3/4 front-right, 3/4 back-left, front, and top (back at the top)."
        return Result(summary, images=[(png, "image/png")], kind="render", caption=caption)

    async def find_reference(self, query: str) -> Result:
        try:
            photos = await reference.search(query)
        except (httpx.HTTPError, ValueError) as e:
            return Result(f"Reference search failed ({e}). Build from what you know.")
        if not photos:
            return Result(f"No photos for '{query}'. Try a more common name, or build from what you know.")
        urls = [self.session.store.save_image(p.data, p.mime) for p in photos]
        await self.session.say(f"Reference photos for '{query}'", role="tool", images=urls)
        titles = "; ".join(f"{i}) {p.title}" for i, p in enumerate(photos, 1))
        return Result(
            f"Found {len(photos)} photos from Wikipedia: {titles}. They follow as images.",
            images=[(p.data, p.mime) for p in photos],
            kind="reference",
            caption=f"Reference photos for '{query}', in order: {titles}.",
        )

    async def find_parts(self, query: str) -> Result:
        hits = await asyncio.to_thread(lambda: [part_line(p) for p in ldraw.search(query)])
        text = "\n".join(hits) if hits else f"No parts match '{query}'. Try fewer or simpler words."
        return Result(text, note=f"Searched parts for '{query}'")

    async def list_pieces(self) -> Result:
        palette = ldraw.colors()
        shown = self.pieces[-LIST_LIMIT:]
        lines = [f"#{p.id} {_where(p)} color={p.color} ({palette.get(p.color, ('?',))[0]})" for p in shown]
        if len(shown) < len(self.pieces):
            lines.insert(0, f"The latest {len(shown)} of {len(self.pieces)} pieces:")
        return Result("\n".join(lines) or "No pieces yet.")

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
        brief = len(self.pieces) > DESCRIBE_LIMIT
        lines = (
            [f"{len(self.pieces)} pieces; per step: ids and extents. Use list_pieces for every piece."] if brief else []
        )
        for step in self.session.build.steps:
            pieces = [p for p in self.pieces if p.step == step.index]
            if not pieces:
                continue
            if brief:
                spots = [grid(p) for p in pieces]
                x, y, z = (f"{min(s[k] for s in spots)}-{max(s[k] for s in spots)}" for k in range(3))
                lines.append(f"Step {step.index} {step.title}: #{pieces[0].id}-#{pieces[-1].id}, x {x}, y {y}, z {z}")
                continue
            lines.append(f"Step {step.index} {step.title}:")
            lines += [f"  #{p.id} {_where(p)} color={p.color} ({palette.get(p.color, ('?',))[0]})" for p in pieces]
        return "\n".join(lines)
