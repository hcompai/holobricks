import io
import time
from pathlib import Path

import PIL.Image
import pytest
from fastapi.testclient import TestClient

from brickyard import ldraw
from brickyard.model import place

pytestmark = pytest.mark.skipif(not ldraw.LDRAW.exists(), reason="LDraw library not downloaded")


def test_place_puts_parts_on_the_stud_grid_at_plate_heights():
    brick = place("3001.dat", 0, 0, 0, 4)
    assert brick.pos == (40.0, -24.0, 20.0)
    turned = place("3001.dat", 5, 7, 3, 4, rotation=90)
    assert turned.pos == (5 * 20 + 20, -3 * 8 - 24, 7 * 20 + 40)
    tree = place("3471.dat", 1, 1, 0, 288)
    assert tree.pos[0] == pytest.approx(1 * 20 + 40) and tree.pos[2] == pytest.approx(1 * 20 + 40)


def test_packed_part_embeds_every_subfile_under_the_names_the_viewer_resolves():
    packed = ldraw.pack("3001.dat")
    assert packed.startswith("0 FILE brickyard.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat")
    names = [line[7:] for line in packed.splitlines() if line.startswith("0 FILE ")]
    assert "3001.dat" in names and "stud.dat" in names
    assert all(not n.startswith(("s/", "48/")) for n in names)


def test_demo_build_streams_to_completion_and_exports_steps(tmp_path, monkeypatch):
    monkeypatch.setenv("BRICKYARD_DATA", str(tmp_path))
    from brickyard import app as app_module
    from brickyard.builders import BUILDERS
    from brickyard.session import Store

    monkeypatch.setattr(app_module, "store", Store(tmp_path))
    monkeypatch.setattr(BUILDERS["demo"], "delay", 0)
    with TestClient(app_module.app) as client:
        created = client.post("/api/builds", json={"prompt": "a cottage", "builder": "demo"}).json()
        for _ in range(300):
            build = client.get(f"/api/builds/{created['id']}").json()
            if build["status"] in ("done", "error"):
                break
            time.sleep(0.1)
        assert build["status"] == "done"
        assert len(build["steps"]) > 10 and len(build["pieces"]) > 150
        assert {p["step"] for p in build["pieces"]} == set(range(len(build["steps"])))
        ldr = client.get(f"/api/builds/{created['id']}/download.ldr").text
        assert ldr.count("0 STEP") == len(build["steps"])


def test_gallery_export_holds_every_file_the_static_site_reads(tmp_path):
    import json

    from brickyard.gallery import export
    from brickyard.model import Build, Message, Piece
    from brickyard.session import Store

    store = Store(tmp_path / "data")
    png = io.BytesIO()
    PIL.Image.new("RGB", (800, 600), "red").save(png, "PNG")
    image = store.save_image(png.getvalue(), "image/png")
    pieces = [place("3001.dat", 0, 0, 0, 4), place("3024.dat", 0, 0, 3, 15)]
    build = Build(
        status="done",
        pieces=[Piece(id=i, step=0, **p.model_dump()) for i, p in enumerate(pieces)],
        messages=[Message(role="tool", text="Looked", images=[image])],
    )
    store.save(build)
    out = export(store, [build.id], tmp_path / "site")

    assert [b["id"] for b in json.loads((out / "builds.json").read_text())] == [build.id]
    exported = Build.model_validate_json((out / "builds" / f"{build.id}.json").read_text())
    shown = exported.messages[0].images[0]
    assert shown.startswith("/gallery/") and (out.parent / shown.lstrip("/")).read_bytes() == png.getvalue()
    with PIL.Image.open(out / "images" / "small" / f"{Path(shown).name}.webp") as small:
        assert small.size == (320, 240)
    assert all((out / "parts" / p.part).exists() for p in exported.pieces)
    assert (out / "builds" / f"{build.id}.bom.json").exists() and (out / "LDConfig.ldr").exists()


def test_changing_a_hand_scripted_build_hands_it_to_a_live_builder(tmp_path, monkeypatch):
    from brickyard import app as app_module
    from brickyard.builders import BUILDERS
    from brickyard.model import Build
    from brickyard.session import Store

    store = Store(tmp_path)
    monkeypatch.setattr(app_module, "store", store)
    monkeypatch.setattr(BUILDERS["demo"], "delay", 0)
    build = Build(prompt="Paris", builder="claude", status="done")
    store.save(build)
    with TestClient(app_module.app) as client:
        changed = client.post(f"/api/builds/{build.id}/messages", json={"text": "add a tree"}).json()
    assert changed["builder"] == next(iter(BUILDERS))


def test_reference_images_reach_the_chat_and_the_builder_within_holos_image_budget(tmp_path, monkeypatch):
    import base64
    import re
    from pathlib import Path

    from brickyard import app as app_module
    from brickyard.builders import BUILDERS
    from brickyard.session import Store

    seen = []

    class Recorder:
        name = "demo"

        async def run(self, session, request, references):
            seen.append([p.read_bytes() for p in references])

    holo = (Path(__file__).resolve().parents[2] / "agent" / "holo.yaml").read_text()
    assert app_module.MAX_REFERENCES == int(re.search(r"^  message: (\d+)$", holo, re.MULTILINE).group(1))
    monkeypatch.setattr(app_module, "store", Store(tmp_path))
    monkeypatch.setitem(BUILDERS, "demo", Recorder())
    photo = "data:image/jpeg;base64," + base64.b64encode(b"jpeg").decode()
    with TestClient(app_module.app) as client:
        body = {"prompt": "a barn", "builder": "demo"}
        assert client.post("/api/builds", json=body | {"images": [photo] * 3}).status_code == 400
        assert client.post("/api/builds", json=body | {"images": ["data:text/plain;base64,aGk="]}).status_code == 400
        created = client.post("/api/builds", json=body | {"images": [photo]}).json()
        for _ in range(50):
            if seen:
                break
            time.sleep(0.05)
        message = client.get(f"/api/builds/{created['id']}").json()["messages"][0]
        assert client.get(message["images"][0]).content == b"jpeg"
    assert len(Store(tmp_path).summaries()) == 1
    assert seen == [[b"jpeg"]]


def test_a_build_left_building_by_a_dead_server_is_done_after_a_restart(tmp_path, monkeypatch):
    from brickyard import app as app_module
    from brickyard.model import Build
    from brickyard.session import Store

    store = Store(tmp_path)
    monkeypatch.setattr(app_module, "store", store)
    build = Build(prompt="Tower Bridge", status="building")
    store.save(build)
    with TestClient(app_module.app) as client:
        served = client.get(f"/api/builds/{build.id}").json()
    assert served["status"] == "done" and served["messages"][-1]["text"] == "Stopped: the server restarted."


def test_an_idle_build_rewritten_on_disk_is_served_fresh(tmp_path, monkeypatch):
    from brickyard import app as app_module
    from brickyard.model import Build
    from brickyard.session import Store

    store = Store(tmp_path)
    monkeypatch.setattr(app_module, "store", store)
    build = Build(prompt="Paris", name="old", builder="claude", status="done")
    store.save(build)
    with TestClient(app_module.app) as client:
        assert client.get(f"/api/builds/{build.id}").json()["name"] == "old"
        store.save(build.model_copy(update={"name": "new"}))
        assert client.get(f"/api/builds/{build.id}").json()["name"] == "new"


def test_file_names_from_requests_cannot_leave_the_data_folder(tmp_path):
    from brickyard.session import Store

    (tmp_path / "secret.json").write_text("{}")
    store = Store(tmp_path / "data")
    assert store.load("../../secret") is None
    for reach in (lambda: store.thumbnail("../../secret"), lambda: store.image("../../secret.json")):
        with pytest.raises(ValueError):
            reach()
