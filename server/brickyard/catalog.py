"""Fail-closed BrickLink part/color validation, shared by construction and purchasing.

The public catalog is the authority, not a model's guess or an LDraw filename.
Public page reads need no user credentials. An incompatible page, unavailable source,
ambiguous mapping, or expired offline cache cannot authorize an order.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import threading
import time
import uuid
from collections import Counter
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

import httpx

from brickyard import ldraw

ITEM = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}")
CATALOG_URL = "https://www.bricklink.com/v2/catalog/catalogitem.page"
CACHE_TTL = 24 * 60 * 60
MAX_PAGE_BYTES = 2_000_000
VALIDATION_BUDGET = 60
_fetch_lock = threading.Lock()
_last_fetch = 0.0


class CatalogUnavailable(ValueError):
    pass


class UnmappedPart(ValueError):
    pass


class ValidationError(ValueError):
    def __init__(self, report: dict):
        self.report = report
        super().__init__("Some bricks could not be verified in their chosen colors. Repair the model before shopping.")


def color_key(name: str) -> str:
    """Only spelling/separators: never nearest RGB, numeric equality, or fuzzy matching.

    LDraw deliberately uses BrickLink color names: https://www.ldraw.org/article/547.html
    """
    return re.sub(r"[\s_-]+", " ", name.lower().replace("grey", "gray")).strip()


class _Colors(HTMLParser):
    def __init__(self):
        super().__init__()
        self.known: dict[int, str] = {}
        self.section = False
        self.depth = 0
        self.complete = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div" and self.depth:
            self.depth += 1
        if attrs.get("id") == "_idColorListKnown":
            if self.section or tag != "div":
                raise CatalogUnavailable("BrickLink returned ambiguous known-color sections.")
            self.section = True
            self.depth = 1
        if (
            not self.depth
            or "pciSelectColorColorItem" not in attrs.get("class", "").split()
            or attrs.get("data-tab") != "Known"
        ):
            return
        try:
            code, name = int(attrs["data-color"]), attrs["data-name"].strip()
        except (KeyError, ValueError) as exc:
            raise CatalogUnavailable("BrickLink's known-color data could not be read.") from exc
        if code < 0 or not name or (code in self.known and self.known[code] != name):
            raise CatalogUnavailable("BrickLink returned inconsistent known-color data.")
        self.known[code] = name

    def handle_endtag(self, tag):
        if tag == "div" and self.depth:
            self.depth -= 1
            if not self.depth:
                self.complete = True


@dataclass(frozen=True)
class Part:
    item: str
    colors: dict[int, str]
    source: str
    fetched_at: float
    sha256: str

    def evidence(self) -> dict:
        return {"source": self.source, "fetched_at": self.fetched_at, "sha256": self.sha256}


def parse_page(document: str, requested: str, fetched_at: float) -> Part:
    """Parse only catalog identity and Known colors; seller listings/All colors prove nothing."""
    block = re.search(r"var\s+_var_item\s*=\s*\{(.*?)\};", document, re.DOTALL)
    if block is None or "</html>" not in document.lower():
        raise CatalogUnavailable("BrickLink's catalog format is unavailable or has changed.")
    fields = dict(re.findall(r"\b(type|itemno|itemStatus)\s*:\s*'([^']*)'", block[1]))
    item = fields.get("itemno", "")
    if fields.get("type") != "P" or fields.get("itemStatus") != "A" or not ITEM.fullmatch(item):
        raise UnmappedPart("The catalog entry is not an active BrickLink part.")
    if item.lower() != requested.lower():
        match = re.search(r"Alternate Item No:\s*<span[^>]*>([^<]*)</span>", document)
        aliases = {p.strip().lower() for p in html.unescape(match[1]).split(",")} if match else set()
        if requested.lower() not in aliases:
            raise UnmappedPart("BrickLink returned a different part without a documented alias.")
    parser = _Colors()
    parser.feed(document)
    if not parser.complete:
        raise CatalogUnavailable("BrickLink's known-color section is missing.")
    return Part(
        item, parser.known, f"{CATALOG_URL}?P={requested}", fetched_at, hashlib.sha256(document.encode()).hexdigest()
    )


def candidates(part: str) -> list[str]:
    """Explicit LDraw BrickLink metadata wins; otherwise verify the exact filename.

    No stripping of print/mold suffixes, title search or inferred substitute parts.
    Multiple documented candidates must resolve to the same catalog item.
    """
    hints = set()
    for line in ldraw.read(part):
        if line and not line.startswith("0"):
            break
        if line.startswith("0 !KEYWORDS"):
            hints.update(re.findall(r"\bBrickLink\s+([a-zA-Z0-9][a-zA-Z0-9._-]*)", line, re.IGNORECASE))
    return sorted(hints) or [part.removesuffix(".dat")]


class Catalog:
    def __init__(self, folder: Path | None = None):
        data = Path(os.environ.get("BRICKYARD_DATA", Path(__file__).resolve().parents[2] / "data"))
        self.folder = folder if folder is not None else data / "bricklink-catalog"

    def _cached(self, item: str) -> Part | None:
        try:
            saved = json.loads((self.folder / f"{item}.json").read_text())
            age = time.time() - saved["fetched_at"]
            if saved["schema"] != 1 or saved["requested"] != item or not 0 <= age < CACHE_TTL:
                return None
            record = parse_page(saved["html"], item, saved["fetched_at"])
            return record if record.sha256 == saved["sha256"] else None
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def get(self, item: str) -> Part:
        global _last_fetch
        if not ITEM.fullmatch(item):
            raise UnmappedPart("Unsafe or unsupported catalog identifier.")
        item = item.lower()
        if record := self._cached(item):
            return record
        # Collapse simultaneous cache misses and keep public requests below two per second.
        with _fetch_lock:
            if record := self._cached(item):
                return record
            time.sleep(max(0, 0.5 - (time.monotonic() - _last_fetch)))
            _last_fetch = time.monotonic()
            try:
                with (
                    httpx.Client(timeout=15, follow_redirects=False) as client,
                    client.stream("GET", CATALOG_URL, params={"P": item}) as response,
                ):
                    if response.status_code in (301, 302, 303, 307, 308, 404):
                        raise UnmappedPart("No directly verifiable BrickLink catalog entry for this reference.")
                    response.raise_for_status()
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        content.extend(chunk)
                        if len(content) > MAX_PAGE_BYTES:
                            raise CatalogUnavailable("BrickLink returned an unexpectedly large catalog page.")
                document = content.decode("utf-8")
                fetched = time.time()
                record = parse_page(document, item, fetched)
            except (httpx.HTTPError, UnicodeError) as exc:
                raise CatalogUnavailable(
                    "BrickLink could not be verified. Retry later; no unchecked list was exported."
                ) from exc
            self.folder.mkdir(parents=True, exist_ok=True)
            target = self.folder / f"{item}.json"
            tmp = self.folder / f"{uuid.uuid4().hex}.tmp"
            try:
                tmp.write_text(
                    json.dumps(
                        {
                            "schema": 1,
                            "requested": item,
                            "fetched_at": fetched,
                            "sha256": record.sha256,
                            "html": document,
                        }
                    )
                )
                tmp.replace(target)
            finally:
                tmp.unlink(missing_ok=True)
            return record

    def resolve(self, part: str) -> Part:
        records = [self.get(item) for item in candidates(part)]
        if len({r.item for r in records}) != 1:
            raise UnmappedPart("LDraw names multiple different BrickLink items; the mapping is ambiguous.")
        return records[0]


def available_colors(record: Part) -> list[dict]:
    known = Counter(color_key(name) for name in record.colors.values())
    return [
        {"color": code, "name": name}
        for code, (name, _) in sorted(ldraw.colors().items())
        if code not in (16, 24) and known[color_key(name)] == 1
    ]


def validate(pieces, folder: Path | None = None) -> dict:
    """One verdict per source part/color. Partial success never authorizes an export."""
    counts = Counter((p.part, p.color) for p in pieces)
    palette, library = ldraw.colors(), ldraw.catalog()
    provider = Catalog(folder)
    records, issues, inventory = {}, [], []
    unavailable = None
    deadline = time.monotonic() + VALIDATION_BUDGET
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
            if unavailable or time.monotonic() > deadline:
                raise CatalogUnavailable(
                    unavailable or "Catalog verification timed out; retry to continue from the cache."
                )
            if part not in records:
                records[part] = provider.resolve(part)
            record = records[part]
            matches = [
                (code, name) for code, name in record.colors.items() if color_key(name) == color_key(palette[color][0])
            ]
            if len(matches) != 1:
                issues.append(
                    base
                    | {
                        "code": "color_not_verified",
                        "reason": f"{palette[color][0]} is not uniquely recorded in BrickLink's Known colors for {record.item}.",
                        "available_colors": available_colors(record),
                        "evidence": record.evidence(),
                    }
                )
                continue
            bl_color, bl_name = matches[0]
            inventory.append(
                base
                | {
                    "part": part,
                    "title": library[part],
                    "color_name": palette[color][0],
                    "bricklink_part": record.item,
                    "bricklink_color": bl_color,
                    "bricklink_color_name": bl_name,
                    "evidence": record.evidence(),
                }
            )
        except UnmappedPart as exc:
            issues.append(base | {"code": "unmapped_part", "reason": str(exc)})
        except CatalogUnavailable as exc:
            unavailable = str(exc)
            issues.append(base | {"code": "catalog_unavailable", "reason": unavailable})
    if not counts:
        issues.append({"code": "empty", "reason": "There are no bricks to verify."})
    return {"valid": not issues, "pieces": sum(counts.values()), "inventory": inventory, "issues": issues}


def describe(report: dict) -> str:
    if report["valid"]:
        return f"All {report['pieces']} pieces have verified BrickLink part/color references (stock and physical assembly not certified)."
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


def require(pieces, folder: Path | None = None) -> dict:
    """The shared publication/export boundary. Never return a partial verified inventory."""
    report = validate(pieces, folder)
    if not report["valid"]:
        raise ValidationError(report)
    return report


def validity(report: dict) -> dict:
    return {
        "status": "verified",
        "policy": "bricklink-known-colors-v1",
        "valid_until": min(row["evidence"]["fetched_at"] for row in report["inventory"]) + CACHE_TTL,
    }
