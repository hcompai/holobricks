"""Immutable parts handoffs for HoloTab and BrickLink's native LDraw importer."""

from __future__ import annotations

import hashlib
import html
import json
import re
import uuid
from collections import Counter
from pathlib import Path

from brickyard import ldraw
from brickyard.model import Build

# BrickLink documents this limit for Wanted List file uploads.
# https://www.bricklink.com/help.asp?helpID=207
MAX_IMPORT_BYTES = 204800
PACKAGE_FILE = re.compile(r"[a-f0-9]{64}\.(?:json|html|ldr)")

# Explicit catalog aliases only: removing suffixes generically would change real molds
# and printed parts. Both targets are also valid references in the official LDraw library.
# Verified 2026-09-27 against the parts' !KEYWORDS and BrickLink catalog entries:
# https://www.bricklink.com/v2/catalog/catalogitem.page?P=3069
# https://www.bricklink.com/v2/catalog/catalogitem.page?P=3941
BRICKLINK_IMPORT_ALIASES = {"3069b.dat": "3069.dat", "6143.dat": "3941.dat"}


def prepare(build: Build) -> tuple[dict, str]:
    """Capture every piece, independently of assembly steps; do not guess marketplace IDs."""
    if build.status != "done" or not build.pieces:
        raise ValueError("Finish your build before shopping for its bricks.")
    counts: Counter[tuple[str, int]] = Counter()
    palette = ldraw.colors()
    for piece in build.pieces:
        part = ldraw.resolve(piece.part)
        if not part or part not in ldraw.catalog():
            raise ValueError(f"The parts list contains an unrecognized part: {piece.part}.")
        if piece.color not in palette or piece.color in (16, 24):
            raise ValueError(f"Choose a real color for {part} before shopping.")
        counts[part, piece.color] += 1

    # Export every placed instance, even in legacy builds with missing step metadata.
    # Some BrickLink importer paths reject LDraw aliases rather than translating them.
    # Normalize only verified equivalents in this purchasing file, never in the model.
    lines = ["0 Brickyard parts inventory - for Wanted List import", "0 Author: Brickyard"]
    for piece in build.pieces:
        values = " ".join(f"{value:g}" for value in (*piece.pos, *piece.rot))
        source_part = ldraw.resolve(piece.part)
        import_part = BRICKLINK_IMPORT_ALIASES.get(source_part, source_part)
        lines.append(f"1 {piece.color} {values} {import_part}")
    inventory = []
    catalog = ldraw.catalog()
    for (part, color), count in sorted(counts.items()):
        inventory.append(
            {
                "part": part,
                "import_part": BRICKLINK_IMPORT_ALIASES.get(part, part),
                "color": color,
                "color_name": palette[color][0],
                "title": catalog[part],
                "count": count,
            }
        )
    contents = "\n".join(lines) + "\n"
    if len(contents.encode()) > MAX_IMPORT_BYTES:
        raise ValueError("This build exceeds BrickLink’s single-file import limit. Try a smaller build.")
    package = {
        "version": 2,
        "build_id": build.id,
        "name": build.name,
        "revision": build.revision,
        "pieces": len(build.pieces),
        "lots": len({(line["import_part"], line["color"]) for line in inventory}),
        "inventory": inventory,
    }
    package["id"] = hashlib.sha256(json.dumps(package, sort_keys=True).encode()).hexdigest()
    return package, contents


def save(build: Build, folder: Path) -> dict:
    """Persist a content-addressed package; retries return the same handoff."""
    package, contents = prepare(build)
    folder.mkdir(parents=True, exist_ok=True)
    files = {"ldr": contents, "html": order_page(package), "json": json.dumps(package)}
    for suffix, content in files.items():
        path = folder / f"{package['id']}.{suffix}"
        if not path.exists():
            tmp = folder / f"{uuid.uuid4().hex}.tmp"
            try:
                tmp.write_text(content, encoding="utf-8")
                tmp.replace(path)
            finally:
                tmp.unlink(missing_ok=True)
    return package


def order_page(package: dict) -> str:
    """A self-contained handoff page that also works in the static gallery."""
    name = html.escape(package["name"])
    rows = "".join(
        f"<tr><td>{line['count']}</td><td>{html.escape(line['title'])}</td>"
        f"<td>{html.escape(line['color_name'])}</td><td>{html.escape(line['part'])}</td>"
        f"<td>{html.escape(line['import_part'].removesuffix('.dat'))}</td>"
        f"<td>{line['color']}</td></tr>"
        for line in package["inventory"]
    )
    return f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bricks for {name} · Brickyard</title>
<style>
body{{font:16px/1.6 system-ui,sans-serif;background:#f9f9fb;color:#1c1c26;margin:0}}
main{{max-width:820px;margin:auto;padding:40px 24px}}h1{{line-height:1.2}}p{{color:#4a4a58}}
a{{color:#a64400}}.download{{display:inline-block;padding:12px 18px;background:#1c1c26;color:white;
text-decoration:none;border-radius:10px}}.table{{overflow:auto}}table{{width:100%;border-collapse:collapse;font-size:14px}}
th,td{{padding:10px;text-align:left;border-bottom:1px solid #ddd}}code{{overflow-wrap:anywhere;font-size:12px}}
</style>
<main><a href="/">Brickyard</a><h1>Bricks for {name}</h1>
<p>{package["pieces"]:,} pieces · {package["lots"]:,} part and color combinations</p>
<a class="download" href="{package["id"]}.ldr" download="brickyard-{package["id"][:12]}-parts.ldr">Download parts file</a>
<h2>Prepare the carts</h2>
<ol><li>Download the parts file above.</li>
<li>Open <a href="https://www.bricklink.com/v2/wanted/upload.page" target="_blank" rel="noopener noreferrer">BrickLink’s Wanted List importer</a>.
Choose “Upload a file from your computer” and upload the downloaded .ldr file.</li>
<li>Use a separate Wanted List named <strong>Brickyard {package["id"][:12]}</strong>.
If it already exists, check its contents and resume it instead of uploading again.</li>
<li>Verify all quantities and colors. Resolve any importer errors before creating carts; do not omit or substitute items.</li>
<li>Use Buy All, Auto-select, then Create Carts. Review the full price including shipping before payment.</li></ol>
<p>Availability and prices are checked on BrickLink. Multiple stores may mean separate checkouts.
This is a parts list; printed building instructions are not included yet.</p>
<h2>Expected inventory</h2><div class="table"><table><thead><tr><th>Qty</th><th>Part</th><th>Color</th>
<th>Model part (LDraw)</th><th>Import part</th><th>LDraw color</th></tr></thead><tbody>{rows}</tbody></table></div>
<p>The parts file already normalizes verified catalog aliases: LDraw 3069b → BrickLink 3069,
and LDraw 6143 → BrickLink 3941. Keep the exact colors and quantities; only the purchasing references change,
and the source model is unchanged. Other references still pass through the native importer for verification.</p>
<p>Color numbers above are LDraw identifiers, not BrickLink XML color IDs. Use the file importer’s color mapping.</p>
<p>Saved model version: <code>{package["revision"]}</code></p></main></html>"""
