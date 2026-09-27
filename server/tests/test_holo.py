import asyncio
import base64
import io
import json
import os
import re
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from brickyard import ldraw, script
from brickyard.builders.holo import HoloBuilder
from brickyard.model import Box, Build, Camera, grid
from brickyard.session import Session, Store
from brickyard.workbench import Workbench, part_line

pytestmark = pytest.mark.skipif(not ldraw.LDRAW.exists(), reason="LDraw library not downloaded")


def brick(part="3001", x=0, y=0, z=0, color=4, rotation=0):
    return {"part": part, "x": x, "y": y, "z": z, "color": color, "rotation": rotation}


def png(width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), "red").save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def bench(tmp_path, monkeypatch):
    # These preexisting tests exercise geometry/script semantics. Real catalog gating
    # is exercised separately in test_catalog and test_construction_loop.
    monkeypatch.setattr(
        "brickyard.catalog.validate", lambda pieces, *args: {"valid": True, "pieces": len(pieces), "issues": []}
    )
    return Workbench(Session(Build(), Store(tmp_path)))


def test_workbench_places_valid_bricks_anywhere_from_x_and_y_0_and_explains_every_rejection(bench):
    result = asyncio.run(
        bench.add(
            "Base",
            [
                brick(x=4, y=4),
                brick(x=5, y=4),
                brick(x=-1, y=0),
                brick(x=200, y=150),
                brick(part="nope"),
                brick(x=10, y=10, z=6),
                brick(x=4, y=4, z=3, rotation=90),
            ],
        )
    )
    assert "placed 4 pieces" in result.text
    assert "overlaps brick 1 (3001 at x=4 y=4 z=0) of this step" in result.text
    assert "brick 3 (3001 at x=-1 y=0 z=0): x and y start at 0" in result.text
    assert "unknown part" in result.text
    assert "brick 6 (3001 at x=10 y=10 z=6): floating" in result.text
    placed = [grid(p) for p in bench.pieces]
    assert placed == [(4, 4, 0, 0), (200, 150, 0, 0), (10, 10, 6, 0), (4, 4, 3, 90)]
    assert (bench.session.build.width, bench.session.build.depth) == (204, 152)


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
    assert [grid(p)[:2] for p in bench.pieces] == [(0, 0), (1, 0), (5, 5), (5, 6)]


def test_window_frames_come_with_glass(bench):
    asyncio.run(bench.add("Window", [brick(part="60592", x=2, y=2, color=15)]))
    assert [p.part for p in bench.pieces] == ["60592.dat", "60601.dat"]
    assert "overlaps #1 60592" in asyncio.run(bench.add("Blocked", [brick(part="3005", x=2, y=2)])).text


HOUSE = """
step("Walls")
for z in range(0, 15, 3):
    for x in range(10, 18, 2):
        brick("3004", x, 10, z, 15)
step("Roof")
brick("3039", 10, 10, 15, 320)
print("roof top", top(10, 10))
step("Paving")
for x in range(0, 32, 2):
    brick("3069b", x, 0, 0, 71)
"""


def test_a_script_rebuilds_from_its_first_changed_step_and_names_the_lines_of_its_problems(bench, monkeypatch):
    monkeypatch.setattr(bench.session, "render", lambda camera=None, box=None: asyncio.sleep(0))
    first = asyncio.run(bench.run_script(HOUSE))
    assert first.problems == 1 and "roof top 18" in first.text and "disconnected_model" in first.text, first.text
    assert [s.title for s in bench.session.build.steps] == ["Walls", "Roof", "Paving"]
    walls = [p for p in bench.pieces if p.step == 0]

    recolored = asyncio.run(bench.run_script(HOUSE.replace("320", "4")))
    assert "kept step 1, rebuilt 2 steps" in recolored.text
    assert [p for p in bench.pieces if p.step == 0] == walls
    assert {p.color for p in bench.pieces if p.step == 1} == {4}

    stray = HOUSE.replace("320", "4") + 'brick("3001", -1, 0, 0, 4)\n'
    for _ in range(2):
        result = asyncio.run(bench.run_script(stray))
        assert result.problems == 1 and "kept steps 1 to 2, rebuilt 1 steps" in result.text
        assert 'line 12 `brick("3001", -1, 0, 0, 4)` (3001 at x=-1 y=0 z=0): x and y start at 0' in result.text

    before = list(bench.pieces)
    broken = asyncio.run(bench.run_script(bench.session.build.script + "undefined()\n"))
    assert "did not change" in broken.text and "line 12 `undefined()`: NameError" in broken.text
    assert bench.pieces == before
    assert bench.session.build.script == HOUSE.replace("320", "4")


def test_a_step_builds_the_same_bricks_whatever_randomness_the_steps_before_it_use():
    trees = 'step("Trees")\nfor x in range(0, 30, 3):\n    brick("3062b", x, random.randint(0, 31), 0, 2)\n'

    def trees_after(draws: int) -> list:
        code = f'import random\nstep("Paving")\nfor _ in range({draws}):\n    random.random()\n{trees}'
        return script.run(code, [])["steps"][-1]["bricks"]

    assert trees_after(1) == trees_after(50)


def test_agents_build_through_the_tools_endpoint_and_see_the_model_from_any_camera_as_the_chat_does(
    tmp_path, monkeypatch
):
    from brickyard import app as app_module

    store = Store(tmp_path)
    monkeypatch.setattr(app_module, "store", store)
    cameras, boxes = [], []

    async def render(self, camera=None, box=None):
        cameras.append(camera)
        boxes.append(box)
        return png(120, 90)

    monkeypatch.setattr(Session, "render", render)
    build = Build()
    store.save(build)
    tools = f"/api/builds/{build.id}/tools"
    with TestClient(app_module.app) as client:
        code = 'import random\nrng = random.Random(7)\nstep("Core")\nbrick("3001", rng.randint(0, 9), 4, 0, 4)'
        ran = client.post(f"{tools}/run", json={"code": code}).json()
        assert ran["problems"] == 0 and "1 Core: 1 piece" in ran["text"], ran["text"]
        assert Image.open(io.BytesIO(base64.b64decode(ran["images"][0]["data"]))).size == (120, 90)
        assert "kept step 1," in client.post(f"{tools}/run", json={"code": code}).json()["text"]
        assert cameras == [None, None]
        closer = client.post(f"{tools}/look", json={"camera": {"angle": 200, "zoom": 3, "at": [4, 4, 3]}}).json()
        assert closer["caption"] == "The view from 200 degrees, 30 up, zoom 3, centered on x 4, y 4, z 3."
        assert cameras[-1] == Camera(angle=200, zoom=3, at=(4, 4, 3))
        assert client.post(f"{tools}/look", json={"camera": {"zoom": 0}}).json()["problems"] == 1
        closeup = client.post(f"{tools}/look", json={"box": [0, 0, 0, 12, 8, 2]}).json()
        assert closeup["caption"].startswith("Only the 1 pieces in the box x 0-12, y 0-8, z 0-2.")
        assert boxes[-1] == Box(x0=0, y0=0, z0=0, x1=12, y1=8, z1=2)
        assert client.post(f"{tools}/look", json={"box": [20, 20, 0, 25, 25, 9]}).json()["problems"] == 1
        shown = store.load(build.id).messages[-1].images
        assert len(shown) == 1 and client.get(shown[0]).content == png(120, 90)
        assert client.post(f"{tools}/build", json={}).status_code == 404
        assert client.post(f"{tools}/run", json={"script": "x"}).status_code == 400
    assert store.load(build.id).script == code


def test_a_render_is_answered_by_a_late_viewer_but_never_by_a_stale_one(tmp_path):
    async def main() -> bytes | None:
        session = Session(Build(), Store(tmp_path))
        waiting = asyncio.create_task(session.render(Camera(angle=90), timeout=5))
        await asyncio.sleep(0)
        event = session.subscribe().get_nowait()
        assert event["type"] == "render" and event["camera"]["angle"] == 90
        assert not session.deliver_render(event["request"], b"stale", event["pieces"] + 1, event["revision"])
        assert not session.deliver_render(event["request"], b"stale", event["pieces"], "old-geometry")
        assert not session.deliver_render(event["request"], b"stale", event["pieces"])
        assert session.deliver_render(event["request"], b"png", event["pieces"], event["revision"])
        return await waiting

    assert asyncio.run(main()) == b"png"


def test_the_prompt_names_only_real_parts_and_colors_and_its_example_builds_cleanly(bench, monkeypatch):
    agent = Path(__file__).resolve().parents[2] / "agent"
    prompt = (agent / "holo.j2").read_text()
    parts = re.findall(r"^\w+: .*\| .* tall$", prompt, re.MULTILINE)
    assert len(parts) > 80
    for line in parts:
        assert line == part_line(f"{line.split(':')[0]}.dat")
    palette = ldraw.colors()
    colors = prompt[prompt.index("# Colors") : prompt.index("# Session")].splitlines()
    for entry in (e for line in colors if line.startswith("- ") for e in line.split(": ")[1].split(", ")):
        code, name = entry.split(" ", 1)
        assert palette[int(code)][0].lower() == name, entry

    monkeypatch.setattr(bench.session, "render", lambda camera=None, box=None: asyncio.sleep(0))
    example = re.search(r"```python\n(.*?)```", prompt, re.DOTALL).group(1)
    result = asyncio.run(bench.run_script(example))
    assert result.problems == 0, result.text


def test_holo_gets_the_task_on_stdin_and_stop_ends_its_whole_process_group(tmp_path, monkeypatch):
    agent = (
        "import os, subprocess, sys, time; "
        "open('task.txt', 'w').write(sys.stdin.read() + os.environ['BRICKYARD_BUILD']); "
        "open('references.json', 'w').write(os.environ['BRICKYARD_REFERENCES']); "
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
        "open('pids', 'w').write(f'{os.getpid()} {child.pid}'); "
        "time.sleep(60)"
    )
    session = Session(Build(prompt="a lighthouse"), Store(tmp_path))
    workspace = tmp_path / "workspaces" / session.build.id
    workspace.mkdir(parents=True)
    (workspace / "notes.md").write_text("Pinned reference-2.jpg: the lighthouse from the pier.")
    photo = tmp_path / "images" / "pier.jpg"
    photo.parent.mkdir()
    photo.write_bytes(b"jpeg")

    async def main() -> list[int]:
        run = asyncio.create_task(
            HoloBuilder([sys.executable, "-c", agent], "http://test").run(session, "a tower", [photo])
        )
        while not (workspace / "pids").exists():
            await asyncio.sleep(0.05)
        run.cancel()
        with pytest.raises(asyncio.CancelledError):
            await run
        return [int(p) for p in (workspace / "pids").read_text().split()]

    pids = asyncio.run(main())
    task = (workspace / "task.txt").read_text()
    assert task.startswith("# Request\na tower") and "Build area" not in task and task.endswith(session.build.id)
    assert "the lighthouse from the pier" in task and "No pieces yet." in task
    assert "- references/pier.jpg (attached to this request)" in task
    assert "# Original request (verbatim)\na lighthouse" in task
    assert "working interpretations, not additional user instructions" in task
    assert json.loads((workspace / "references.json").read_text()) == [str(workspace / "references" / "pier.jpg")]
    assert (workspace / "references" / "pier.jpg").read_bytes() == b"jpeg"
    assert json.loads((workspace / ".brickyard-reference.json").read_text())["path"] == str(
        workspace / "references" / "pier.jpg"
    )
    assert not session.build.steps
    assert (workspace / "build.py").exists() and (workspace / "showcase" / "paris.png").exists()
    assert not any(map(alive, pids))


def alive(pid: int) -> bool:
    for _ in range(40):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        time.sleep(0.05)
    return True
