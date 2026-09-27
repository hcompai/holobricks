import json
import time
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from brickyard import catalog, ldraw, shopping
from brickyard.model import Build, Message, Piece, Step
from brickyard.session import Store


@pytest.fixture
def model(monkeypatch, offline_catalog):
    library = {p + ".dat": p for p in offline_catalog} | {"3069b.dat": "Tile 1 x 2", "6143.dat": "Round brick"}
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
    monkeypatch.setattr(
        ldraw,
        "read",
        lambda p: (
            "0 Part",
            "",
            "0 !KEYWORDS BrickLink " + {"3069b.dat": "3069", "6143.dat": "3941"}.get(p, p.removesuffix(".dat")),
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
        "outage",
    ],
)
def test_no_partial_or_unverified_export(model, tmp_path, monkeypatch, change):
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
    elif change == "outage":

        def fail(*args):
            raise catalog.CatalogUnavailable("Source unavailable")

        monkeypatch.setattr(catalog.Catalog, "get", fail)
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


def test_api_checks_revision_blocks_invalid_pairs_and_revokes_legacy_or_expired_downloads(model, tmp_path, monkeypatch):
    from brickyard import app as module

    store = Store(tmp_path)
    store.save(model)
    monkeypatch.setattr(module, "store", store)
    monkeypatch.setattr(module, "sessions", {})
    client = TestClient(module.app)
    url = f"/api/builds/{model.id}/shopping"
    assert client.post(url, json={"revision": "stale"}).status_code == 409
    response = client.post(url, json={"revision": model.revision})
    assert response.status_code == 200
    pack = response.json()
    link = f"/api/shopping/{pack['id']}"
    original = client.get(f"{link}.xml")
    assert original.status_code == 200 and "attachment" in original.headers["content-disposition"]
    assert original.headers["cache-control"] == "private, no-store"
    assert client.get(f"{link}.json").json() == pack
    assert client.get(f"{link}.ldr").status_code == 410
    model.pieces[0].color = 503
    store.save(model)
    assert client.post(url, json={"revision": pack["revision"]}).status_code == 409
    rejected = client.post(url, json={"revision": model.revision})
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["issues"][0]["code"] == "color_not_verified"
    assert client.get(f"{link}.xml").content == original.content
    report = client.get(f"/api/builds/{model.id}/bom/validation").json()
    assert not report["valid"] and report["revision"] == model.revision
    assert len(list((tmp_path / "shopping").iterdir())) == 3
    monkeypatch.setattr(module.time, "time", lambda: pack["validation"]["valid_until"] + 1)
    assert client.get(f"{link}.xml").status_code == 410
    assert client.get("/api/shopping/not-a-package.json").status_code == 404


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


def test_bom_revalidates_legacy_models_and_same_count_recolors_without_partial_lists(model, tmp_path, monkeypatch):
    from brickyard import app as module

    store = Store(tmp_path)
    store.save(model)
    monkeypatch.setattr(module, "store", store)
    monkeypatch.setattr(module, "sessions", {})
    client = TestClient(module.app)
    url = f"/api/builds/{model.id}/bom"
    response = client.get(url)
    assert response.status_code == 200 and response.headers["cache-control"] == "private, no-store"
    bom = response.json()
    assert bom["pieces"] == 3 and bom["revision"] == model.revision
    assert bom["lines"][0]["bricklinkPart"] == "3001" and bom["lines"][0]["bricklinkColor"] == 3
    model.pieces[0].color = 503
    store.save(model)
    response = client.get(url)
    assert response.status_code == 422
    assert "lines" not in response.json()
    assert response.json()["detail"]["issues"][0]["code"] == "color_not_verified"

    def unavailable(*args):
        raise catalog.CatalogUnavailable("Temporarily unavailable")

    monkeypatch.setattr(catalog.Catalog, "get", unavailable)
    assert client.get(url).json()["detail"]["issues"][0]["code"] == "catalog_unavailable"
