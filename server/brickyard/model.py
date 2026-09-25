"""A build: LDraw pieces grouped into steps, plus the chat that produced it."""

from __future__ import annotations

import time
import uuid
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


class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    text: str
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


class Placement(BaseModel):
    """A piece before it joins a build."""

    part: str
    color: int
    pos: tuple[float, float, float]
    rot: Matrix = IDENTITY


def place(part: str, x: int, y: int, z: int, color: int, rotation: int = 0) -> Placement:
    """Center `part` on the footprint starting at stud (x, y), bottom at plate z, turned `rotation` degrees."""
    info = ldraw.info(part)
    rot = ROTATIONS[rotation]
    corners = [(cx, cz) for cx in (info.lo[0], info.hi[0]) for cz in (info.lo[2], info.hi[2])]
    turned = [(rot[0] * cx + rot[2] * cz, rot[6] * cx + rot[8] * cz) for cx, cz in corners]
    lo_x, hi_x = min(c[0] for c in turned), max(c[0] for c in turned)
    lo_z, hi_z = min(c[1] for c in turned), max(c[1] for c in turned)
    width, depth = round((hi_x - lo_x) / ldraw.STUD), round((hi_z - lo_z) / ldraw.STUD)
    return Placement(
        part=info.part,
        color=color,
        pos=(
            (x + width / 2) * ldraw.STUD - (lo_x + hi_x) / 2,
            -z * ldraw.PLATE - info.hi[1],
            (y + depth / 2) * ldraw.STUD - (lo_z + hi_z) / 2,
        ),
        rot=rot,
    )


def attach(anchor: Placement, part: str, color: int) -> Placement:
    """A part designed to share its anchor's origin, like the glass of a window frame."""
    return Placement(part=ldraw.normalize(part), color=color, pos=anchor.pos, rot=anchor.rot)
