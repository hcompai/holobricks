import gzip
import json
import time

import httpx
import pytest

from brickyard import catalog, ldraw, rebrickable
from brickyard.model import Piece


@pytest.fixture
def library(monkeypatch):
    monkeypatch.setattr(ldraw, "catalog", lambda: {"3069b.dat": "Tile", "9999.dat": "Another part"})
    monkeypatch.setattr(ldraw, "resolve", lambda p: p if p in ldraw.catalog() else None)
    monkeypatch.setattr(
        ldraw,
        "colors",
        lambda: {
            70: ("Reddish Brown", "#1"),
            78: ("Light Nougat", "#2"),
            326: ("Yellowish Green", "#3"),
            503: ("Very Light Grey", "#4"),
        },
    )


def snapshot(built_at=None, schema=catalog.SCHEMA) -> dict:
    return {
        "schema": schema,
        "built_at": time.time() if built_at is None else built_at,
        "colors": {
            "70": {"rebrickable": 70, "bricklink": 88, "bricklink_name": "Reddish Brown"},
            "78": {"rebrickable": 78, "bricklink": 90, "bricklink_name": "Light Nougat"},
            "326": {"rebrickable": 326, "bricklink": 158, "bricklink_name": "Yellowish Green"},
        },
        "parts": {"3069b.dat": {"rebrickable": "3069b", "bricklink": "3069", "colors": [70, 78, 326]}},
    }


@pytest.fixture
def saved(tmp_path, monkeypatch):
    path = tmp_path / "rebrickable.json.gz"
    monkeypatch.setattr(catalog, "SNAPSHOT", path)

    def save(data):
        if data is None:
            path.unlink()
        else:
            path.write_bytes(gzip.compress(json.dumps(data).encode()) if isinstance(data, dict) else data)

    save(snapshot())
    return save


def piece(color=70, part="3069b.dat"):
    return Piece(id=1, part=part, color=color, pos=(0, 0, 0), step=0)


def test_known_combinations_verify_with_their_bricklink_ids_and_others_get_repair_choices(library, saved):
    report = catalog.validate([piece(70), piece(78), piece(326)])
    assert report["valid"]
    assert [row["bricklink_color"] for row in report["inventory"]] == [88, 90, 158]
    assert {(row["rebrickable_part"], row["bricklink_part"]) for row in report["inventory"]} == {("3069b", "3069")}
    invalid = catalog.validate([piece(503), piece(70, "9999.dat")])
    assert not invalid["valid"] and not invalid["inventory"]
    assert [issue["code"] for issue in invalid["issues"]] == ["color_not_verified", "unmapped_part"]
    assert {c["color"] for c in invalid["issues"][0]["available_colors"]} == {70, 78, 326}


@pytest.mark.parametrize(
    "data",
    [
        None,
        b"not gzip",
        snapshot(built_at=time.time() - catalog.SNAPSHOT_TTL - 1),
        snapshot(built_at=time.time() + 3600),
        snapshot(schema=0),
        {"schema": catalog.SCHEMA, "built_at": time.time()},
    ],
    ids=["missing", "corrupt", "expired", "future", "unknown schema", "incomplete"],
)
def test_a_missing_or_untrustworthy_snapshot_never_authorizes_an_order(library, saved, data):
    saved(data)
    report = catalog.validate([piece()])
    assert not report["valid"] and not report["inventory"]
    assert report["issues"][0]["code"] == "catalog_unavailable"
    with pytest.raises(catalog.ValidationError):
        catalog.require([piece()])


def test_the_builder_keeps_unambiguous_mappings_and_colors_seen_in_real_sets(monkeypatch):
    library = ["3001.dat", "3069b.dat", "3070b.dat", "3794.dat", "4150.dat"]
    monkeypatch.setattr(ldraw, "catalog", lambda: dict.fromkeys(library))
    monkeypatch.setattr(rebrickable.time, "sleep", lambda _: None)

    def ids(ldraw_ids, bricklink_ids):
        return {"LDraw": {"ext_ids": ldraw_ids}, "BrickLink": {"ext_ids": bricklink_ids, "ext_descrs": [["BL"]]}}

    colors = [
        {"id": 4, "external_ids": ids([4], [5])},
        {"id": 15, "external_ids": ids([15], [1, 99])},
        {"id": 0, "external_ids": ids([0, 256], [11])},
        {"id": 70, "external_ids": ids([70, 6], [88])},
        {"id": 6, "external_ids": ids([6], [7])},
        {"id": -1, "external_ids": ids([16, 24], [0])},
    ]
    parts = [
        {"part_num": "3001", "external_ids": {"BrickLink": ["3001"]}},
        {"part_num": "3001a", "external_ids": {"LDraw": ["3001"], "BrickLink": ["3001old"]}},
        {"part_num": "3794a", "external_ids": {"LDraw": ["3794"], "BrickLink": ["3794a"]}},
        {"part_num": "3794b", "external_ids": {"LDraw": ["3794"], "BrickLink": ["3794b"]}},
        {"part_num": "3069b", "external_ids": {"LDraw": ["3069b"], "BrickLink": ["3069", "3069b"]}},
        {"part_num": "3070b", "external_ids": {"LDraw": ["3070b"], "BrickLink": ["3070"]}},
        {"part_num": "3070bpr", "external_ids": {"LDraw": ["3070b"], "BrickLink": ["3070pb01"]}},
        {"part_num": "4150", "external_ids": {"LDraw": ["4150"]}},
    ]
    inventories = "part_num,color_id\n3001,0\n3001,4\n3001,15\n3001,70\n3069b,4\n4150,999\n"

    def handler(request):
        if request.url.path.endswith("/colors/"):
            return httpx.Response(200, json={"results": colors, "next": None})
        if request.url.path.endswith("/parts/"):
            return httpx.Response(200, json={"results": parts, "next": None})
        body = inventories if "inventory_parts" in request.url.path else "part_num,color_id\n"
        return httpx.Response(200, content=gzip.compress(body.encode()))

    original = httpx.Client
    monkeypatch.setattr(
        rebrickable.httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)
    )
    built = rebrickable.build("key")
    black = {"rebrickable": 0, "bricklink": 11, "bricklink_name": "BL"}
    assert built["colors"] == {
        0: black,
        256: black,
        4: {"rebrickable": 4, "bricklink": 5, "bricklink_name": "BL"},
        15: {"rebrickable": 15, "bricklink": None, "bricklink_name": None},
        70: {"rebrickable": 70, "bricklink": 88, "bricklink_name": "BL"},
        6: {"rebrickable": 6, "bricklink": 7, "bricklink_name": "BL"},
    }
    assert built["parts"] == {
        "3001.dat": {"rebrickable": "3001", "bricklink": "3001", "colors": [0, 4, 15, 70, 256]},
        "3069b.dat": {"rebrickable": "3069b", "bricklink": None, "colors": [4]},
        "3070b.dat": {"rebrickable": "3070b", "bricklink": "3070", "colors": []},
        "4150.dat": {"rebrickable": "4150", "bricklink": None, "colors": []},
    }
