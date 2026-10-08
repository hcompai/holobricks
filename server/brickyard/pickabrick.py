"""Build the price table the web app estimates a model's cost with: LEGO Pick a Brick's price for each LDraw part and color.

Pick a Brick sells LEGO elements, one per mould and color. Rebrickable's element list says which elements each of
its parts and colors has, and the catalog snapshot maps LDraw parts and colors onto Rebrickable's. A part and color
with several elements on sale takes the cheapest in stock, else the cheapest. Pick a Brick has no public API: this
reads the endpoint its own page uses, which can change without notice.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import time
from pathlib import Path

import httpx

from brickyard import catalog
from brickyard.rebrickable import DOWNLOADS

ENDPOINT = "https://www.lego.com/api/graphql/PickABrickQuery"
PAGE_SIZE = 400  # the most the endpoint returns per page
QUERY = """query PickABrickQuery($input: ElementQueryInput!) {
  searchElements(input: $input) {
    results { ... on SearchResultElement { id availability price { centAmount currencyCode } } }
    total
  }
}"""
OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "pick-a-brick.json"


def fetch(locale: str) -> list[dict]:
    """Every element Pick a Brick lists for `locale`, in stock or not: id, price in cents, currency and stock."""
    elements: list[dict] = []
    headers = {"x-locale": locale, "user-agent": "Mozilla/5.0 (compatible; brickyard-prices)"}
    with httpx.Client(headers=headers, timeout=60) as client:
        page, received, total = 1, 0, None
        while total is None or received < total:
            variables = {
                "input": {
                    "page": page,
                    "perPage": PAGE_SIZE,
                    "availability": ["AVAILABLE", "OUT_OF_STOCK"],
                    "sort": {"key": "RELEVANCE", "direction": "DESC"},
                }
            }
            response = client.post(
                ENDPOINT, json={"operationName": "PickABrickQuery", "query": QUERY, "variables": variables}
            )
            response.raise_for_status()
            body = response.json()
            if body.get("errors"):
                raise RuntimeError(f"Pick a Brick refused the query: {body['errors']}")
            found = body["data"]["searchElements"]
            total = found["total"]
            if not found["results"]:
                break
            received += len(found["results"])
            elements += [
                {
                    "id": r["id"],
                    "cents": r["price"]["centAmount"],
                    "currency": r["price"]["currencyCode"],
                    "in_stock": r["availability"] == "AVAILABLE",
                }
                for r in found["results"]
                if r.get("price")
            ]
            page += 1
    return elements


def element_ids(client: httpx.Client) -> dict[tuple[str, int], set[str]]:
    """Rebrickable part and color -> the LEGO element ids made in them."""
    response = client.get(f"{DOWNLOADS}/elements.csv.gz")
    response.raise_for_status()
    ids: dict[tuple[str, int], set[str]] = {}
    for row in csv.DictReader(io.StringIO(gzip.decompress(response.content).decode())):
        ids.setdefault((row["part_num"], int(row["color_id"])), set()).add(row["element_id"])
    return ids


def table(
    snapshot: catalog.Snapshot, elements: dict[tuple[str, int], set[str]], offers: list[dict], locale: str
) -> dict:
    """Each LDraw "part:color" Pick a Brick sells, as the web app reads it: [cents, 1 if in stock else 0, element id].

    The element id is what Pick a Brick's list upload takes, one `elementId,quantity` row per element.
    """
    currencies = {o["currency"] for o in offers}
    if len(currencies) > 1:
        raise ValueError(f"Pick a Brick priced elements in several currencies: {sorted(currencies)}")
    by_element = {o["id"]: o for o in offers}
    ldraw_parts: dict[str, list[str]] = {}
    for part, record in snapshot.parts.items():
        ldraw_parts.setdefault(record["rebrickable"], []).append(part)
    ldraw_colors: dict[int, list[int]] = {}
    for code, color in snapshot.colors.items():
        ldraw_colors.setdefault(color["rebrickable"], []).append(code)
    prices: dict[str, list[int | str]] = {}
    for (part_num, color_id), ids in elements.items():
        sold = [by_element[i] for i in ids if i in by_element]
        if not sold:
            continue
        best = min(sold, key=lambda o: (not o["in_stock"], o["cents"]))
        for part in ldraw_parts.get(part_num, []):
            for code in ldraw_colors.get(color_id, []):
                prices[f"{part}:{code}"] = [best["cents"], int(best["in_stock"]), best["id"]]
    return {
        "source": "LEGO Pick a Brick",
        "locale": locale,
        "currency": currencies.pop() if currencies else None,
        "fetched_at": time.time(),
        "prices": dict(sorted(prices.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(prog="brickyard-prices", description=__doc__)
    parser.add_argument("--locale", default="fr-FR", help="the Pick a Brick store to price in, such as fr-FR or en-US")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    snapshot = catalog.snapshot()
    offers = fetch(args.locale)
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        elements = element_ids(client)
    prices = table(snapshot, elements, offers, args.locale)
    args.out.write_text(json.dumps(prices, separators=(",", ":")))
    print(
        f"{len(prices['prices'])} LDraw parts and colors priced from {len(offers)} Pick a Brick elements in {args.out}"
    )


if __name__ == "__main__":
    main()
