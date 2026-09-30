import gzip
import json
import re
from pathlib import Path

import pytest

from brickyard import ldraw, script
from brickyard.model import Build, grid
from brickyard.workbench import Workbench
from brickyard.workspace import BUILD, MODEL, Workspace

pytestmark = pytest.mark.skipif(not ldraw.LDRAW.exists(), reason="LDraw library not downloaded")


def brick(part="3001", x=0, y=0, z=0, color=4, rotation=0):
    return {"part": part, "x": x, "y": y, "z": z, "color": color, "rotation": rotation}


@pytest.fixture
def bench(tmp_path, monkeypatch):
    # These tests exercise geometry/script semantics. Real catalog gating
    # is exercised separately in test_catalog and test_construction_loop.
    monkeypatch.setattr(
        "brickyard.catalog.validate",
        lambda pieces, *args: {"valid": True, "pieces": len(pieces), "inventory": [], "issues": []},
    )
    return Workbench(Workspace.open(tmp_path))


def test_workbench_places_valid_bricks_anywhere_from_x_and_y_0_and_explains_every_rejection(bench):
    result = bench.add(
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
    assert "placed 4 pieces" in result.text
    assert "overlaps brick 1 (3001 at x=4 y=4 z=0) of this step" in result.text
    assert "brick 3 (3001 at x=-1 y=0 z=0): x and y start at 0" in result.text
    assert "unknown part" in result.text
    assert "brick 6 (3001 at x=10 y=10 z=6): floating" in result.text
    placed = [grid(p) for p in bench.pieces]
    assert placed == [(4, 4, 0, 0), (200, 150, 0, 0), (10, 10, 6, 0), (4, 4, 3, 90)]
    assert (bench.workspace.build.width, bench.workspace.build.depth) == (204, 152)


def test_overhanging_parts_only_fill_their_footprint(bench):
    result = bench.add(
        "Garden",
        [
            brick(part="3742", x=0, y=0, color=4),
            brick(part="3005", x=1, y=0),
            brick(part="4085c", x=5, y=5),
            brick(part="3005", x=5, y=6),
        ],
    )
    assert "placed 4 pieces" in result.text, result.text
    assert [grid(p)[:2] for p in bench.pieces] == [(0, 0), (1, 0), (5, 5), (5, 6)]


def test_window_frames_come_with_glass(bench):
    bench.add("Window", [brick(part="60592", x=2, y=2, color=15)])
    assert [p.part for p in bench.pieces] == ["60592.dat", "60601.dat"]
    assert "overlaps #1 60592" in bench.add("Blocked", [brick(part="3005", x=2, y=2)]).text


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


def test_a_script_rebuilds_from_its_first_changed_step_and_names_the_lines_of_its_problems(bench):
    first = bench.run_script(HOUSE)
    assert first.problems == 1 and "roof top 18" in first.text and "disconnected_model" in first.text, first.text
    assert [s.title for s in bench.workspace.build.steps] == ["Walls", "Roof", "Paving"]
    walls = [p for p in bench.pieces if p.step == 0]

    recolored = bench.run_script(HOUSE.replace("320", "4"))
    assert "kept step 1 unchanged, rebuilt and checked 2 steps" in recolored.text
    assert [p for p in bench.pieces if p.step == 0] == walls
    assert {p.color for p in bench.pieces if p.step == 1} == {4}

    stray = HOUSE.replace("320", "4") + 'brick("3001", -1, 0, 0, 4)\n'
    for _ in range(2):
        result = bench.run_script(stray)
        assert result.problems == 2 and "kept steps 1 to 2 unchanged, rebuilt and checked 1 step." in result.text
        assert "disconnected_model" in result.text
        assert 'line 12 `brick("3001", -1, 0, 0, 4)` (3001 at x=-1 y=0 z=0): x and y start at 0' in result.text
    assert {p.step for p in bench.pieces} == {0, 1, 2}

    before = list(bench.pieces)
    code = bench.workspace.build.script + "undefined()\n"
    broken = bench.run_script(code)
    assert "did not change" in broken.text and "line 13 `undefined()`: NameError" in broken.text
    assert bench.pieces == before
    assert Build.model_validate_json((bench.workspace.folder / BUILD).read_text()).script == code


def test_a_run_with_problems_in_every_step_leads_with_its_revision_and_stays_short(bench):
    code = "".join(f'step("Floor {n}")\nfor x in range(40):\n    brick("3001", -1, x, 0, 4)\n' for n in range(9))
    result = bench.run_script(code)
    revision = bench.workspace.build.revision[:8]
    assert (
        result.text.splitlines()[1]
        == f"Share {MODEL} to show revision {revision} to the user, then call look to see it."
    )
    assert "... and 348 more like these in steps 1, 2, 3, 4, 5, 6, 7, 8, 9." in result.text
    assert len(result.text) < 8000


def test_a_run_names_its_parts_so_a_color_passed_as_the_part_shows(bench):
    result = bench.run_script('WHITE = 15\nstep("Wall")\nfor z in range(0, 12, 4):\n    brick(WHITE, 0, 0, z, WHITE)\n')
    assert "Parts: 15 Minifig Hips and Legs" in result.text, result.text


def test_the_shared_model_holds_the_current_revision_and_every_part_it_uses(bench):
    bench.run_script(HOUSE)
    model = json.loads(gzip.decompress((bench.workspace.folder / MODEL).read_bytes()))
    build = bench.workspace.build
    assert model["revision"] == build.revision and len(model["pieces"]) == len(build.pieces)
    assert set(model["parts"]) == {"3004.dat", "3039.dat", "3069b.dat"}
    assert all(mpd.startswith("0 FILE brickyard.ldr") for mpd in model["parts"].values())
    assert "script" not in model and "messages" not in model


def test_a_step_builds_the_same_bricks_whatever_randomness_the_steps_before_it_use():
    trees = 'step("Trees")\nfor x in range(0, 30, 3):\n    brick("3062b", x, random.randint(0, 31), 0, 2)\n'

    def trees_after(draws: int) -> list:
        code = f'import random\nstep("Paving")\nfor _ in range({draws}):\n    random.random()\n{trees}'
        return script.run(code, [])["steps"][-1]["bricks"]

    assert trees_after(1) == trees_after(50)


def test_the_showcase_builds_but_is_not_a_verified_connected_assembly(bench):
    example = (Path(__file__).resolve().parents[2] / "agent" / "showcase" / "bag-end.py").read_text()
    result = bench.run_script(example)
    assert len(bench.workspace.build.pieces) > 10_000, result.text
    assert "No problems: every brick is known, fits" in result.text
    assert result.problems == 1 and "disconnected_model" in result.text


def test_the_prompt_names_only_real_parts_sizes_and_colors():
    prompt = (Path(__file__).resolve().parents[2] / "agent" / "holo.md").read_text()
    rows = re.findall(r"^- (\d+) tall[^:]*: (.*)$", prompt.split("\n## Parts")[1].split("\n## ")[0], re.MULTILINE)
    entries = [
        (part, (int(w), int(d)), int(height))
        for height, parts in rows
        for part, w, d in re.findall(r"\b(\d\w*) (\d+)x(\d+)\b", parts)
    ]
    assert len(entries) > 80 and len(entries) == sum(len(re.findall(r"\d+x\d+", parts)) for _, parts in rows)
    for part, size, height in entries:
        info = ldraw.info(f"{part}.dat")
        assert (info.footprint, info.plates) == (size, height), part
    palette = ldraw.colors()
    colors = prompt.split("\n## Colors")[1].split("\n#")[0].splitlines()
    for entry in (e for line in colors if line.startswith("- ") for e in line.split(": ")[1].split(", ")):
        code, name = entry.split(" ", 1)
        assert palette[int(code)][0].lower() == name, entry
