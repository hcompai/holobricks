"""Resolve supported stud connections from LDCad's versioned shadow data.

Only rigid round studs (radius 6 LDU, engagement 4 LDU) and matching sockets
are supported. Other snap families are retained as unsupported evidence, never
guessed from a part's bounding box. Geometry/insertion checks live in assembly.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from dataclasses import dataclass, replace
from pathlib import Path

from brickyard import ldraw
from brickyard.model import Piece

POLICY = "rigid-stud-socket-v1"
SHADOW_COMMIT = "9b1131fb1991f8c0bfc072325e4e12f6271aba35"
Vec = tuple[float, float, float]
Mat = tuple[float, ...]
OPTIONS = re.compile(r"\[([^=\]]+)=([^\]]*)\]")
EPS = 0.05


class ConnectorError(ValueError):
    pass


def vector(matrix: Mat, point: Vec) -> Vec:
    return tuple(sum(matrix[3 * k + j] * point[j] for j in range(3)) for k in range(3))


def add(a: Vec, b: Vec) -> Vec:
    return tuple(x + y for x, y in zip(a, b, strict=True))


def dot(a: Vec, b: Vec) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def unit(a: Vec) -> Vec:
    size = math.sqrt(dot(a, a))
    if size < 1e-8:
        raise ConnectorError("Zero-length connector axis")
    return tuple(x / size for x in a)


@dataclass(frozen=True)
class Port:
    gender: str
    pos: Vec
    axis: Vec
    depth: float
    identifier: str = ""
    group: str = ""
    scale: str = "none"

    def transform(self, pos: Vec, matrix: Mat) -> Port | None:
        lengths = [math.sqrt(sum(matrix[3 * row + col] ** 2 for row in range(3))) for col in range(3)]
        if any(abs(length - 1) > 1e-5 for length in lengths):
            # Non-rigid inherited data is not silently interpreted as another LEGO connector.
            return None
        axes = [tuple(matrix[3 * row + col] for row in range(3)) for col in range(3)]
        if any(abs(dot(axes[i], axes[j])) > 1e-5 for i in range(3) for j in range(i)):
            return None
        return replace(self, pos=add(pos, vector(matrix, self.pos)), axis=unit(vector(matrix, self.axis)))


@dataclass(frozen=True)
class Profile:
    ports: tuple[Port, ...]
    unsupported: tuple[str, ...]
    fingerprint: str


def numbers(value: str, count: int) -> tuple[float, ...]:
    out = tuple(float(v) for v in value.split())
    if len(out) != count or not all(math.isfinite(v) for v in out):
        raise ConnectorError("Invalid connector coordinates")
    return out


def grid(value: str) -> list[Vec]:
    if not value:
        return [(0, 0, 0)]
    words = value.split()
    counts, centered = [], []
    for _ in range(2):
        center = words[0].upper() == "C"
        if center:
            words.pop(0)
        counts.append(int(words.pop(0)))
        centered.append(center)
    dx, dz = numbers(" ".join(words), 2)
    nx, nz = counts
    if min(nx, nz) < 1 or nx * nz > 16384:
        raise ConnectorError("Connector grid is too large or empty")
    return [
        ((x - (nx - 1) / 2 if centered[0] else x) * dx, 0, (z - (nz - 1) / 2 if centered[1] else z) * dz)
        for x in range(nx)
        for z in range(nz)
    ]


class Library:
    """LDraw inheritance followed by shadow CLEAR/INCL/CYL metadata, in file order."""

    def __init__(self, folder: Path | None = None):
        self.folder = folder or Path(os.environ.get("BRICKYARD_SHADOW", Path(__file__).resolve().parents[2] / "shadow"))
        self._profiles: dict[tuple[str, bool], Profile] = {}

    def _shadow(self, name: str) -> str:
        if ".." in Path(name).parts or Path(name).is_absolute():
            raise ConnectorError("Invalid connector library reference")
        for sub in ("parts", "p"):
            path = self.folder / sub / name
            if path.is_file():
                return path.read_text(encoding="utf-8")
        return ""

    def profile(self, part: str, *, only_shadow: bool = False, ancestors: tuple[str, ...] = ()) -> Profile:
        if not (self.folder / "LICENSE.md").exists():
            raise ConnectorError("Connector library unavailable; run scripts/fetch-connectors.py")
        name = ldraw.normalize(part)
        if name in ancestors or len(ancestors) > 64:
            raise ConnectorError("Recursive connector library reference")
        if cached := self._profiles.get((name, only_shadow)):
            return cached
        ports, unsupported, evidence = [], [], []
        original = () if only_shadow else ldraw.read(name)
        evidence.append("\n".join(original))
        for line in original:
            fields = line.split()
            if len(fields) < 15 or fields[0] != "1":
                continue
            child = self.profile(fields[14], ancestors=(*ancestors, name))
            values = numbers(" ".join(fields[2:14]), 12)
            ports.extend(p for port in child.ports if (p := port.transform(values[:3], values[3:])) is not None)
            unsupported.extend(child.unsupported)
            evidence.append(child.fingerprint)
        shadow = self._shadow(name)
        evidence.append(shadow)
        for line in shadow.splitlines():
            fields = line.split(maxsplit=3)
            if len(fields) < 3 or fields[:2] != ["0", "!LDCAD"]:
                continue
            kind = fields[2]
            opts = {k.lower(): v for k, v in OPTIONS.findall(line)}
            if kind == "SNAP_CLEAR":
                identifier = opts.get("id")
                ports = [p for p in ports if identifier and p.identifier != identifier]
                continue
            if kind not in {"SNAP_CYL", "SNAP_INCL"}:
                if kind.startswith("SNAP_"):
                    unsupported.append(f"{name}: {kind}")
                continue
            pos = numbers(opts.get("pos", "0 0 0"), 3)
            ori = numbers(opts.get("ori", "1 0 0 0 1 0 0 0 1"), 9)
            if kind == "SNAP_INCL":
                if only_shadow:
                    # LDCad shadow includes are intentionally non-recursive.
                    # Following a nested include would manufacture extra ports.
                    unsupported.append(f"{name}: nested SNAP_INCL")
                    continue
                if "scale" in opts and numbers(opts["scale"], 3) != (1, 1, 1):
                    unsupported.append(f"{name}: scaled SNAP_INCL")
                    continue
                included = self.profile(opts["ref"], only_shadow=True, ancestors=(*ancestors, name))
                source = included.ports
                unsupported.extend(included.unsupported)
                evidence.append(included.fingerprint)
            else:
                sections = opts.get("secs", "").split()
                gender = opts.get("gender", "M").upper()
                supported = (
                    len(sections) >= 3
                    and len(sections) % 3 == 0
                    and (gender == "F" or len(sections) == 3)
                    # Standard one-stud undersides use square sockets (S 6),
                    # which accept the same round stud. Square male shafts do not.
                    and sections[0] in ({"R", "S"} if gender == "F" else {"R"})
                    and abs(float(sections[1]) - 6) < 1e-5
                    and opts.get("caps", "one") in ({"one", "B", "none"} if gender == "F" else {"one", "A"})
                    and opts.get("center", "false") == "false"
                    and opts.get("slide", "false") == "false"
                    and gender in {"M", "F"}
                )
                # A standard 4-LDU stud only enters the first socket section.
                # Deeper bore changes (e.g. a hollow round brick) are irrelevant
                # to this engagement, but must still describe finite geometry.
                if supported:
                    supported = all(
                        sections[i] in {"R", "S"}
                        and all(math.isfinite(float(v)) and float(v) > 0 for v in sections[i + 1 : i + 3])
                        for i in range(0, len(sections), 3)
                    )
                depth = float(sections[2]) if len(sections) >= 3 else 0
                supported = supported and (abs(depth - 4) < 1e-5 if gender == "M" else depth >= 4)
                if not supported:
                    unsupported.append(f"{name}: unsupported cylinder")
                    continue
                source = (Port(gender, (0, 0, 0), (0, -1, 0), depth, opts.get("id", ""), opts.get("group", "")),)
            for offset in grid(opts.get("grid", "")):
                location = add(pos, vector(ori, offset))
                for port in source:
                    changed = port.transform(location, ori)
                    if changed:
                        if kind == "SNAP_INCL" and "id" in opts:
                            changed = replace(changed, identifier=opts["id"])
                        ports.append(changed)
        unique = tuple(dict.fromkeys(ports))
        fingerprint = hashlib.sha256(json.dumps([POLICY, evidence], sort_keys=True).encode()).hexdigest()
        result = Profile(unique, tuple(sorted(set(unsupported))), fingerprint)
        self._profiles[name, only_shadow] = result
        return result

    def world(self, piece: Piece) -> Profile:
        profile = self.profile(piece.part)
        ports = tuple(p for port in profile.ports if (p := port.transform(piece.pos, piece.rot)) is not None)
        return Profile(ports, profile.unsupported, profile.fingerprint)


def compatible(a: Port, b: Port) -> bool:
    """Full standard stud engagement, not mere touching or partial insertion."""
    return (
        a.gender != b.gender
        and a.group == b.group
        and math.dist(a.pos, b.pos) <= EPS
        and dot(a.axis, b.axis) > 1 - 1e-5
    )
