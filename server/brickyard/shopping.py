"""Immutable, catalog-validated BrickLink XML handoffs for HoloTab."""

from __future__ import annotations

import hashlib
import html
import json
import re
import uuid
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

from brickyard import catalog
from brickyard.model import Build

# BrickLink documents this limit for Wanted List file uploads.
# https://www.bricklink.com/help.asp?helpID=207
MAX_IMPORT_BYTES = 204800
PACKAGE_FILE = re.compile(r"[a-f0-9]{64}\.(?:json|html|xml)")


class ValidationError(ValueError):
    def __init__(self, report: dict):
        self.report = report
        super().__init__(
            "Some bricks could not be verified in their chosen colors. Correct the parts list before shopping."
        )


def prepare(build: Build, catalog_folder: Path | None = None) -> tuple[dict, str]:
    """Verify the complete BOM before writing anything; never export just the valid subset."""
    if build.status != "done" or not build.pieces:
        raise ValueError("Finish your build before shopping for its bricks.")
    report = catalog.validate(build.pieces, catalog_folder)
    if not report["valid"]:
        raise ValidationError(report)
    inventory = report["inventory"]
    counts: Counter[tuple[str, int]] = Counter()
    for line in inventory:
        counts[line["bricklink_part"], line["bricklink_color"]] += line["count"]
    root = ET.Element("INVENTORY")
    for (part, color), count in sorted(counts.items()):
        item = ET.SubElement(root, "ITEM")
        for key, value in {"ITEMTYPE": "P", "ITEMID": part, "COLOR": color, "MINQTY": count, "CONDITION": "N"}.items():
            ET.SubElement(item, key).text = str(value)
    ET.indent(root)
    contents = ET.tostring(root, encoding="unicode") + "\n"
    if len(contents.encode()) > MAX_IMPORT_BYTES:
        raise ValueError("This build exceeds BrickLink’s single-file import limit. Try a smaller build.")
    package = {
        "version": 3,
        "validation": {
            "status": "verified",
            "policy": "bricklink-known-colors-v1",
            "valid_until": min(line["evidence"]["fetched_at"] for line in inventory) + catalog.CACHE_TTL,
        },
        "build_id": build.id,
        "name": build.name,
        "revision": build.revision,
        "pieces": len(build.pieces),
        "lots": len(counts),
        "inventory": inventory,
    }
    package["id"] = hashlib.sha256(json.dumps(package, sort_keys=True).encode()).hexdigest()
    return package, contents


def save(build: Build, folder: Path, catalog_folder: Path | None = None) -> dict:
    """Persist a content-addressed package; retries return the same handoff."""
    package, contents = prepare(build, catalog_folder)
    folder.mkdir(parents=True, exist_ok=True)
    files = {"xml": contents, "html": order_page(package), "json": json.dumps(package)}
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
        f"<td>{html.escape(line['bricklink_part'])}</td>"
        f"<td>{line['bricklink_color']}</td></tr>"
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
<a class="download" href="{package["id"]}.xml" download="brickyard-{package["id"][:12]}-parts.xml">Download verified parts XML</a>
<h2>Prepare the carts</h2>
<ol><li>Download the parts file above.</li>
<li>Open <a href="https://www.bricklink.com/v2/wanted/upload.page" target="_blank" rel="noopener noreferrer">BrickLink’s Wanted List importer</a>.
Choose “Upload BrickLink XML format” and paste the exact contents of the downloaded XML file.</li>
<li>Use a separate Wanted List named <strong>Brickyard {package["id"][:12]}</strong>.
If it already exists, check its contents and resume it instead of uploading again.</li>
<li>Verify all quantities and colors. Resolve any importer errors before creating carts; do not omit or substitute items.</li>
<li>Use Buy All, Auto-select, then Create Carts. Review the full price including shipping before payment.</li></ol>
<p>Availability and prices are checked on BrickLink. Multiple stores may mean separate checkouts.
This is a parts list; printed building instructions are not included yet.</p>
<h2>Expected inventory</h2><div class="table"><table><thead><tr><th>Qty</th><th>Part</th><th>Color</th>
<th>Model part (LDraw)</th><th>BrickLink part</th><th>BrickLink color</th></tr></thead><tbody>{rows}</tbody></table></div>
<p>Every exported part and color pair was checked against BrickLink's Known colors.
The XML contains canonical BrickLink identifiers and exact quantities. Do not convert identifiers or substitute items.
Validation evidence and timestamps are in the <a href="{package["id"]}.json">saved inventory</a>.
Catalog validity does not guarantee stock, price, a specific mold within a catalog family, or physical assembly.</p>
<p>Saved model version: <code>{package["revision"]}</code></p></main></html>"""
