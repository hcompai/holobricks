import json

import httpx
import pytest

from brickyard import catalog, pickabrick


def snapshot() -> catalog.Snapshot:
    return catalog.Snapshot(
        built_at=0,
        sha256="",
        colors={4: {"rebrickable": 4}, 15: {"rebrickable": 15}},
        parts={"3001.dat": {"rebrickable": "3001"}, "3622.dat": {"rebrickable": "3622"}},
    )


def offer(element: str, cents: int, in_stock: bool = True, currency: str = "EUR") -> dict:
    return {"id": element, "cents": cents, "currency": currency, "in_stock": in_stock}


def test_each_ldraw_part_and_color_takes_its_cheapest_element_in_stock():
    elements = {("3001", 4): {"300121", "4613990"}, ("3001", 15): {"300101"}, ("3622", 4): {"362221"}}
    offers = [offer("300121", 30), offer("4613990", 20, in_stock=False), offer("300101", 25, in_stock=False)]
    table = pickabrick.table(snapshot(), elements, offers, "fr-FR")
    assert table["currency"] == "EUR"
    assert table["locale"] == "fr-FR"
    assert table["prices"] == {"3001.dat:15": [25, 0, "300101"], "3001.dat:4": [30, 1, "300121"]}


def test_prices_in_several_currencies_are_refused():
    with pytest.raises(ValueError, match="several currencies"):
        pickabrick.table(snapshot(), {}, [offer("1", 10), offer("2", 10, currency="USD")], "fr-FR")


def test_fetch_reads_every_page_in_the_store_locale(monkeypatch):
    listed = [
        {"id": str(i), "availability": "AVAILABLE", "price": {"centAmount": i, "currencyCode": "EUR"}} for i in range(5)
    ]
    listed.append({"id": "unpriced", "availability": "AVAILABLE", "price": None})
    seen = []

    def answer(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        page, size = body["variables"]["input"]["page"], 4
        seen.append((request.headers["x-locale"], page))
        results = listed[(page - 1) * size : page * size]
        return httpx.Response(200, json={"data": {"searchElements": {"results": results, "total": len(listed)}}})

    real = httpx.Client
    monkeypatch.setattr(pickabrick, "PAGE_SIZE", 4)
    monkeypatch.setattr(httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(answer), **kw))
    offers = pickabrick.fetch("en-US")
    assert [o["id"] for o in offers] == ["0", "1", "2", "3", "4"]
    assert seen == [("en-US", 1), ("en-US", 2)]
