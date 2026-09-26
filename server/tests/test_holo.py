import asyncio
import base64
import io
import os
import sys
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from brickyard import ldraw
from brickyard.builders.holo import HoloBuilder
from brickyard.model import Build, baseplate, grid
from brickyard.session import Session, Store
from brickyard.workbench import Workbench

pytestmark = pytest.mark.skipif(not ldraw.LDRAW.exists(), reason="LDraw library not downloaded")


def brick(part="3001", x=0, y=0, z=0, color=4, rotation=0):
    return {"part": part, "x": x, "y": y, "z": z, "color": color, "rotation": rotation}


def png(width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), "red").save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def bench(tmp_path):
    session = Session(Build(), Store(tmp_path))
    asyncio.run(session.step("Baseplate", [baseplate(2)]))
    return Workbench(session)


def test_workbench_places_valid_bricks_and_explains_every_rejection(bench):
    result = asyncio.run(
        bench.add(
            "Base",
            [
                brick(x=4, y=4),
                brick(x=5, y=4),
                brick(x=30, y=0),
                brick(part="nope"),
                brick(x=10, y=10, z=6),
                brick(x=4, y=4, z=3, rotation=90),
            ],
        )
    )
    assert "placed 3 pieces" in result.text
    assert "overlaps brick 1 (3001 at x=4 y=4 z=0) of this step" in result.text
    assert "outside the 32x32 baseplate" in result.text
    assert "unknown part" in result.text
    assert "brick 5 (3001 at x=10 y=10 z=6): floating" in result.text
    placed = [grid(p) for p in bench.pieces[1:]]
    assert placed == [(4, 4, 0, 0), (10, 10, 6, 0), (4, 4, 3, 90)]


def test_overhanging_parts_only_fill_their_footprint(bench):
    result = asyncio.run(
        bench.add(
            "Garden",
            [
                brick(part="3742", x=0, y=0, color=4),
                brick(part="3005", x=1, y=0),
                brick(part="4085c", x=5, y=5),
                brick(part="3005", x=5, y=6),
            ],
        )
    )
    assert "placed 4 pieces" in result.text, result.text
    assert [grid(p)[:2] for p in bench.pieces[1:]] == [(0, 0), (1, 0), (5, 5), (5, 6)]


def test_window_frames_come_with_glass(bench):
    asyncio.run(bench.add("Window", [brick(part="60592", x=2, y=2, color=15)]))
    assert [p.part for p in bench.pieces[1:]] == ["60592.dat", "60601.dat"]
    assert "overlaps #2 60592" in asyncio.run(bench.add("Blocked", [brick(part="3005", x=2, y=2)])).text


HOUSE = """
step("Walls")
top = walls(10, 10, 8, 6, 0, 5, 15, corners=19, windows={"color": 46, "every": 3, "courses": [1, 2, 4]},
            openings=[{"side": "south", "at": 2, "width": 2, "courses": 2, "arch": True}])
step("Roof")
print("roof top", roof(10, 10, 8, 6, top, 320, steep=True))
step("Paving")
fill(0, 0, 32, 32, 0, palette=[[71, 1]], kind="tile")
"""


def test_a_script_rebuilds_from_its_first_changed_step_and_names_the_lines_of_its_problems(bench, monkeypatch):
    monkeypatch.setattr(bench.session, "render", lambda: asyncio.sleep(0))
    first = asyncio.run(bench.run_script(HOUSE))
    assert first.problems == 0 and "roof top" in first.text, first.text
    assert [s.title for s in bench.session.build.steps] == ["Baseplate", "Walls", "Roof", "Paving"]
    assert any(p.part == "3659.dat" for p in bench.pieces)
    walls = [p for p in bench.pieces if p.step == 1]

    recolored = asyncio.run(bench.run_script(HOUSE.replace("320", "4")))
    assert "kept step 2, rebuilt 2 steps" in recolored.text
    assert [p for p in bench.pieces if p.step == 1] == walls
    assert {p.color for p in bench.pieces if p.step == 2} == {4}

    stray = HOUSE.replace("320", "4") + 'brick("3001", 40, 0, 0, 4)\n'
    for _ in range(2):
        result = asyncio.run(bench.run_script(stray))
        assert result.problems == 1 and "kept steps 2 to 3, rebuilt 1 steps" in result.text
        assert 'line 9 `brick("3001", 40, 0, 0, 4)` (3001 at x=40 y=0 z=0): outside' in result.text

    buried = asyncio.run(bench.run_script(stray + "fill(10, 10, 8, 6, 0, 1)\n"))
    assert buried.problems == 2 and "line 10: fill covered only 0 of 48 cells" in buried.text, buried.text

    before = list(bench.pieces)
    broken = asyncio.run(bench.run_script(bench.session.build.script + "undefined()\n"))
    assert "did not change" in broken.text and "line 11 `undefined()`: NameError" in broken.text
    assert bench.pieces == before
    assert "undefined()" in bench.session.build.script


def test_agents_build_through_the_tools_endpoint_and_see_the_reference_beside_each_render(tmp_path, monkeypatch):
    from brickyard import app as app_module

    store = Store(tmp_path)
    monkeypatch.setattr(app_module, "store", store)
    monkeypatch.setattr(Session, "render", lambda self: asyncio.sleep(0, png(120, 90)))
    build = Build()
    build.reference = store.save_image(png(60, 90), "image/png").rsplit("/", 1)[-1]
    store.save(build)
    tools = f"/api/builds/{build.id}/tools"
    with TestClient(app_module.app) as client:
        ran = client.post(f"{tools}/run", json={"code": 'step("Core")\nbrick("3001", 4, 4, 0, 4)'}).json()
        assert ran["problems"] == 0 and "1 Core: 1 piece" in ran["text"], ran["text"]
        assert ran["caption"].startswith("Left, the reference photo.")
        assert Image.open(io.BytesIO(base64.b64decode(ran["images"][0]["data"]))).size == (180, 90)
        assert client.post(f"{tools}/build", json={}).status_code == 404
        assert client.post(f"{tools}/run", json={"script": "x"}).status_code == 400
    assert store.load(build.id).script.startswith('step("Core")')


def test_holo_gets_the_task_on_stdin_and_stop_ends_its_whole_process_group(tmp_path):
    agent = (
        "import os, subprocess, sys, time; "
        "open('task.txt', 'w').write(sys.stdin.read() + os.environ['BRICKYARD_BUILD']); "
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
        "open('pids', 'w').write(f'{os.getpid()} {child.pid}'); "
        "time.sleep(60)"
    )
    session = Session(Build(prompt="a lighthouse"), Store(tmp_path))
    workspace = tmp_path / "workspaces" / session.build.id

    async def main() -> list[int]:
        run = asyncio.create_task(HoloBuilder([sys.executable, "-c", agent], "http://test").run(session, "a tower"))
        while not (workspace / "pids").exists():
            await asyncio.sleep(0.05)
        run.cancel()
        with pytest.raises(asyncio.CancelledError):
            await run
        return [int(p) for p in (workspace / "pids").read_text().split()]

    pids = asyncio.run(main())
    task = (workspace / "task.txt").read_text()
    assert task.startswith("# Request\na tower") and "# The build script" in task and task.endswith(session.build.id)
    assert "1 Baseplate: 1 piece" in task and (workspace / "build.py").exists()
    assert not any(map(alive, pids))


def alive(pid: int) -> bool:
    for _ in range(40):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        time.sleep(0.05)
    return True
