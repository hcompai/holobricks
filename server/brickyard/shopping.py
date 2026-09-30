"""Immutable, catalog-validated BrickLink XML handoffs for HoloTab."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from xml.etree import ElementTree as ET

from brickyard import catalog
from brickyard.model import Build

ValidationError = catalog.ValidationError  # preserve the public shopping exception

# BrickLink documents this limit for Wanted List file uploads.
# https://www.bricklink.com/help.asp?helpID=207
MAX_IMPORT_BYTES = 204800


def package(build: Build) -> dict:
    """The complete verified inventory and its BrickLink XML, content-addressed; never just the valid subset."""
    if not build.pieces:
        raise ValueError("Build something before shopping for its bricks.")
    report = catalog.require(build.pieces)
    inventory = report["inventory"]
    if unlinked := sorted(
        {line["part"] for line in inventory if None in (line["bricklink_part"], line["bricklink_color"])}
    ):
        raise ValueError(f"No BrickLink identifier for {', '.join(unlinked)}, so no complete BrickLink list exists.")
    counts: Counter[tuple[str, int]] = Counter()
    for line in inventory:
        counts[line["bricklink_part"], line["bricklink_color"]] += line["count"]
    root = ET.Element("INVENTORY")
    for (part, color), count in sorted(counts.items()):
        item = ET.SubElement(root, "ITEM")
        for key, value in {"ITEMTYPE": "P", "ITEMID": part, "COLOR": color, "MINQTY": count, "CONDITION": "N"}.items():
            ET.SubElement(item, key).text = str(value)
    ET.indent(root)
    xml = ET.tostring(root, encoding="unicode") + "\n"
    if len(xml.encode()) > MAX_IMPORT_BYTES:
        raise ValueError("This build exceeds BrickLink’s single-file import limit. Try a smaller build.")
    result = {
        "version": 3,
        "validation": catalog.validity(report),
        "name": build.name,
        "revision": build.revision,
        "pieces": len(build.pieces),
        "lots": len(counts),
        "inventory": inventory,
    }
    result["id"] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    return result | {"xml": xml}
