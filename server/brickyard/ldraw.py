"""LDraw parts library: file lookup, part metadata measured from geometry, and packing a part into one MPD file."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import cache, cached_property
from pathlib import Path

LDRAW = Path(os.environ.get("BRICKYARD_LDRAW", Path(__file__).resolve().parents[2] / "ldraw"))
STUD = 20
PLATE = 8

Point = tuple[float, float, float]
DIMS = re.compile(r"(?<![\d.])(\d+) x (\d+)(?![\d.])")


def normalize(name: str) -> str:
    return name.strip().replace("\\", "/").lower()


@cache
def _index() -> dict[str, Path]:
    """Reference name -> file, `parts/` winning over `p/`; cached on disk because scanning 37k files is slow."""
    cached = LDRAW / "brickyard-index.json"
    if cached.exists():
        return {name: LDRAW / rel for name, rel in json.loads(cached.read_text()).items()}
    index: dict[str, str] = {}
    for sub in ("parts", "p"):
        root = LDRAW / sub
        for path in root.rglob("*.dat"):
            index.setdefault(path.relative_to(root).as_posix().lower(), path.relative_to(LDRAW).as_posix())
    cached.write_text(json.dumps(index))
    return {name: LDRAW / rel for name, rel in index.items()}


def exists(name: str) -> bool:
    return normalize(name) in _index()


def resolve(name: str) -> str | None:
    """The library name for a part id like `3001`, `3001.dat` or `parts/3001.DAT`, if it exists."""
    part = normalize(name).removeprefix("parts/")
    part = part if part.endswith(".dat") else f"{part}.dat"
    return part if part in _index() and "/" not in part else None


@cache
def catalog() -> dict[str, str]:
    """Part -> title for every buildable part: top-level `parts/`, without moved, alias or obsolete entries."""
    cached = LDRAW / "brickyard-catalog.json"
    if cached.exists():
        return json.loads(cached.read_text())
    titles = {}
    for path in sorted((LDRAW / "parts").glob("*.dat")):
        with path.open(encoding="utf-8", errors="replace") as f:
            title = f.readline().removeprefix("0").strip()
        if title and title[0] not in "~=_|" and "obsolete" not in title.lower():
            titles[path.name.lower()] = " ".join(title.split())
    cached.write_text(json.dumps(titles))
    return titles


def search(query: str, limit: int = 20) -> list[str]:
    """Parts whose title contains every word of `query`, shortest (most generic) titles first."""

    def tokens(text: str) -> list[str]:
        return re.sub(r"(\d)\s*x\s*(\d)", r"\1 x \2", text.lower()).split()

    words = tokens(query)
    hits = [p for p, t in catalog().items() if all(any(tok.startswith(w) for tok in tokens(t)) for w in words)]
    return sorted(hits, key=lambda p: (len(catalog()[p]), p))[:limit]


@cache
def read(name: str) -> tuple[str, ...]:
    path = _index().get(normalize(name))
    if path is None:
        raise KeyError(f"unknown LDraw file {name!r}")
    return tuple(path.read_text(encoding="utf-8", errors="replace").splitlines())


def _references(name: str) -> list[tuple[list[float], str]]:
    refs = []
    for line in read(name):
        fields = line.split()
        if len(fields) >= 15 and fields[0] == "1":
            refs.append(([float(v) for v in fields[2:14]], normalize(" ".join(fields[14:]))))
    return refs


@cache
def _points(name: str) -> frozenset[Point]:
    points: set[Point] = set()
    for line in read(name):
        fields = line.split()
        if fields and fields[0] in ("3", "4"):
            values = [float(v) for v in fields[2 : 2 + 3 * int(fields[0])]]
            points.update((values[i], values[i + 1], values[i + 2]) for i in range(0, len(values), 3))
    for (x, y, z, a, b, c, d, e, f, g, h, i), child in _references(name):
        if child in _index():
            points.update(
                (
                    round(a * px + b * py + c * pz + x, 3),
                    round(d * px + e * py + f * pz + y, 3),
                    round(g * px + h * py + i * pz + z, 3),
                )
                for px, py, pz in _points(child)
            )
    return frozenset(points)


@dataclass(frozen=True)
class PartInfo:
    part: str
    title: str
    lo: Point
    hi: Point

    @cached_property
    def exact(self) -> bool:
        """Whether the geometry spans whole studs, so nothing sticks out past the body."""
        return all(abs(e - round(e)) < 0.05 for e in self._extent)

    @property
    def _extent(self) -> tuple[float, float]:
        return (self.hi[0] - self.lo[0]) / STUD, (self.hi[2] - self.lo[2]) / STUD

    @cached_property
    def footprint(self) -> tuple[int, int]:
        """Studs along x and z at rotation 0; clips, pins or leaves sticking out past the body are not counted."""
        ex, ez = self._extent
        match = None if self.exact else DIMS.search(self.title)
        if match:
            small, large = sorted(int(v) for v in match.groups())
            w, d = (large, small) if ex >= ez else (small, large)
            if w <= ex + 0.5 and d <= ez + 0.5:
                return w, d
        return max(1, round(ex)), max(1, round(ez))

    @cached_property
    def center(self) -> tuple[float, float]:
        """Footprint center along x and z: the origin when the body sits around it, else the geometry's center."""
        w, d = self.footprint
        spans = ((self.lo[0], self.hi[0], w), (self.lo[2], self.hi[2], d))
        if not self.exact and all(lo <= 0.5 - n * STUD / 2 and hi >= n * STUD / 2 - 0.5 for lo, hi, n in spans):
            return 0.0, 0.0
        return (self.lo[0] + self.hi[0]) / 2, (self.lo[2] + self.hi[2]) / 2

    @property
    def plates(self) -> int:
        """Body height in plates, at least one; studs on top (4 LDU) are not counted."""
        return max(1, int((self.hi[1] - self.lo[1]) // PLATE))


@cache
def info(part: str) -> PartInfo:
    part = normalize(part)
    header = read(part)[0] if read(part) else ""
    title = " ".join(header.split()[1:]) if header.startswith("0") else part
    points = _points(part)
    if not points:
        raise ValueError(f"{part} has no geometry")
    lo = tuple(min(p[k] for p in points) for k in range(3))
    hi = tuple(max(p[k] for p in points) for k in range(3))
    return PartInfo(part, title, lo, hi)  # type: ignore[arg-type]


@cache
def colors() -> dict[int, tuple[str, str]]:
    """LDraw color code -> (name, hex) from LDConfig.ldr."""
    out = {}
    for line in (LDRAW / "LDConfig.ldr").read_text(encoding="utf-8", errors="replace").splitlines():
        fields = line.split()
        if len(fields) >= 7 and fields[1] == "!COLOUR" and "CODE" in fields and "VALUE" in fields:
            code = int(fields[fields.index("CODE") + 1])
            out[code] = (fields[2].replace("_", " "), fields[fields.index("VALUE") + 1])
    return out


def pack(part: str) -> str:
    """One MPD holding `part` and every file it references; line 2 places it in main color 16 for the viewer to swap."""
    order: list[str] = []

    def visit(name: str) -> None:
        if name in order or name not in _index():
            return
        order.append(name)
        for _, child in _references(name):
            visit(child)

    root = normalize(part)
    visit(root)
    lines = ["0 FILE brickyard.ldr", f"1 16 0 0 0 1 0 0 0 1 0 0 0 1 {root}", ""]
    for name in order:
        lines += [f"0 FILE {_embedded_name(name)}", *read(name), ""]
    return "\n".join(lines)


def _embedded_name(name: str) -> str:
    """three.js LDrawLoader looks up `s/` references as `parts/s/` and `48/` as `p/48/`."""
    if name.startswith("s/"):
        return f"parts/{name}"
    if name.startswith("48/"):
        return f"p/{name}"
    return name
