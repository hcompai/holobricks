"""Fail-closed part/color validation from a Rebrickable snapshot, shared by construction and purchasing.

Rebrickable's set inventories say which colors a part comes in, and its cross-references map LDraw parts
and colors to Rebrickable and BrickLink. A part or color without one unambiguous mapping, or a missing or
expired snapshot, cannot authorize an order. `brickyard-catalog` builds the snapshot.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import time
from collections import Counter
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from brickyard import ldraw

SNAPSHOT = Path(
    os.environ.get("BRICKYARD_CATALOG", Path(__file__).resolve().parents[2] / "data" / "rebrickable.json.gz")
)
SNAPSHOT_TTL = 30 * 24 * 60 * 60
SCHEMA = 1


class CatalogUnavailable(ValueError):
    pass


class UnmappedPart(ValueError):
    pass


class ValidationError(ValueError):
    def __init__(self, report: dict):
        self.report = report
        super().__init__("Some bricks could not be verified in their chosen colors. Repair the model before shopping.")


@dataclass(frozen=True)
class Snapshot:
    built_at: float
    sha256: str
    colors: dict[int, dict]
    """LDraw code -> its Rebrickable and BrickLink ids and BrickLink name."""
    parts: dict[str, dict]
    """LDraw part -> its Rebrickable and BrickLink ids and the LDraw codes of its known colors."""

    def evidence(self) -> dict:
        return {"source": "rebrickable", "built_at": self.built_at, "sha256": self.sha256}


@cache
def _read(path: Path, version: tuple[int, int]) -> Snapshot:
    raw = path.read_bytes()
    data = json.loads(gzip.decompress(raw))
    if data.get("schema") != SCHEMA:
        raise CatalogUnavailable("The catalog snapshot has an unknown format; rebuild it with brickyard-catalog.")
    return Snapshot(
        data["built_at"],
        hashlib.sha256(raw).hexdigest(),
        {int(code): color for code, color in data["colors"].items()},
        data["parts"],
    )


def snapshot() -> Snapshot:
    try:
        stat = SNAPSHOT.stat()
        loaded = _read(SNAPSHOT, (stat.st_mtime_ns, stat.st_size))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CatalogUnavailable(
            f"No readable catalog snapshot at {SNAPSHOT}; build it with brickyard-catalog."
        ) from exc
    if not 0 <= time.time() - loaded.built_at < SNAPSHOT_TTL:
        raise CatalogUnavailable("The catalog snapshot has expired; rebuild it with brickyard-catalog.")
    return loaded


def entry(part: str) -> dict:
    """The snapshot's record of a resolved LDraw part; never a guess from a similar number."""
    record = snapshot().parts.get(part)
    if record is None:
        raise UnmappedPart("Rebrickable has no unambiguous entry for this LDraw part.")
    return record


def available_colors(record: dict) -> list[dict]:
    palette, colors = ldraw.colors(), snapshot().colors
    return [
        {"color": code, "name": palette[code][0]} for code in record["colors"] if code in palette and code in colors
    ]


def validate(pieces) -> dict:
    """One verdict per source part/color. Partial success never authorizes an export."""
    counts = Counter((p.part, p.color) for p in pieces)
    palette, library = ldraw.colors(), ldraw.catalog()
    issues, inventory = [], []
    for (source, color), count in sorted(counts.items()):
        base = {"part": source, "color": color, "color_name": palette.get(color, (str(color), ""))[0], "count": count}
        part = ldraw.resolve(source)
        if not part or part not in library:
            issues.append(base | {"code": "unknown_part", "reason": "Not a recognized complete LDraw part."})
            continue
        if color not in palette or color in (16, 24):
            issues.append(base | {"code": "unknown_color", "reason": "Choose an explicit recognized color."})
            continue
        try:
            known = snapshot()
            record = entry(part)
        except UnmappedPart as exc:
            issues.append(base | {"code": "unmapped_part", "reason": str(exc)})
            continue
        except CatalogUnavailable as exc:
            issues.append(base | {"code": "catalog_unavailable", "reason": str(exc)})
            continue
        if color not in record["colors"] or color not in known.colors:
            issues.append(
                base
                | {
                    "code": "color_not_verified",
                    "reason": f"{palette[color][0]} is not a known color of Rebrickable part {record['rebrickable']}.",
                    "available_colors": available_colors(record),
                    "evidence": known.evidence(),
                }
            )
            continue
        inventory.append(
            base
            | {
                "part": part,
                "title": library[part],
                "rebrickable_part": record["rebrickable"],
                "rebrickable_color": known.colors[color]["rebrickable"],
                "bricklink_part": record["bricklink"],
                "bricklink_color": known.colors[color]["bricklink"],
                "evidence": known.evidence(),
            }
        )
    if not counts:
        issues.append({"code": "empty", "reason": "There are no bricks to verify."})
    return {"valid": not issues, "pieces": sum(counts.values()), "inventory": inventory, "issues": issues}


def describe(report: dict) -> str:
    if report["valid"]:
        return f"All {report['pieces']} pieces exist in their colors in LEGO sets (stock and physical assembly not certified)."
    lines = ["Parts list is not ready to order. No unchecked or partial shopping file can be exported."]
    for issue in report["issues"]:
        lines.append(
            f"{issue.get('count', 0)} × {issue.get('part', '')}, LDraw color {issue.get('color', '')}: {issue['reason']}"
        )
        if colors := issue.get("available_colors"):
            lines.append(
                "Verified choices (LDraw codes; choose for visual fidelity): "
                + ", ".join(f"{c['color']} {c['name']}" for c in colors)
            )
    return "\n".join(lines)


def require(pieces) -> dict:
    """The shared publication/export boundary. Never return a partial verified inventory."""
    report = validate(pieces)
    if not report["valid"]:
        raise ValidationError(report)
    return report


def validity(report: dict) -> dict:
    return {
        "status": "verified",
        "policy": "rebrickable-known-colors-v1",
        "valid_until": min(row["evidence"]["built_at"] for row in report["inventory"]) + SNAPSHOT_TTL,
    }
