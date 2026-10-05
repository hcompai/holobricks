import gzip
import json
import re
from pathlib import Path

import pytest

from brickyard import catalog, ldraw, script
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
    assert (
        "brick 6 (3001 at x=10 y=10 z=6): no chain of stacked bricks from it reaches the ground or an earlier step"
        in result.text
    )
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
    assert first.problems == 0 and "roof top 18" in first.text, first.text
    assert [s.title for s in bench.workspace.build.steps] == ["Walls", "Roof", "Paving"]
    walls = [p for p in bench.pieces if p.step == 0]

    recolored = bench.run_script(HOUSE.replace("320", "4"))
    assert "kept step 1 unchanged, rebuilt and checked 2 steps" in recolored.text
    assert [p for p in bench.pieces if p.step == 0] == walls
    assert {p.color for p in bench.pieces if p.step == 1} == {4}

    stray = HOUSE.replace("320", "4") + 'brick("3001", -1, 0, 0, 4)\n'
    for _ in range(2):
        result = bench.run_script(stray)
        assert result.problems == 1 and "kept steps 1 to 2 unchanged, rebuilt and checked 1 step." in result.text
        assert 'line 12 `brick("3001", -1, 0, 0, 4)` (3001 at x=-1 y=0 z=0): x and y start at 0' in result.text
    assert {p.step for p in bench.pieces} == {0, 1, 2}

    before = list(bench.pieces)
    code = bench.workspace.build.script + "undefined()\n"
    broken = bench.run_script(code)
    assert "did not change" in broken.text and "line 13 `undefined()`: NameError" in broken.text
    assert bench.pieces == before
    assert Build.model_validate_json((bench.workspace.folder / BUILD).read_text()).script == code


def test_a_step_with_floating_bricks_is_rebuilt_and_reported_every_run(bench):
    code = 'step("Base")\nbrick("3001", 0, 0, 0, 4)\nstep("Lantern")\nbrick("3005", 10, 10, 6, 4)\n'
    bench.run_script(code)
    for _ in range(2):
        result = bench.run_script(code)
        assert "kept step 1 unchanged, rebuilt and checked 1 step." in result.text, result.text
        assert 'line 4 `brick("3005", 10, 10, 6, 4)` (3005 at x=10 y=10 z=6): no chain of stacked' in result.text


def test_solids_become_hollow_bonded_shells_that_give_way_to_placed_parts(bench):
    code = (
        'step("Ground")\ncover(box(0, 0, 16, 16), 0, 2)\nstep("House")\nfill(box(2, 2, 10, 8), 1, 12, 71)\n'
        'brick("60593", 4, 2, 4, 15)\nz = roof(box(2, 2, 10, 8), 13, 272, ridge="x")\nprint(z, top(6, 5))\n'
        'step("Plateau")\nfill(box(20, 0, 20, 20), 0, 9, 2)\nbrick("3001", 22, 2, 9, 4)\n'
    )
    result = bench.run_script(code)
    assert "No problems" in result.text and "Floating" not in result.text, result.text
    assert "\n25 25" in result.text
    house = [grid(p) for p in bench.pieces if p.step == 1]
    assert (4, 2, 4, 0) in house
    assert not any(x <= 6 < x + 2 and y <= 5 < y + 2 and z < 13 for x, y, z, _ in house)
    assert len(house) < 10 * 8 * 4


def test_solids_in_one_step_share_one_grid_of_whole_courses(bench):
    result = bench.run_script('step("Walls")\nfill(box(0, 0, 4, 4), 0, 3, 4)\nfill(box(0, 0, 4, 4), 4, 3, 4)\n')
    assert "line 3" in result.text and "solids come in whole bricks" in result.text, result.text


def test_problems_made_in_a_helper_name_each_line_that_called_it(bench):
    code = 'def column(x):\n    brick("3005", x, 0, 3, 4)\nstep("Columns")\ncolumn(0)\ncolumn(5)\n'
    result = bench.run_script(code)
    for line, x in ((4, 0), (5, 5)):
        cited = f'line 2 `brick("3005", x, 0, 3, 4)` from line {line} `column({x})` (3005 at x={x} y=0 z=3)'
        assert cited in result.text, result.text


def test_an_invalid_brick_is_rejected_by_its_line_and_the_rest_is_built(bench):
    code = (
        'step("Wall")\nbrick("3001", 0, 0, 0, 4)\nbrick("3001", 5 / 2, 0, 0, 4)\nbrick("3001", 8, 0, 0, None)\n'
        'step("Roof")\nbrick("3001", 0, 0, 3, 4)\n'
    )
    result = bench.run_script(code)
    assert 'line 3 `brick("3001", 5 / 2, 0, 0, 4)`: x 2.5: Input should be a valid integer' in result.text
    assert 'line 4 `brick("3001", 8, 0, 0, None)`: color None: Input should be a valid integer' in result.text
    assert [s.title for s in bench.workspace.build.steps] == ["Wall", "Roof"] and len(bench.pieces) == 2


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


def test_a_part_mounted_on_a_wall_face_hangs_there_without_raising_the_wall(bench):
    code = (
        'step("Tower")\nfor z in range(0, 12, 3):\n    brick("3003", 4, 4, z, 71)\n'
        'step("Clock")\nmount("4150p03", 4, 3, 4, 15, "south")\nprint("top", top(4, 3), top(4, 4))\n'
        'mount("3070b", 4, 3, 1, 15, "up")\n'
    )
    result = bench.run_script(code)
    assert "top 0 12" in result.text and "Floating" not in result.text, result.text
    assert "2 Clock: 1 piece, x 4-5, y 3-3, z 4-9" in result.text
    assert result.problems == 1 and "facing must be south, north, west or east" in result.text
    walls = {"south": ((4, 3), (4, 2)), "north": ((4, 6), (4, 7)), "west": ((3, 4), (2, 4)), "east": ((6, 4), (7, 4))}
    for facing, (backed, away) in walls.items():
        for (x, y), floats in ((backed, False), (away, True)):
            moved = bench.run_script(code.replace('4, 3, 4, 15, "south"', f'{x}, {y}, 4, 15, "{facing}"'))
            assert moved.problems == 1 and "2 Clock: 1 piece" in moved.text, moved.text
            assert ("nothing behind it" in moved.text) == floats, (facing, x, y)


def test_a_model_copied_as_exact_placements_rebuilds_the_same_pieces_and_takes_edits(bench, tmp_path):
    built = bench.run_script(
        'step("Base")\nbrick("3001", 10, 10, 0, 4)\nbrick("3001", 14, 10, 0, 4, 90)\n'
        'step("Window and finial")\nbrick("60592", 10, 10, 3, 15)\n'
        'place("3024", 15, (260.5, -32, 230.25), (0.707107, 0, 0.707107, 0, 1, 0, -0.707107, 0, 0.707107))\n'
    )
    assert built.problems == 0 and "Floating" not in built.text, built.text
    tinted = [p.model_copy(update={"color": 40}) if p.part == "60601.dat" else p for p in bench.pieces]
    copied = "".join(
        f"step({json.dumps(s.title)})\n"
        + "".join(f"place({p.part!r}, {p.color}, {p.pos}, {p.rot})\n" for p in tinted if p.step == s.index)
        for s in bench.workspace.build.steps
    )
    (tmp_path / "copy").mkdir()
    copy = Workbench(Workspace.open(tmp_path / "copy"))
    result = copy.run_script(copied)
    assert result.problems == 0 and "Floating" not in result.text, result.text
    assert copy.pieces == tinted and [p.part for p in copy.pieces].count("60601.dat") == 1
    assert [s.title for s in copy.workspace.build.steps] == ["Base", "Window and finial"]

    edited = copy.run_script(copied + 'step("Roof")\nbrick("3001", 10, 10, top(10, 10), 4)\n')
    assert edited.problems == 0 and "kept steps 1 to 2 unchanged" in edited.text, edited.text
    assert grid(copy.pieces[-1]) == (10, 10, 9, 0)


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


@pytest.mark.skipif(not catalog.SNAPSHOT.exists(), reason="catalog snapshot not built")
def test_the_showcase_builds_with_no_problems_against_the_real_catalog(tmp_path):
    example = (Path(__file__).resolve().parents[2] / "agent" / "showcase" / "bag-end.py").read_text()
    bench = Workbench(Workspace.open(tmp_path))
    result = bench.run_script(example)
    assert len(bench.workspace.build.pieces) > 7_000, result.text
    assert result.problems == 0 and "No problems: every brick is known, fits" in result.text, result.text


@pytest.mark.skipif(not catalog.SNAPSHOT.exists(), reason="catalog snapshot not built")
def test_the_prompts_example_builds_with_no_problems_and_nothing_floating(tmp_path):
    prompt = (Path(__file__).resolve().parents[2] / "agent" / "holo.md").read_text()
    example = prompt.split("\nExample: ")[1].split("```python\n")[1].split("```")[0]
    bench = Workbench(Workspace.open(tmp_path))
    result = bench.run_script(example)
    assert result.problems == 0 and "Floating" not in result.text, result.text
    assert len(bench.pieces) > 3_000, result.text


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


def test_recovery_keeps_the_script_for_the_shared_geometry_after_a_failed_edit(bench, tmp_path):
    from brickyard.workspace import bundle

    bench.run_script(HOUSE)
    before = bench.workspace.build
    bench.run_script(HOUSE + '\nraise RuntimeError("unfinished edit")')
    model = json.loads(gzip.decompress((bench.workspace.folder / MODEL).read_bytes()))
    assert model["recovery"] == {"version": 1, "revision": before.revision, "script": HOUSE}
    assert "recovery" not in bundle(bench.workspace.build)
    assert "recovery_script" not in model and "script" not in model and "messages" not in model
    target = tmp_path / "replacement"
    target.mkdir()
    restored = Workspace.open(target)
    restored.restore(bench.workspace.folder / MODEL)
    assert restored.build.pieces == before.pieces
    assert restored.build.steps == before.steps
    assert (target / "build.py").read_text() == HOUSE
    assert Workbench(restored).run_script(HOUSE).problems == 0
    assert restored.build.revision == before.revision


def test_recovery_rejects_mismatched_revisions_and_does_not_overwrite_a_workspace(bench, tmp_path):
    bench.run_script(HOUSE)
    model = json.loads(gzip.decompress((bench.workspace.folder / MODEL).read_bytes()))
    target = tmp_path / "replacement"
    target.mkdir()
    attachment = tmp_path / "checkpoint.json"
    model["recovery"]["revision"] = "wrong"
    attachment.write_text(json.dumps(model))
    with pytest.raises(ValueError, match="does not match"):
        Workspace.open(target).restore(attachment)
    assert not list(target.iterdir())
    model["recovery"]["revision"] = model["revision"]
    attachment.write_text(json.dumps(model))
    Workspace.open(target).restore(attachment)
    with pytest.raises(ValueError, match="fresh workspace"):
        Workspace.open(target).restore(attachment)
    assert (target / "build.py").read_text() == HOUSE
