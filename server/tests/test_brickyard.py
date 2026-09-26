import time

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


def test_shape_tools_build_a_sound_house_and_pave_around_it(tmp_path):
    import asyncio

    from brickyard.model import Build
    from brickyard.session import Session, Store
    from brickyard.workbench import Workbench

    bench = Workbench(Session(Build(prompt="house"), Store(tmp_path)))
    door = {"side": "south", "at": 2, "width": 2, "courses": 2, "arch": True}
    windows = {"color": 46, "every": 3, "courses": [1, 2, 4]}
    walls = {"x": 10, "y": 10, "w": 8, "d": 6, "z": 0, "courses": 5, "color": 15, "corners": 19}

    async def build():
        return [
            await bench.walls("Walls", walls | {"windows": windows, "openings": [door]}),
            await bench.roof("Roof", {"x": 10, "y": 10, "w": 8, "d": 6, "z": 15, "color": 320, "steep": True}),
            await bench.fill(
                "Paving", {"x": 0, "y": 0, "w": 32, "d": 32, "z": 0, "kind": "tile", "palette": [[71, 1]]}
            ),
        ]

    results = asyncio.run(build())
    assert all("Rejected" not in r.text and "check:" not in r.text for r in results), [r.text for r in results]
    assert "Top of the walls: z=15." in results[0].text
    assert any(p.part == "3659.dat" for p in bench.pieces)
    assert f"Left out {2 * (8 + 6) - 4 - 2} cells already taken" in results[2].text


def test_a_truncated_tool_call_leaves_a_history_the_api_accepts():
    import json

    from brickyard.builders.holo import Reply

    reply = Reply(calls={0: {"id": "a", "name": "add_bricks", "arguments": '{"title": "Wall", "bricks": [{"pa'}})
    assert json.loads(reply.message()["tool_calls"][0]["function"]["arguments"]) == {}


def test_gallery_export_holds_every_file_the_static_site_reads(tmp_path):
    import json

    from brickyard.gallery import export
    from brickyard.model import Build, Message, Piece
    from brickyard.session import Store

    store = Store(tmp_path / "data")
    image = store.save_image(b"png", "image/png")
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
    assert shown.startswith("/gallery/") and (out.parent / shown.lstrip("/")).read_bytes() == b"png"
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
