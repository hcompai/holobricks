"""Regression cases for detached groups seen in shared production builds."""

import pytest

from brickyard import ldraw, support
from brickyard.model import Build, Placement, mount, place, with_accessories
from brickyard.workbench import Workbench, _floating
from brickyard.workspace import Workspace

pytestmark = pytest.mark.skipif(not ldraw.LDRAW.exists(), reason="LDraw library not downloaded")


def model(*placements):
    build = Build()
    for p in placements:
        build.add_step("Separate script step", [p])
    return build


def test_stadium_roof_overhang_with_no_contact_to_the_bowl():
    # Coordinates from revision 68d69211: a roof plate and attached white brick
    # sit beside the nearest concrete post, with nothing beneath the roof island.
    build = model(
        place("14716.dat", 11, 35, 0, 71),
        place("14716.dat", 11, 35, 9, 71),
        place("14716.dat", 11, 35, 18, 71),
        Placement(part="3022.dat", color=272, pos=(240, -224, 740)),
        Placement(part="3005.dat", color=15, pos=(230, -248, 730)),
    )
    assert [[p.id for p in group] for group in support.detached(build.pieces)] == [[4, 5]]


def test_hollow_bridge_hanging_pieces_and_separate_ground_objects_are_allowed():
    build = model(
        place("3005.dat", 0, 0, 0, 4),
        place("3005.dat", 0, 0, 3, 4),
        place("3001.dat", 0, 0, 6, 4),  # spans empty space
        place("3005.dat", 3, 0, 3, 4),  # hangs from the far end
        place("3001.dat", 10, 10, 0, 4),
    )
    assert support.detached(build.pieces) == []
    assert support.detached(list(reversed(build.pieces))) == []


def test_mounted_parts_do_not_anchor_a_floating_wall():
    for bottom, expected in ((0, []), (3, [[1, 2]])):
        build = model(place("14716.dat", 4, 4, bottom, 71), mount("3070b.dat", 4, 3, bottom + 2, 15, "south"))
        assert [[p.id for p in g] for g in support.detached(build.pieces)] == expected


def test_window_glass_follows_its_frame_without_becoming_a_ground_anchor():
    for bottom, expected in ((0, []), (3, [[1, 2]])):
        build = model(*with_accessories(place("60592.dat", 2, 2, bottom, 15)))
        assert [[p.id for p in g] for g in support.detached(build.pieces)] == expected


def test_report_includes_each_affected_step_even_after_many_repeated_parts():
    build = Build()
    build.add_step("Roof", [place("3024.dat", x, 0, 10, 15) for x in range(100)])
    build.add_step("Building", [place("3005.dat", 1, 10, 10, 15)])
    report = _floating(support.detached(build.pieces), {})
    assert "101 pieces in 101 possibly detached groups" in report
    assert "Group 1: 1 piece; steps 1;" in report and "Group 101: 1 piece; steps 2;" in report
    assert "look box [0, 0, 0, 2, 2, 12]" in report
    assert "look box [0, 9, 0, 3, 12, 14]" in report
    assert "89 more groups not shown" in report
    assert len(report) < 2500


def test_floating_chain_across_steps_and_inherited_steps_warns_every_run(tmp_path, monkeypatch):
    monkeypatch.setattr("brickyard.catalog.validate", lambda pieces: {"valid": True, "issues": [], "inventory": []})
    bench = Workbench(Workspace.open(tmp_path))
    code = 'step("Floating base")\nbrick("3001", 0, 0, 3, 4)\nstep("Top")\nbrick("3001", 0, 0, 6, 4)\n'
    for _ in range(2):
        result = bench.run_script(code)
        assert result.problems == 0 and "Support warnings: 2 pieces" in result.text
        assert "Group 1: 2 pieces; steps 1, 2;" in result.text
        assert "No problems" not in result.text
    # Old/copied/manual steps must be checked even though the script leaves them alone.
    for step in bench.workspace.build.steps:
        step.key = None
    result = bench.run_script('step("Other object")\nbrick("3001", 8, 0, 0, 4)\n')
    assert result.problems == 0 and "Support warnings: 2 pieces" in result.text
    assert "No problems" not in result.text


def test_add_rechecks_the_whole_model_when_later_steps_add_support(tmp_path, monkeypatch):
    monkeypatch.setattr("brickyard.catalog.validate", lambda pieces: {"valid": True, "issues": [], "inventory": []})
    bench = Workbench(Workspace.open(tmp_path))
    for z in (6, 3, 0):
        result = bench.add("Stack from the top down", [{"part": "3001", "x": 0, "y": 0, "z": z, "color": 4}])
        assert result.problems == 0
        assert ("Support warnings" in result.text) == (z > 0)
        if z == 3:
            assert "Group 1: 2 pieces; steps 1, 2;" in result.text
    assert support.detached(bench.pieces) == []


def test_grounded_does_not_claim_legal_stud_alignment():
    # This limited check must not be confused with bricks assembly's stronger
    # connection check: bbox contact still accepts a half-stud offset.
    build = model(place("3001.dat", 0, 0, 0, 4), Placement(part="3001.dat", color=4, pos=(50, -48, 20)))
    assert support.detached(build.pieces) == []
