import copy
import json

import pytest

from brickyard import assembly, ldraw
from brickyard.assembly import Group, Operation, Plan
from brickyard.connectors import Library
from brickyard.model import Build, place


@pytest.fixture
def library():
    lib = Library()
    assert (lib.folder / "LICENSE.md").exists(), "Run python3 scripts/fetch-connectors.py"
    assert ldraw.LDRAW.exists(), "Run scripts/fetch-ldraw.sh"
    return lib


def model(*placements):
    b = Build(name="Assembly test")
    b.add_step("Drawing order is not a physical assembly plan", list(placements))
    return b


def plan(b, *ids):
    return Plan(
        revision=b.revision, groups=[Group(id="model", title="Model", operations=[Operation(part=i) for i in ids])]
    )


def test_real_connectors_and_square_antistuds(library):
    assert len(library.profile("3001.dat").ports) == 16
    assert [p.gender for p in library.profile("3070b.dat").ports] == ["F"]
    b = model(place("3024.dat", 0, 0, 0, 4), place("3005.dat", 0, 0, 1, 4), place("3070b.dat", 0, 0, 4, 4))
    r = assembly.check(b, library=library)
    assert r.status == "verified", r
    assert [o.part for o in r.plan.groups[0].operations] == [1, 2, 3]
    assert r.plan.groups[0].operations[1].approach == (0, -1, 0)


def test_body_contact_is_not_connection(library):
    b = model(place("3001.dat", 0, 0, 0, 4), place("3001.dat", 4, 0, 0, 4))
    assert assembly.check(b, library=library).issues[0].code == "disconnected_model"
    # Half-stud offset touches a lower surface but misses the actual sockets.
    b.pieces[1] = place("3001.dat", 0, 0, 3, 4).model_dump() | {"id": 2, "step": 0}
    from brickyard.model import Piece

    b.pieces[1] = Piece.model_validate(b.pieces[1])
    b.pieces[1].pos = (50, -48, 20)
    assert assembly.check(b, library=library).status == "unverified"


def test_roof_blocks_insertion_but_reorder_works(library):
    # Long base, one pillar and roof are connected; the late second pillar is
    # trapped between studs facing in opposite directions.
    b = model(
        place("3001.dat", 0, 0, 0, 4),
        place("3005.dat", 0, 0, 3, 4),
        place("3001.dat", 0, 0, 6, 4),
        place("3005.dat", 3, 0, 3, 4),
    )
    bad = assembly.check(b, plan(b, 1, 2, 3, 4), library)
    assert bad.status == "unverified" and bad.issues[0].operation == 4
    good = assembly.check(b, plan(b, 1, 2, 4, 3), library)
    assert good.status == "verified", good
    assert assembly.check(b, library=library).status == "verified"


def test_subassembly_coverage_and_attachment(library):
    b = model(place("3001.dat", 0, 0, 0, 4), place("3001.dat", 0, 0, 3, 4), place("3001.dat", 0, 0, 6, 4))
    p = Plan(
        revision=b.revision,
        groups=[
            Group(id="top", title="Upper unit", operations=[Operation(part=2), Operation(part=3)]),
            Group(id="model", title="Final", operations=[Operation(part=1), Operation(assembly="top")]),
        ],
    )
    r = assembly.check(b, p, library)
    assert r.status == "verified", r
    assert sum(op.part is not None for g in r.plan.groups for op in g.operations) == 3
    assert r.plan.groups[1].operations[1].approach == (0, -1, 0)
    # An attachment references the existing physical unit; it is not new stock.
    bad = p.model_copy(deep=True)
    bad.groups[1].operations.append(Operation(assembly="top"))
    assert assembly.check(b, bad, library).issues[0].code == "duplicate_assembly"


@pytest.mark.parametrize("ids", [[1, 1], [1], [1, 2, 99]])
def test_exact_coverage(library, ids):
    b = model(place("3001.dat", 0, 0, 0, 4), place("3001.dat", 0, 0, 3, 4))
    assert assembly.check(b, plan(b, *ids), library).issues[0].code == "coverage"


def test_cycles_staleness_and_collision_fail_closed(library):
    b = model(place("3001.dat", 0, 0, 0, 4), place("3001.dat", 0, 0, 3, 4))
    p = plan(b, 1, 2)
    p.groups[0].operations.append(Operation(assembly="model"))
    assert assembly.check(b, p, library).issues[0].code == "invalid_tree"
    p = assembly.check(b, library=library).plan
    p.evidence = "wrong-data"
    assert assembly.check(b, p, library).issues[0].code == "stale_evidence"
    b.pieces[1].color = 14
    assert assembly.check(b, p, library).issues[0].code == "stale_plan"
    # Add a coincident brick: matching studs do not excuse solid-body overlap.
    b = model(place("3001.dat", 0, 0, 0, 4), place("3001.dat", 0, 0, 3, 4), place("3001.dat", 0, 0, 3, 4))
    assert assembly.check(b, library=library).status == "unverified"


def test_clearance_blocker_without_an_extra_connection(library):
    b = model(
        place("3001.dat", 0, 0, 0, 4),
        place("3005.dat", 0, 0, 3, 4),
        place("3001.dat", 0, 0, 6, 4),
        place("3024.dat", 3, 0, 3, 4),
    )
    r = assembly.check(b, plan(b, 1, 2, 3, 4), library)
    assert r.issues[0].code == "blocked_insertion"
    assert r.issues[0].moving == [4] and r.issues[0].obstacles == [3]
    assert assembly.check(b, plan(b, 1, 2, 4, 3), library).status == "verified"


def test_unsupported_rotation_data_and_empty_fail_closed(library, tmp_path):
    b = model(place("3001.dat", 0, 0, 0, 4))
    assert assembly.check(b, library=Library(tmp_path)).issues[0].code == "data_unavailable"
    b.pieces[0].rot = (1, 0, 0, 0, 1, 0, 0, 0, 2)
    assert assembly.check(b, library=library).issues[0].code == "unsupported_orientation"
    assert assembly.check(Build(), library=library).status == "unverified"


def test_deterministic_plan_does_not_edit_build(library):
    b = model(place("3020.dat", 0, 0, 0, 4), place("3005.dat", 0, 0, 1, 4), place("3005.dat", 3, 1, 1, 4))
    before = copy.deepcopy(b.model_dump())
    a = assembly.check(b, library=library)
    c = assembly.check(b, library=library)
    assert a.status == "verified" and a == c
    assert b.model_dump() == before


def test_real_side_stud_insertion_and_mirrored_pieces(library):
    from brickyard.model import FACINGS, Placement

    b = model(
        Placement(part="87087.dat", color=15, pos=(0, 0, 0)),
        Placement(part="3070b.dat", color=4, pos=(0, 10, -18), rot=FACINGS["south"]),
    )
    result = assembly.check(b, plan(b, 1, 2), library)
    assert result.status == "verified", result
    assert result.plan.groups[0].operations[1].approach == (0, 0, -1)
    b.pieces[1].rot = (-1, 0, 0, 0, 1, 0, 0, 0, 1)
    assert assembly.check(b, library=library).issues[0].code == "unsupported_orientation"


def test_nested_shadow_includes_do_not_manufacture_connectors(tmp_path):
    (tmp_path / "LICENSE.md").write_text("Test fixture, no upstream data")
    (tmp_path / "p").mkdir()
    (tmp_path / "p/first.dat").write_text("0 !LDCAD SNAP_INCL [ref=second.dat]\n")
    (tmp_path / "p/second.dat").write_text("0 !LDCAD SNAP_CYL [gender=M] [secs=R 6 4]\n")
    profile = Library(tmp_path).profile("first.dat", only_shadow=True)
    assert profile.ports == () and profile.unsupported


def test_saved_order_is_rechecked_without_reusing_an_old_proof(library, tmp_path):
    b = model(place("3001.dat", 0, 0, 0, 4), place("3001.dat", 0, 0, 3, 4))
    report = assembly.check(b, library=library)
    assembly.save_report(tmp_path, report)
    saved = assembly.cached_plan(tmp_path, b)
    assert saved.evidence is None
    assert assembly.check(b, saved, library).evidence == report.evidence
    b.pieces[0].color = 14
    assert assembly.cached_plan(tmp_path, b) is None


def test_hollow_round_brick_still_accepts_a_standard_stud(library):
    profile = library.profile("3062b.dat")
    assert any(p.gender == "F" and p.pos == (0, 24, 0) and p.depth == 20 for p in profile.ports)
    b = model(place("3024.dat", 0, 0, 0, 4), place("3062b.dat", 0, 0, 1, 4))
    result = assembly.check(b, plan(b, 1, 2), library)
    assert result.status == "verified", result


def test_disconnected_feedback_names_a_real_other_component(library):
    b = model(place("3001.dat", 0, 0, 0, 4), place("3001.dat", 0, 0, 3, 4), place("3001.dat", 8, 0, 0, 4))
    result = assembly.check(b, library=library)
    issue = result.issues[0]
    assert "2 separate islands" in issue.message
    assert issue.moving == [3] and issue.obstacles == [1]


@pytest.mark.parametrize("changed", ["3005.dat", "stud.dat"])
def test_warm_geometry_changes_block_old_and_new_proofs(library, tmp_path, monkeypatch, changed):
    from brickyard import assembly_geometry

    b = model(place("3005.dat", 0, 0, 0, 4), place("3005.dat", 0, 0, 3, 4))
    files = {}

    def collect(name):
        if name in files:
            return
        files[name] = "\n".join(ldraw.read(name)) + "\n"
        for _, child in ldraw._references(name):
            collect(child)

    collect("3005.dat")
    index = {}
    for name, content in files.items():
        path = tmp_path / "parts" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        index[name] = str(path.relative_to(tmp_path))
    (tmp_path / "brickyard-index.json").write_text(json.dumps(index))
    monkeypatch.setattr(ldraw, "LDRAW", tmp_path)

    def clear():
        ldraw._index.cache_clear()
        ldraw.read.cache_clear()
        assembly_geometry.polygons.cache_clear()
        assembly_geometry.local_envelopes.cache_clear()

    clear()
    try:
        reused = Library()
        first = assembly.check(b, library=reused)
        assert first.status == "verified"
        path = tmp_path / "parts" / changed
        path.write_text(path.read_text() + "4 16 -10 -30 -10 10 -30 -10 10 24 10 -10 24 10\n")
        # Both a fresh resolver and a reused one must reject warmed mesh caches.
        for resolver in (Library(), reused):
            for proposal in (first.plan, None):
                result = assembly.check(b, proposal, resolver)
                assert result.status == "unverified"
                assert result.issues[0].code == "geometry_changed"
                assert result.evidence is None
        # A new process can load the updated data but cannot reuse the old proof.
        clear()
        assert assembly.check(b, first.plan).issues[0].code == "stale_evidence"
        assert assembly.check(b).status == "unverified"
    finally:
        clear()
