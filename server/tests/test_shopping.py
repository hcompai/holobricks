import json
from collections import Counter

import pytest
from fastapi.testclient import TestClient

from brickyard import ldraw, shopping
from brickyard.model import Build, Message, Piece, Step
from brickyard.session import Store


@pytest.fixture
def model(monkeypatch):
    # Tests remain offline and do not need the full geometry library.
    catalog = {"3001.dat": "Brick 2 x 4", "3024.dat": "Plate 1 x 1"}
    monkeypatch.setattr(ldraw, "catalog", lambda: catalog)
    monkeypatch.setattr(
        ldraw, "colors", lambda: {4: ("Red", "#C91A09"), 14: ("Yellow", "#F2CD37"), 16: ("Main", "#fff")}
    )
    monkeypatch.setattr(
        ldraw,
        "resolve",
        lambda p: (
            (p.lower().removesuffix(".dat") + ".dat") if (p.lower().removesuffix(".dat") + ".dat") in catalog else None
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
            # Legacy models can contain pieces whose step metadata was lost.
            Piece(id=3, part="3024.dat", color=4, pos=(0, -24, 0), step=99),
        ],
    )


def test_import_preserves_every_instance_and_ldraw_colors(model, tmp_path):
    pack = shopping.save(model, tmp_path)
    lines = (tmp_path / f"{pack['id']}.ldr").read_text().splitlines()
    imported = Counter((line.split()[-1], int(line.split()[1])) for line in lines if line.startswith("1 "))
    assert imported == Counter({("3001.dat", 14): 2, ("3024.dat", 4): 1})
    assert pack["pieces"] == 3 and pack["lots"] == 2
    assert "1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3024.dat" in lines
    for file in tmp_path.iterdir():
        assert "PRIVATE" not in file.read_text() and "/api/images/" not in file.read_text()


def test_retries_are_idempotent_and_recolors_cannot_change_a_saved_order(model, tmp_path):
    first = shopping.save(model, tmp_path)
    content = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    assert shopping.save(model, tmp_path) == first
    assert len(list(tmp_path.iterdir())) == 3
    model.pieces[0].color = 4
    second = shopping.save(model, tmp_path)
    assert first["id"] != second["id"] and first["revision"] != second["revision"]
    assert all((tmp_path / name).read_bytes() == body for name, body in content.items())


@pytest.mark.parametrize(
    "change", ["empty", "building", "idle", "error", "unknown_part", "unknown_color", "inherited_color", "too_large"]
)
def test_incomplete_or_unimportable_lists_are_not_exported(model, tmp_path, monkeypatch, change):
    if change == "empty":
        model.pieces = []
    elif change in ("building", "idle", "error"):
        model.status = change
    elif change == "unknown_part":
        model.pieces[0].part = "s/not-a-purchasable-part.dat"
    elif change == "unknown_color":
        model.pieces[0].color = 999999
    elif change == "inherited_color":
        model.pieces[0].color = 16
    else:
        monkeypatch.setattr(shopping, "MAX_IMPORT_BYTES", 30)
    with pytest.raises(ValueError):
        shopping.save(model, tmp_path)
    assert not list(tmp_path.iterdir())


def test_model_labels_cannot_inject_html_or_extra_ldraw_items(model, tmp_path):
    model.name = "</title><script>alert(1)</script>\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat"
    pack = shopping.save(model, tmp_path)
    page = (tmp_path / f"{pack['id']}.html").read_text()
    assert "<script>" not in page and "&lt;script&gt;" in page
    assert (tmp_path / f"{pack['id']}.ldr").read_text().count("\n1 ") == 3


def test_api_checks_exact_revision_and_keeps_saved_links_valid(model, tmp_path, monkeypatch):
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
    original = client.get(f"{link}.ldr")
    assert original.status_code == 200 and "attachment" in original.headers["content-disposition"]
    page = client.get(f"{link}.html")
    assert page.status_code == 200 and f'href="{pack["id"]}.ldr"' in page.text
    assert client.get(f"{link}.json").json() == pack
    model.pieces[0].color = 4
    store.save(model)
    assert client.post(url, json={"revision": pack["revision"]}).status_code == 409
    assert client.get(f"{link}.ldr").content == original.content
    model.status = "building"
    store.save(model)
    assert client.post(url, json={"revision": model.revision}).status_code == 422
    assert client.get("/api/shopping/not-a-package.json").status_code == 404
    assert client.get(f"/api/shopping/{'f' * 64}.json").status_code == 404


def test_static_gallery_has_the_same_handoff_without_a_server(model, tmp_path, monkeypatch):
    from brickyard.gallery import export

    library = tmp_path / "library"
    library.mkdir()
    (library / "LDConfig.ldr").write_text("0 colors")
    monkeypatch.setattr(ldraw, "LDRAW", library)
    monkeypatch.setattr(ldraw, "pack", lambda part: "0 geometry")
    monkeypatch.setattr(Build, "bom", lambda self: [])
    store = Store(tmp_path / "data")
    model.messages = []
    store.save(model)
    out = export(store, [model.id], tmp_path / "site")
    pack = json.loads((out / "builds" / f"{model.id}.shopping.json").read_text())
    assert pack["revision"] == model.revision
    assert all((out / "shopping" / f"{pack['id']}.{ext}").is_file() for ext in ("html", "json", "ldr"))
