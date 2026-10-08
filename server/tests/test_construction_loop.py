import gzip
import json
import sys
import time
from itertools import permutations

import pytest

from brickyard import catalog, client, ldraw
from brickyard.model import Build, Piece
from brickyard.workbench import Workbench
from brickyard.workspace import BUILD, MODEL, Workspace

pytestmark = pytest.mark.skipif(not ldraw.LDRAW.exists(), reason="LDraw library not downloaded")

CORE = 'step("Core")\nbrick("3001", 0, 0, 0, 4)\n'


@pytest.fixture
def bench(tmp_path, offline_catalog):
    return Workbench(Workspace.open(tmp_path))


def saved(bench) -> Build:
    return Build.model_validate_json((bench.workspace.folder / BUILD).read_text())


def test_additions_cannot_publish_invalid_catalog_pairs(bench):
    bench.run_script(CORE)
    before = saved(bench)
    result = bench.add("Invalid", [{"part": "3001", "x": 5, "y": 0, "z": 0, "color": 503}])
    assert result.problems and "Verified choices" in result.text
    assert bench.workspace.build == before == saved(bench)


def test_inherited_invalid_inventory_blocks_even_a_valid_addition(bench):
    bench.run_script(CORE)
    bench.workspace.save(
        bench.workspace.build.model_copy(update={"pieces": [bench.pieces[0].model_copy(update={"color": 503})]})
    )
    before = saved(bench)
    assert bench.add("Valid new brick", [{"part": "3001", "x": 5, "y": 0, "z": 0, "color": 4}]).problems
    assert bench.workspace.build == before == saved(bench)


def test_automatically_inserted_glass_must_also_have_a_verified_catalog_color(bench, offline_catalog):
    offline_catalog["60601.dat"]["colors"] = []
    bench.run_script(CORE)
    before = saved(bench)
    result = bench.add("Window", [{"part": "60592", "x": 5, "y": 0, "z": 0, "color": 15}])
    assert result.problems and "60601.dat" in result.text
    assert bench.workspace.build == before == saved(bench)


def test_a_run_reports_a_piece_in_an_unverified_color_with_the_verified_choices(bench):
    result = bench.run_script(CORE.replace(", 4)", ", 503)"))
    assert result.problems == 1 and "not a known color" in result.text and "14 Yellow" in result.text
    assert 'From line 2 `brick("3001", 0, 0, 0, 503)`' in result.text
    assert [p.color for p in bench.pieces] == [503]
    assert not bench.run_script(CORE.replace(", 4)", ", 14)")).problems
    choices = bench.catalog_colors("3001")
    assert not choices.problems and "14 Yellow" in choices.text
    assert not bench.check_catalog().problems


def test_a_missing_catalog_is_a_problem_to_report_not_a_design_to_change(bench, monkeypatch):
    def unavailable():
        raise catalog.CatalogUnavailable("No readable catalog snapshot")

    monkeypatch.setattr(catalog, "snapshot", unavailable)
    result = bench.run_script(CORE.replace(", 4)", ", 14)"))
    assert result.problems and "No readable catalog snapshot" in result.text
    assert "do not change the design" in result.text


@pytest.mark.parametrize(
    "bad",
    ['brick("3001", 0, 0, 0, 14)', 'brick("missing-part", 8, 0, 0, 14)'],
    ids=["collision", "unknown part"],
)
def test_a_run_keeps_the_bricks_that_fit_and_names_the_line_of_each_one_that_does_not(bench, bad):
    assert not bench.run_script(CORE).problems
    result = bench.run_script(CORE + 'step("Detail")\nbrick("3001", 0, 0, 3, 14)\n' + bad + "\n")
    assert result.problems == 1 and f"line 5 `{bad}`" in result.text
    assert len(bench.pieces) == 2 and saved(bench).pieces == bench.pieces
    assert [s.title for s in saved(bench).steps] == ["Core", "Detail"]


def test_a_run_writes_the_complete_revision_once(bench, monkeypatch):
    bench.run_script(CORE)
    writes = []
    save = Workspace.save

    def record(self, build=None):
        writes.append((build or self.build).model_copy(deep=True))
        save(self, build)

    monkeypatch.setattr(Workspace, "save", record)
    code = CORE + 'step("Top")\nbrick("3001", 0, 0, 3, 15)\nstep("Side")\nbrick("3001", 5, 0, 0, 14)\n'
    result = bench.run_script(code)
    assert result.problems == 0
    assert len(writes) == 1 and len(writes[0].steps) == len(writes[0].pieces) == 3 and writes[0].script == code


def test_a_failed_write_keeps_the_accepted_model(bench, monkeypatch):
    bench.run_script(CORE)
    before = bench.workspace.build

    def fail(*args):
        raise OSError("disk unavailable")

    monkeypatch.setattr("brickyard.workspace.write", fail)
    with pytest.raises(OSError, match="disk unavailable"):
        bench.run_script(CORE.replace(", 4)", ", 15)"))
    assert bench.workspace.build == before == saved(bench)


def test_geometry_changes_move_the_time_of_change_and_failed_or_unchanged_edits_do_not(bench, monkeypatch):
    now = [100.0]
    monkeypatch.setattr("brickyard.workspace.time.time", lambda: now[0])
    bench.run_script(CORE)
    assert bench.workspace.build.updated == 100.0
    now[0] = 200.0
    bench.run_script(CORE + 'brick("3001", 0, 0, 0, 14)')
    bench.run_script(CORE + "# same geometry\n")
    assert bench.workspace.build.updated == 100.0
    bench.run_script(CORE.replace(", 4)", ", 14)"))
    assert bench.workspace.build.updated == saved(bench).updated == 200.0
    now[0] = 300.0
    bench.run_script("")
    assert bench.workspace.build.updated == 300.0 and saved(bench).pieces == []


def test_same_count_recolors_moves_and_turns_change_the_revision():
    piece = Piece(id=1, part="3001.dat", color=4, pos=(20, 0, 20), step=0)
    seen = {
        Build(pieces=[p]).revision
        for p in (
            piece,
            piece.model_copy(update={"color": 14}),
            piece.model_copy(update={"pos": (40, 0, 20)}),
            piece.model_copy(update={"rot": (0, 0, 1, 0, 1, 0, -1, 0, 0)}),
        )
    }
    assert len(seen) == 4


def test_support_is_checked_on_the_complete_step_in_any_line_order(bench):
    for heights in permutations((0, 3, 6)):
        code = 'step("Stack")\n' + "".join(f'brick("3001", 0, 0, {z}, 4)\n' for z in heights)
        result = bench.run_script(code)
        assert result.problems == 0, result.text
        assert "Support warnings" not in result.text
        assert len(bench.pieces) == 3


def test_floating_bricks_remain_visible_and_warn_without_failing_the_run(bench):
    result = bench.run_script('step("Floating pair")\nbrick("3001", 0, 0, 6, 4)\nbrick("3001", 0, 0, 9, 4)')
    assert result.problems == 0 and "Support warnings: 2 pieces in 1 possibly detached group" in result.text
    assert "No problems" not in result.text
    assert len(bench.pieces) == 2


def test_support_checks_the_final_model_not_the_drawing_order(bench):
    result = bench.run_script('step("Top first")\nbrick("3001", 0, 0, 3, 4)\n' + CORE)
    assert result.problems == 0 and "Support warnings" not in result.text
    # Removing that support must also recheck the unchanged top.
    result = bench.run_script('step("Top first")\nbrick("3001", 0, 0, 3, 4)\n')
    assert result.problems == 0 and "Support warnings: 1 piece" in result.text
    assert "Group 1: 1 piece; steps 1;" in result.text


def test_fixed_manual_steps_survive_script_rejection_and_script_removal(bench):
    bench.add("Manual base", [{"part": "3001", "x": 0, "y": 0, "z": 0, "color": 4}])
    fixed = list(bench.pieces)
    assert bench.run_script(CORE).problems
    assert bench.pieces == fixed
    assert not bench.run_script('step("Top")\nbrick("3001", 0, 0, 3, 15)').problems
    assert not bench.run_script("").problems
    assert bench.pieces == fixed
    assert [s.title for s in bench.workspace.build.steps] == ["Manual base"]


def test_part_search_resolves_exact_ids_alias_spelling_and_dimensions(monkeypatch):
    titles = {
        "87081.dat": "Brick 4 x 4 Round with Pinhole and Snapstud",
        "tyre.dat": "Tyre 14 x 4 Smooth",
        "face.dat": "Minifig Head Tired",
        "small.dat": "Tile 1 x 2 Round",
        "round.dat": "Tile 2 x 2 Round with Hole",
        "large.dat": "Tile 2 x 20 Round",
    }
    monkeypatch.setattr(ldraw, "catalog", lambda: titles)
    monkeypatch.setattr(ldraw, "_index", lambda: dict.fromkeys(titles))
    assert ldraw.search("parts/87081.DAT") == ["87081.dat"]
    assert ldraw.search("87081") == ["87081.dat"]
    assert ldraw.search("tire") == ldraw.search("tyre") == ["tyre.dat"]
    assert ldraw.search("round 2x2") == ["round.dat"]
    assert ldraw.search("") == []


def test_bricks_works_on_the_build_in_its_directory_and_exits_1_on_problems(
    tmp_path, monkeypatch, offline_catalog, capsys
):
    monkeypatch.chdir(tmp_path)

    def bricks(*args: str) -> int:
        monkeypatch.setattr(sys, "argv", ["bricks", *args])
        with pytest.raises(SystemExit) as exit:
            client.main()
        return exit.value.code

    (tmp_path / "build.py").write_text(CORE)
    assert bricks("run") == 1 and "Name the build first" in capsys.readouterr().err
    assert bricks("name", "Red brick") == 0 and saved(Workbench(Workspace.open(tmp_path))).name == "Red brick"
    assert bricks("run") == 0
    assert f"Share {MODEL}" in capsys.readouterr().out
    assert json.loads(gzip.decompress((tmp_path / MODEL).read_bytes()))["parts"].keys() == {"3001.dat"}
    (tmp_path / "loose.py").write_text(CORE + 'step("Loose")\nbrick("3001", 8, 0, 0, 4)\n')
    assert bricks("run", "loose.py") == 0
    assert "disconnected_model" not in capsys.readouterr().out
    assert bricks("assembly") == 1 and "disconnected_model" in capsys.readouterr().out
    (tmp_path / "outside.py").write_text(CORE + 'brick("3001", -1, 0, 0, 4)\n')
    assert bricks("run", "outside.py") == 1
    (tmp_path / "floating.py").write_text(CORE + 'step("Floating")\nbrick("3001", 8, 0, 6, 4)\n')
    capsys.readouterr()
    assert bricks("run", "floating.py") == 0
    output = capsys.readouterr().out
    assert "Support warnings" in output and "No problems" not in output
    assert f"Share {MODEL}" in output
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"revision": "stale", "root": "model", "groups": []}))
    assert bricks("assembly", str(plan)) == 1
    (tmp_path / client.CLOCK).write_text(json.dumps({"started": time.time() - 150 * 60, "minutes": 180}))
    bricks("run")
    capsys.readouterr()
    bricks("run")
    assert capsys.readouterr().out.startswith("Run 2 · 150 of 180 min used: start nothing new")


def test_part_search_lists_only_parts_sold_in_real_sets_with_their_number_of_colors(bench):
    hits = bench.find_parts("tile 1 x 2").text.splitlines()
    assert hits and all(line.endswith("| in 7 colors") for line in hits), hits
    assert {line.split(":")[0] for line in hits} <= {"3069", "3069a", "3069b", "3069bp01"}
    assert bench.find_parts("3005").text.endswith("| in 0 colors")


@pytest.mark.parametrize("part", ["4282", "3034", "3020"])
def test_popemobile_plate_ids_resolve_to_real_geometry(part):
    assert ldraw.search(part) == [part + ".dat"]
    assert "0 FILE " + part + ".dat" in ldraw.pack(part + ".dat")
