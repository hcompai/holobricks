import json
import time
from xml.etree import ElementTree as ET

import pytest

from brickyard import catalog, ldraw, shopping
from brickyard.model import Build, Message, Piece, Step
from brickyard.store import Store


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


def imported(folder, pack):
    root = ET.fromstring((folder / f"{pack['id']}.xml").read_text())
    assert root.tag == "INVENTORY"
    assert all(item.findtext("ITEMTYPE") == "P" and item.findtext("CONDITION") == "N" for item in root)
    return {(item.findtext("ITEMID"), int(item.findtext("COLOR"))): int(item.findtext("MINQTY")) for item in root}


def test_xml_has_verified_bricklink_ids_colors_and_exact_counts_including_orphan_steps(model, tmp_path):
    before = model.model_dump()
    pack = shopping.save(model, tmp_path)
    assert imported(tmp_path, pack) == {("3001", 3): 2, ("3024", 5): 1}
    assert pack["version"] == 3 and pack["validation"]["status"] == "verified"
    assert pack["validation"]["valid_until"] > time.time()
    assert pack["pieces"] == 3 and pack["lots"] == 2
    assert model.model_dump() == before
    assert all(
        "PRIVATE" not in file.read_text() and "/api/images/" not in file.read_text() for file in tmp_path.iterdir()
    )


def test_microduck_aliases_and_all_three_colors_are_resolved_from_catalog_metadata(model, tmp_path):
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
    pack = shopping.save(model, tmp_path)
    assert imported(tmp_path, pack) == {("3069", 88): 122, ("3069", 90): 46, ("3069", 158): 4, ("3941", 3): 1}
    assert model.model_dump() == before
    assert pack["pieces"] == 173 and pack["lots"] == 4
    page = (tmp_path / f"{pack['id']}.html").read_text()
    assert "<td>3069b.dat</td><td>3069</td><td>88</td>" in page
    assert all(row["evidence"]["sha256"] for row in pack["inventory"])


def test_variant_and_print_suffixes_are_never_stripped(model, tmp_path):
    model.pieces = [
        Piece(id=1, part="3069a.dat", color=14, pos=(0, 0, 0), step=0),
        Piece(id=2, part="3069bp01.dat", color=14, pos=(40, 0, 0), step=0),
    ]
    pack = shopping.save(model, tmp_path)
    assert imported(tmp_path, pack) == {("3069a", 3): 1, ("3069bp01", 3): 1}


def test_aliases_merge_into_one_import_lot_without_losing_instances(model, tmp_path):
    model.pieces = [
        Piece(id=1, part="3069.dat", color=14, pos=(0, 0, 0), step=0),
        Piece(id=2, part="3069b.dat", color=14, pos=(40, 0, 0), step=0),
    ]
    pack = shopping.save(model, tmp_path)
    assert imported(tmp_path, pack) == {("3069", 3): 2}
    assert pack["pieces"] == 2 and pack["lots"] == 1


def test_retries_are_idempotent_and_recolors_cannot_change_saved_files(model, tmp_path):
    first = shopping.save(model, tmp_path)
    content = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    assert shopping.save(model, tmp_path) == first
    assert len(content) == 3
    model.pieces[0].color = 4
    second = shopping.save(model, tmp_path)
    assert first["id"] != second["id"] and first["revision"] != second["revision"]
    assert all((tmp_path / name).read_bytes() == body for name, body in content.items())


@pytest.mark.parametrize(
    "change",
    [
        "empty",
        "building",
        "idle",
        "error",
        "unknown_part",
        "unknown_color",
        "inherited_color",
        "too_large",
        "unsupported_pair",
        "no_bricklink_id",
        "outage",
    ],
)
def test_no_partial_or_unverified_export(model, tmp_path, monkeypatch, offline_catalog, change):
    if change == "empty":
        model.pieces = []
    elif change in ("building", "idle", "error"):
        model.status = change
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
        shopping.save(model, tmp_path)
    assert not list(tmp_path.iterdir())


def test_labels_cannot_inject_markup_or_xml_items(model, tmp_path):
    model.name = "</title><script>alert(1)</script>\n<ITEM><ITEMID>evil</ITEMID></ITEM>"
    pack = shopping.save(model, tmp_path)
    page = (tmp_path / f"{pack['id']}.html").read_text()
    assert "<script>" not in page and "&lt;script&gt;" in page
    assert sum(imported(tmp_path, pack).values()) == 3


def test_static_gallery_exports_only_validated_xml_and_blocks_invalid_models(model, tmp_path, monkeypatch):
    from brickyard.gallery import export

    library = tmp_path / "library"
    library.mkdir()
    (library / "LDConfig.ldr").write_text("0 colors")
    monkeypatch.setattr(ldraw, "LDRAW", library)
    monkeypatch.setattr(ldraw, "pack", lambda part: "0 geometry")
    store = Store(tmp_path / "data")
    model.messages = []
    store.save(model)
    out = export(store, [model.id], tmp_path / "site")
    pack = json.loads((out / "builds" / f"{model.id}.shopping.json").read_text())
    assert pack["revision"] == model.revision
    bom = json.loads((out / "builds" / f"{model.id}.bom.json").read_text())
    assert bom["revision"] == model.revision and bom["validation"]["status"] == "verified"
    assert sum(line["count"] for line in bom["lines"]) == len(model.pieces)
    assert all((out / "shopping" / f"{pack['id']}.{ext}").is_file() for ext in ("html", "json", "xml"))
    model.pieces[0].color = 503
    store.save(model)
    out = export(store, [model.id], tmp_path / "invalid-site")
    assert "error" in json.loads((out / "builds" / f"{model.id}.shopping.json").read_text())
    assert "error" in json.loads((out / "builds" / f"{model.id}.bom.json").read_text())
    assert not (out / "shopping").exists()
