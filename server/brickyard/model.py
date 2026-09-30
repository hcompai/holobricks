"""A build: LDraw pieces grouped into steps, plus the chat that produced it."""

from __future__ import annotations

import hashlib
import json
import math
import time
import uuid
from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel, Field, computed_field

from brickyard import catalog, ldraw

Matrix = tuple[float, float, float, float, float, float, float, float, float]
IDENTITY: Matrix = (1, 0, 0, 0, 1, 0, 0, 0, 1)
ROTATIONS: dict[int, Matrix] = {
    0: IDENTITY,
    90: (0, 0, 1, 0, 1, 0, -1, 0, 0),
    180: (-1, 0, 0, 0, 1, 0, 0, 0, -1),
    270: (0, 0, -1, 0, 1, 0, 1, 0, 0),
}
YAWS = set(ROTATIONS.values())


class Piece(BaseModel):
    """One part in LDraw space: y points down, 20 LDU per stud, 8 LDU per plate."""

    id: int
    part: str
    color: int
    pos: tuple[float, float, float]
    rot: Matrix = IDENTITY
    step: int


class Brick(BaseModel):
    part: str
    x: int = 0
    y: int = 0
    z: int = 0
    color: int
    rotation: int = 0
    facing: str | None = None
    """Set for a part mounted on a wall, its top turned to face that side."""
    pos: tuple[float, float, float] | None = None
    """Set for an exact LDraw placement in LDU, turned by `rot`; x, y, z, rotation and facing then go unused."""
    rot: Matrix = IDENTITY
    label: str | None = None
    """How problems name the brick, like the script line that made it."""


class Step(BaseModel):
    index: int
    title: str
    key: str | None = None
    """Digest of the script step that made it, empty if that step had problems or floating bricks; None when no script made it."""


class Message(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    text: str
    images: list[str] = []
    at: float = Field(default_factory=time.time)


class Build(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    name: str = "Untitled build"
    prompt: str = ""
    builder: str = "demo"
    width: int = 0
    depth: int = 0
    created: float = Field(default_factory=time.time)
    updated: float = 0
    """When the pieces last changed, in seconds; 0 when unknown."""
    status: Literal["idle", "building", "done", "error"] = "idle"
    pieces: list[Piece] = []
    steps: list[Step] = []
    messages: list[Message] = []
    script: str = ""
    recovery_script: str | None = None
    """The last script that produced this geometry; a later failed run must not replace it."""

    @computed_field
    @property
    def revision(self) -> str:
        """Fingerprint geometry, including same-count recolors and moves (shared with the renderer)."""
        rows = [
            [p.id, p.part, p.color, p.step, *[math.floor(v * 1_000_000 + 0.5) for v in (*p.pos, *p.rot)]]
            for p in self.pieces
        ]
        return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()

    def add_step(self, title: str, placements: list[Placement], key: str | None = None) -> Step:
        """Append a step in memory; the session decides when to persist and publish it."""
        step = Step(index=len(self.steps), title=title, key=key)
        next_id = max((p.id for p in self.pieces), default=0) + 1
        pieces = [Piece(id=next_id + i, step=step.index, **p.model_dump()) for i, p in enumerate(placements)]
        self.steps.append(step)
        self.pieces.extend(pieces)
        width, depth = footprint(pieces)
        self.width, self.depth = max(self.width, width), max(self.depth, depth)
        return step

    def summary(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "builder": self.builder,
            "status": self.status,
            "created": self.created,
            "updated": self.updated,
            "pieces": len(self.pieces),
            "steps": len(self.steps),
            "width": self.width,
            "depth": self.depth,
        }

    def to_ldraw(self) -> str:
        lines = [f"0 {self.name}", f"0 Name: {self.id}.ldr", "0 Author: Brickyard", ""]
        for step in self.steps:
            for p in (p for p in self.pieces if p.step == step.index):
                rot = " ".join(f"{v:g}" for v in p.rot)
                lines.append(f"1 {p.color} {p.pos[0]:g} {p.pos[1]:g} {p.pos[2]:g} {rot} {p.part}")
            lines.append(f"0 STEP {step.title}".rstrip())
        return "\n".join(lines) + "\n"

    def bom(self) -> dict:
        """Only a complete verified BOM may be presented, including for legacy/imported builds."""
        report = catalog.require(self.pieces)
        palette = ldraw.colors()
        lines = [
            {
                "part": row["part"],
                "title": row["title"],
                "color": row["color"],
                "colorName": row["color_name"],
                "hex": palette[row["color"]][1],
                "count": row["count"],
                "bricklinkPart": row["bricklink_part"],
                "bricklinkColor": row["bricklink_color"],
            }
            for row in sorted(report["inventory"], key=lambda row: -row["count"])
        ]
        return {
            "revision": self.revision,
            "pieces": len(self.pieces),
            "validation": catalog.validity(report),
            "lines": lines,
        }


class Placement(BaseModel):
    """A piece before it joins a build."""

    part: str
    color: int
    pos: tuple[float, float, float]
    rot: Matrix = IDENTITY


class Camera(BaseModel):
    """One view of the model, instead of the four standard ones."""

    angle: float = 40
    """The compass direction it is seen from, in degrees: 0 the front, 90 the right, 180 the back, 270 the left."""
    elevation: float = Field(30, ge=0, le=90)
    """Degrees above the horizon: 0 at eye level, 90 straight down."""
    zoom: float = Field(1, ge=1, le=16)
    """1 frames the whole model; 4 shows a quarter of its width."""
    at: tuple[float, float, float] | None = None
    """The point (x, y in studs, z in plates) at the center of the view; the model's center when unset."""


class Box(BaseModel):
    """Studs x0 to x1 and y0 to y1, plates z0 to z1, all included."""

    x0: int
    y0: int
    z0: int
    x1: int
    y1: int
    z1: int

    @classmethod
    def of(cls, values: list[int]) -> Box:
        if len(values) != 6:
            raise ValueError("a box is six numbers: x0 y0 z0 x1 y1 z1")
        x0, y0, z0, x1, y1, z1 = values
        return cls(x0=min(x0, x1), y0=min(y0, y1), z0=min(z0, z1), x1=max(x0, x1), y1=max(y0, y1), z1=max(z0, z1))

    def holds(self, p: Placement | Piece) -> bool:
        """Whether any of the piece lies inside the box."""
        lo, hi = bounds(p)
        near = (
            (self.x0 * ldraw.STUD, (self.x1 + 1) * ldraw.STUD),
            (-(self.z1 + 1) * ldraw.PLATE, -self.z0 * ldraw.PLATE),
            (self.y0 * ldraw.STUD, (self.y1 + 1) * ldraw.STUD),
        )
        return all(lo[k] < b - 0.5 and hi[k] > a + 0.5 for k, (a, b) in enumerate(near))

    def __str__(self) -> str:
        return f"x {self.x0}-{self.x1}, y {self.y0}-{self.y1}, z {self.z0}-{self.z1}"


def place(part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> Placement:
    """Center `part` on the footprint starting at stud (x, y), bottom at plate z, turned `rotation` degrees."""
    info = ldraw.info(part)
    rot = ROTATIONS[rotation]
    (width, depth), (cx, cz) = _footprint(info, rot)
    return Placement(
        part=info.part,
        color=color,
        pos=((x + width / 2) * ldraw.STUD - cx, -z * ldraw.PLATE - info.hi[1], (y + depth / 2) * ldraw.STUD - cz),
        rot=rot,
    )


def _footprint(info: ldraw.PartInfo, rot: Matrix) -> tuple[tuple[int, int], tuple[float, float]]:
    """Footprint size in studs and center in LDU along world x and z, for a part turned by the yaw `rot`."""
    w, d = info.footprint
    cx, cz = info.center
    turned = (w, d) if rot[0] else (d, w)
    return turned, (rot[0] * cx + rot[2] * cz, rot[6] * cx + rot[8] * cz)


FACINGS: dict[str, Matrix] = {
    "south": (1, 0, 0, 0, 0, -1, 0, 1, 0),
    "north": (1, 0, 0, 0, 0, 1, 0, -1, 0),
    "west": (0, 1, 0, -1, 0, 0, 0, 0, 1),
    "east": (0, -1, 0, 1, 0, 0, 0, 0, 1),
}


def mount(part: str, x: int, y: int, z: int, color: int, facing: str) -> Placement:
    """`part` with its top turned to face `facing`, backed against the wall behind stud (x, y), bottom at plate z."""
    info = ldraw.info(part)
    rot = FACINGS[facing]
    lo, hi = bounds(Placement(part=info.part, color=color, pos=(0, 0, 0), rot=rot))
    s = ldraw.STUD
    px = (x + 1) * s - hi[0] if facing == "west" else x * s - lo[0]
    pz = {"south": (y + 1) * s - hi[2], "north": y * s - lo[2]}.get(facing, y * s - lo[2])
    return Placement(part=info.part, color=color, pos=(px, -z * ldraw.PLATE - hi[1], pz), rot=rot)


def attach(anchor: Placement, part: str, color: int) -> Placement:
    """A part designed to share its anchor's origin, like the glass of a window frame."""
    return Placement(part=ldraw.normalize(part), color=color, pos=anchor.pos, rot=anchor.rot)


ACCESSORIES = {"60592.dat": ("60601.dat", 47), "60593.dat": ("60602.dat", 47), "60594.dat": ("86210.dat", 47)}


def with_accessories(placement: Placement) -> list[Placement]:
    """The placement plus the inserts it is never used without, like window glass."""
    extra = ACCESSORIES.get(placement.part)
    return [placement, attach(placement, *extra)] if extra else [placement]


def baseplate(color: int) -> Placement:
    """A 32x32 baseplate whose top surface is plate height 0."""
    return place("3811.dat", 0, 0, 0, color).model_copy(update={"pos": (320.0, 0.0, 320.0)})


Vec = tuple[float, float, float]


def footprint(pieces: Iterable[Placement | Piece]) -> tuple[int, int]:
    """Studs from x 0 and y 0 to the far sides of the pieces, (0, 0) for none."""
    far = [bounds(p)[1] for p in pieces]
    width = max((math.ceil((h[0] - 0.5) / ldraw.STUD) for h in far), default=0)
    depth = max((math.ceil((h[2] - 0.5) / ldraw.STUD) for h in far), default=0)
    return width, depth


def bounds(p: Placement | Piece) -> tuple[Vec, Vec]:
    """World-space box in LDU that the piece fills, studs included; for turned pieces, only within the footprint."""
    info = ldraw.info(p.part)
    r = p.rot
    corners = [
        (x, y, z) for x in (info.lo[0], info.hi[0]) for y in (info.lo[1], info.hi[1]) for z in (info.lo[2], info.hi[2])
    ]
    world = [
        (r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z)
        for x, y, z in corners
    ]
    lo = [min(c[k] for c in world) + p.pos[k] for k in range(3)]
    hi = [max(c[k] for c in world) + p.pos[k] for k in range(3)]
    if tuple(r) in YAWS:
        (w, d), (cx, cz) = _footprint(info, tuple(r))
        for k, center, half in ((0, cx + p.pos[0], w * ldraw.STUD / 2), (2, cz + p.pos[2], d * ldraw.STUD / 2)):
            lo[k], hi[k] = max(lo[k], center - half), min(hi[k], center + half)
    return tuple(lo), tuple(hi)  # type: ignore[return-value]


def top(box: tuple[Vec, Vec]) -> int:
    """Plate height of a box's top surface; studs, when there are any, add less than a plate."""
    return math.floor((-box[0][1] + 0.5) / ldraw.PLATE)


def extent(box: tuple[Vec, Vec]) -> tuple[int, int, int, int, int, int]:
    """(x, y, w, d, z, height) of a box on the stud and plate grid, at least one of each."""
    (x0, _, y0), (x1, bottom, y1) = box
    x, y, z = round(x0 / ldraw.STUD), round(y0 / ldraw.STUD), round(-bottom / ldraw.PLATE)
    return x, y, max(1, round(x1 / ldraw.STUD) - x), max(1, round(y1 / ldraw.STUD) - y), z, max(1, top(box) - z)


def grid(p: Placement | Piece) -> tuple[int, int, int, int | None]:
    """(x, y, z, rotation) in the same stud and plate units `place` takes."""
    lo, hi = bounds(p)
    rotation = next((deg for deg, m in ROTATIONS.items() if m == tuple(p.rot)), None)
    return round(lo[0] / ldraw.STUD), round(lo[2] / ldraw.STUD), round(-hi[1] / ldraw.PLATE), rotation
