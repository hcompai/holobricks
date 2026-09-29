"""Build the catalog snapshot: which colors each LDraw part comes in, with its Rebrickable and BrickLink ids.

Needs REBRICKABLE_API_KEY (free at rebrickable.com, Settings > API) for the cross-references; the set
inventories are public downloads. Every ambiguous mapping is left out, so the catalog fails closed.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import time
from pathlib import Path

import httpx

from brickyard import catalog, ldraw

API = "https://rebrickable.com/api/v3/lego"
DOWNLOADS = "https://cdn.rebrickable.com/media/downloads"
PAGE_SIZE = 1000


def _pages(client: httpx.Client, url: str) -> list[dict]:
    results: list[dict] = []
    while url:
        response = client.get(url)
        if response.status_code == 429:
            time.sleep(float(response.headers.get("Retry-After", 5)))
            continue
        response.raise_for_status()
        page = response.json()
        results += page["results"]
        url = page["next"]
        time.sleep(1)
    return results


def _one(values: list) -> object | None:
    return values[0] if len(set(values)) == 1 else None


def _unique(pairs: list[tuple]) -> dict:
    """Keys claimed by exactly one value; a key two sources claim is dropped."""
    claims: dict = {}
    for key, value in pairs:
        claims.setdefault(key, set()).add(json.dumps(value, sort_keys=True))
    return {key: json.loads(next(iter(values))) for key, values in claims.items() if len(values) == 1}


def colors(results: list[dict]) -> dict[int, dict]:
    pairs = []
    for color in results:
        ids = color.get("external_ids") or {}
        code = _one((ids.get("LDraw") or {}).get("ext_ids") or [])
        bricklink = ids.get("BrickLink") or {}
        link = _one(bricklink.get("ext_ids") or [])
        if code is None:
            continue
        name = bricklink["ext_descrs"][0][0] if link is not None and bricklink.get("ext_descrs") else None
        pairs.append((int(code), {"rebrickable": color["id"], "bricklink": link, "bricklink_name": name}))
    return _unique(pairs)


def parts(results: list[dict], library: set[str]) -> dict[str, dict]:
    pairs = []
    for part in results:
        ids = part.get("external_ids") or {}
        names = ids.get("LDraw") or [part["part_num"]]
        record = {"rebrickable": part["part_num"], "bricklink": _one(ids.get("BrickLink") or [])}
        pairs += [(f"{name.lower()}.dat", record) for name in names if f"{name.lower()}.dat" in library]
    return _unique(pairs)


def known_colors(client: httpx.Client) -> dict[str, set[int]]:
    """Rebrickable part -> Rebrickable colors it has in a set inventory or as a LEGO element."""
    combos: dict[str, set[int]] = {}
    for name in ("inventory_parts", "elements"):
        response = client.get(f"{DOWNLOADS}/{name}.csv.gz")
        response.raise_for_status()
        for row in csv.DictReader(io.StringIO(gzip.decompress(response.content).decode())):
            combos.setdefault(row["part_num"], set()).add(int(row["color_id"]))
    return combos


def build(key: str) -> dict:
    with httpx.Client(headers={"Authorization": f"key {key}"}, timeout=60, follow_redirects=True) as client:
        palette = colors(_pages(client, f"{API}/colors/?page_size={PAGE_SIZE}"))
        mapped = parts(_pages(client, f"{API}/parts/?page_size={PAGE_SIZE}&inc_part_details=1"), set(ldraw.catalog()))
        combos = known_colors(client)
    by_rebrickable = {color["rebrickable"]: code for code, color in palette.items()}
    for record in mapped.values():
        found = combos.get(record["rebrickable"], set())
        record["colors"] = sorted(by_rebrickable[c] for c in found if c in by_rebrickable)
    return {"schema": catalog.SCHEMA, "built_at": time.time(), "colors": palette, "parts": mapped}


def main() -> None:
    parser = argparse.ArgumentParser(prog="brickyard-catalog", description=__doc__)
    parser.add_argument("--out", type=Path, default=catalog.SNAPSHOT)
    args = parser.parse_args()
    key = os.environ.get("REBRICKABLE_API_KEY")
    if not key:
        raise SystemExit("Set REBRICKABLE_API_KEY (free at rebrickable.com, Settings > API).")
    snapshot = build(key)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(gzip.compress(json.dumps(snapshot, separators=(",", ":")).encode()))
    print(f"{len(snapshot['parts'])} parts and {len(snapshot['colors'])} colors in {args.out}")


if __name__ == "__main__":
    main()
