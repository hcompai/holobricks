import json
import time
from xml.etree import ElementTree as ET

import pytest

from brickyard import catalog, ldraw, shopping
from brickyard.model import Build, Message, Piece, Step
from brickyard.workspace import bundle


@pytest.fixture
def model(monkeypatch, offline_catalog):
    library = dict.fromkeys(offline_catalog, "Part") | {"3069b.dat": "Tile 1 x 2", "6143.dat": "Round brick"}
    monkeypatch.setattr(ldraw, "catalog", lambda: library)
    monkeypatch.setattr(
        ldraw,
        "colors",
        lambda: {
            4: ("Red", "#C91A09"),
            14: ("Yellow", "#F2CD37"),
            16: ("Main", "#fff"),
            70: ("Reddish Brown", "#582A12"),
            78: ("Light Nougat", "#F6D7B3"),
            326: ("Yellowish Green", "#DFEEA5"),
            503: ("Very Light Grey", "#BCB4A5"),
        },
    )
    monkeypatch.setattr(
        ldraw,
        "resolve",
        lambda p: (
            (p.lower().removesuffix(".dat") + ".dat") if (p.lower().removesuffix(".dat") + ".dat") in library else None
        ),
    )
    return Build(
        id="shop-test",
        name="Little duck",
        status="done",
        steps=[Step(index=0, title="Body")],
        messages=[Message(role="user", text="PRIVATE CHAT", images=["/api/images/private.jpg"])],
        script="PRIVATE SOURCE",
        pieces=[
            Piece(id=1, part="3001.dat", color=14, pos=(0, 0, 0), step=0),
            Piece(id=2, part="3001.dat", color=14, pos=(80, 0, 0), step=0),
            Piece(id=3, part="3024.dat", color=4, pos=(0, -24, 0), step=99),
        ],
    )


def imported(pack):
    root = ET.fromstring(pack["xml"])
    assert root.tag == "INVENTORY"
    assert all(item.findtext("ITEMTYPE") == "P" and item.findtext("CONDITION") == "N" for item in root)
    return {(item.findtext("ITEMID"), int(item.findtext("COLOR"))): int(item.findtext("MINQTY")) for item in root}


def test_xml_has_verified_bricklink_ids_colors_and_exact_counts_including_orphan_steps(model):
    before = model.model_dump()
    pack = shopping.package(model)
    assert imported(pack) == {("3001", 3): 2, ("3024", 5): 1}
    assert pack["version"] == 3 and pack["validation"]["status"] == "verified"
    assert pack["validation"]["valid_until"] > time.time()
    assert pack["pieces"] == 3 and pack["lots"] == 2
    assert model.model_dump() == before
    assert "PRIVATE" not in json.dumps(pack)


def test_microduck_aliases_and_all_three_colors_are_resolved_from_catalog_metadata(model):
    model.pieces = []
    for part, color, count in [
        ("3069b.dat", 70, 122),
        ("3069b.dat", 78, 46),
        ("3069b.dat", 326, 4),
        ("6143.dat", 14, 1),
    ]:
        for _ in range(count):
            model.pieces.append(
                Piece(id=len(model.pieces), part=part, color=color, pos=(len(model.pieces) * 20, -8, 0), step=0)
            )
    before = model.model_dump()
    pack = shopping.package(model)
    assert imported(pack) == {("3069", 88): 122, ("3069", 90): 46, ("3069", 158): 4, ("3941", 3): 1}
    assert model.model_dump() == before
    assert pack["pieces"] == 173 and pack["lots"] == 4
    assert all(row["evidence"]["sha256"] for row in pack["inventory"])


def test_variant_and_print_suffixes_are_never_stripped(model):
    model.pieces = [
        Piece(id=1, part="3069a.dat", color=14, pos=(0, 0, 0), step=0),
        Piece(id=2, part="3069bp01.dat", color=14, pos=(40, 0, 0), step=0),
    ]
    pack = shopping.package(model)
    assert imported(pack) == {("3069a", 3): 1, ("3069bp01", 3): 1}


def test_aliases_merge_into_one_import_lot_without_losing_instances(model):
    model.pieces = [
        Piece(id=1, part="3069.dat", color=14, pos=(0, 0, 0), step=0),
        Piece(id=2, part="3069b.dat", color=14, pos=(40, 0, 0), step=0),
    ]
    pack = shopping.package(model)
    assert imported(pack) == {("3069", 3): 2}
    assert pack["pieces"] == 2 and pack["lots"] == 1


def test_the_same_model_gives_the_same_package_and_a_recolor_a_new_one(model):
    first = shopping.package(model)
    assert shopping.package(model) == first
    model.pieces[0].color = 4
    second = shopping.package(model)
    assert first["id"] != second["id"] and first["revision"] != second["revision"]


@pytest.mark.parametrize(
    "change",
    [
        "empty",
        "unknown_part",
        "unknown_color",
        "inherited_color",
        "too_large",
        "unsupported_pair",
        "no_bricklink_id",
        "outage",
    ],
)
def test_no_partial_or_unverified_export(model, monkeypatch, offline_catalog, change):
    if change == "empty":
        model.pieces = []
    elif change == "unknown_part":
        model.pieces[0].part = "s/not-a-part.dat"
    elif change == "unknown_color":
        model.pieces[0].color = 999999
    elif change == "inherited_color":
        model.pieces[0].color = 16
    elif change == "unsupported_pair":
        model.pieces[0].color = 503
    elif change == "no_bricklink_id":
        offline_catalog["3024.dat"]["bricklink"] = None
    elif change == "outage":

        def fail():
            raise catalog.CatalogUnavailable("Source unavailable")

        monkeypatch.setattr(catalog, "snapshot", fail)
    else:
        monkeypatch.setattr(shopping, "MAX_IMPORT_BYTES", 30)
    with pytest.raises(ValueError):
        shopping.package(model)
    assert "error" in bundle(model)["shopping"]


def test_labels_cannot_inject_xml_items(model):
    model.name = "</title><script>alert(1)</script>\n<ITEM><ITEMID>evil</ITEMID></ITEM>"
    assert sum(imported(shopping.package(model)).values()) == 3


def test_the_bundle_carries_the_verified_parts_list_and_shopping_list(model, monkeypatch):
    monkeypatch.setattr(ldraw, "pack", lambda part: "0 geometry")
    shown = bundle(model)
    assert shown["shopping"]["revision"] == shown["bom"]["revision"] == model.revision
    assert shown["bom"]["validation"]["status"] == "verified"
    assert sum(line["count"] for line in shown["bom"]["lines"]) == len(model.pieces)
    assert "PRIVATE" not in json.dumps(shown)
    model.pieces[0].color = 503
    shown = bundle(model)
    assert "error" in shown["shopping"] and "error" in shown["bom"]
