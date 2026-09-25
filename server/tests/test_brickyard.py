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
    packed = ldraw.pack("3001.dat", 4)
    assert packed.startswith("0 FILE brickyard.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat")
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
