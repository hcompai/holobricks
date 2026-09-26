"""A build: LDraw pieces grouped into steps, plus the chat that produced it."""

from __future__ import annotations

import time
import uuid
from collections import Counter
from typing import Literal

from pydantic import BaseModel, Field

from brickyard import ldraw

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


class Step(BaseModel):
    index: int
    title: str
    key: str | None = None
    """Digest of the script step that made it, empty if that step had problems; None when no script made it."""


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
    width: int = 32
    depth: int = 32
    created: float = Field(default_factory=time.time)
    status: Literal["idle", "building", "done", "error"] = "idle"
    pieces: list[Piece] = []
    steps: list[Step] = []
    messages: list[Message] = []
    script: str = ""

    def summary(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "builder": self.builder,
            "status": self.status,
            "created": self.created,
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

    def bom(self) -> list[dict]:
        """Bill of materials: one line per part and color, most used first."""
        palette = ldraw.colors()
        counts = Counter((p.part, p.color) for p in self.pieces)
        return [
            {
                "part": part,
                "title": ldraw.info(part).title,
                "color": color,
                "colorName": palette.get(color, (str(color), "#888888"))[0],
                "hex": palette.get(color, (str(color), "#888888"))[1],
                "count": n,
            }
            for (part, color), n in counts.most_common()
        ]


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


ACCESSORIES = {"60592.dat": ("60601.dat", 47), "60593.dat": ("60602.dat", 47), "60594.dat": ("60603.dat", 47)}


def with_accessories(placement: Placement) -> list[Placement]:
    """The placement plus the inserts it is never used without, like window glass."""
    extra = ACCESSORIES.get(placement.part)
    return [placement, attach(placement, *extra)] if extra else [placement]


def baseplate(color: int) -> Placement:
    """A 32x32 baseplate whose top surface is plate height 0."""
    return place("3811.dat", 0, 0, 0, color).model_copy(update={"pos": (320.0, 0.0, 320.0)})


Vec = tuple[float, float, float]


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


def grid(p: Placement | Piece) -> tuple[int, int, int, int | None]:
    """(x, y, z, rotation) in the same stud and plate units `place` takes."""
    lo, hi = bounds(p)
    rotation = next((deg for deg, m in ROTATIONS.items() if m == tuple(p.rot)), None)
    return round(lo[0] / ldraw.STUD), round(lo[2] / ldraw.STUD), round(-hi[1] / ldraw.PLATE), rotation
