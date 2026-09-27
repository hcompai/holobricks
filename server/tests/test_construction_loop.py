import asyncio
import base64
import json
import sys
import threading
from itertools import permutations

import pytest

from brickyard import client, ldraw
from brickyard.model import Build, Piece
from brickyard.session import Session, Store
from brickyard.workbench import Workbench


@pytest.fixture
def bench(tmp_path, monkeypatch):
    if not ldraw.LDRAW.exists():
        pytest.skip("LDraw library not downloaded")
    session = Session(Build(), Store(tmp_path))
    monkeypatch.setattr(session, "render", lambda *args: asyncio.sleep(0))
    return Workbench(session)


CORE = 'step("Core")\nbrick("3001", 0, 0, 0, 4)\n'


def test_same_count_geometry_changes_cannot_answer_an_old_render(tmp_path):
    async def run():
        piece = Piece(id=1, part="3001.dat", color=4, pos=(20, 0, 20), step=0)
        session = Session(Build(pieces=[piece]), Store(tmp_path))
        old = session.build.revision
        waiting = asyncio.create_task(session.render(timeout=2))
        await asyncio.sleep(0)
        event = session.subscribe().get_nowait()
        session.build.pieces = [piece.model_copy(update={"color": 14})]
        assert session.build.revision != old and len(session.build.pieces) == event["pieces"]
        assert not session.deliver_render(event["request"], b"old pixels", 1, old)
        assert not session.deliver_render(event["request"], b"new pixels", 1, session.build.revision)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        color_revision = session.build.revision
        session.build.pieces[0].pos = (40, 0, 20)
        assert session.build.revision != color_revision
        moved = session.build.revision
        session.build.pieces[0].rot = (0, 0, 1, 0, 1, 0, -1, 0, 0)
        assert session.build.revision != moved

    asyncio.run(run())


def test_checked_revision_only_tracks_geometry_that_passed_transaction(bench):
    async def run():
        await bench.run_script(CORE)
        valid = bench.session.build.revision
        assert bench.session.build.checked_revision == valid
        await bench.run_script(CORE + 'brick("3001", 0, 0, 0, 15)')
        assert bench.session.build.checked_revision == bench.session.build.revision == valid
        bench.session.build.pieces[0].color = 15
        assert bench.session.build.checked_revision != bench.session.build.revision

    asyncio.run(run())


@pytest.mark.parametrize(
    "bad",
    [
        'brick("3001", 0, 0, 0, 14)',  # collision in a later step
        'brick("missing-part", 8, 0, 0, 14)',
        'raise ValueError("broken script")',
    ],
)
def test_rejected_candidate_preserves_model_disk_script_and_event_stream(bench, bad):
    async def run():
        assert not (await bench.run_script(CORE)).problems
        saved = bench.session.build.model_dump_json()
        on_disk = bench.session.store.load(bench.session.build.id).model_dump_json()
        queue = bench.session.subscribe()
        candidate = CORE.replace(", 4)", ", 15)") + 'step("Detail")\n' + bad + "\n"
        rejected = await bench.run_script(candidate)
        assert rejected.problems > 0
        assert "did not change" in rejected.text
        assert not rejected.images
        assert bench.session.build.model_dump_json() == saved
        assert bench.session.store.load(bench.session.build.id).model_dump_json() == on_disk
        assert queue.empty(), "A rejected candidate must not reach the viewer, even temporarily"

        accepted = await bench.run_script(CORE + 'step("Detail")\nbrick("3001", 0, 0, 3, 14)\n')
        assert accepted.problems == 0
        assert len(bench.pieces) == 2
        assert bench.session.store.load(bench.session.build.id).pieces == bench.pieces
        assert queue.get_nowait()["type"] == "rewind"
        event = queue.get_nowait()
        assert event["type"] == "step" and event["step"]["title"] == "Detail"

    asyncio.run(run())


def test_commit_saves_only_the_complete_revision_and_preserves_chat(bench, monkeypatch):
    async def run():
        await bench.run_script(CORE)
        await bench.session.say("User context", role="user")
        snapshots = []
        save = bench.session.store.save

        def record(build):
            snapshots.append(build.model_copy(deep=True))
            save(build)

        monkeypatch.setattr(bench.session.store, "save", record)
        code = CORE + 'step("Top")\nbrick("3001", 0, 0, 3, 15)\nstep("Side")\nbrick("3001", 5, 0, 0, 14)\n'
        assert not (await bench.run_script(code)).problems
        assert len(snapshots) == 1
        assert len(snapshots[0].steps) == len(snapshots[0].pieces) == 3
        assert snapshots[0].script == code
        assert snapshots[0].messages[-1].text == "User context"

    asyncio.run(run())


def test_committed_geometry_refreshes_thumbnail_timestamp_but_failed_or_unchanged_edits_do_not(bench, monkeypatch):
    now = [100.0]
    monkeypatch.setattr("brickyard.session.time.time", lambda: now[0])

    async def run():
        await bench.run_script(CORE)
        assert bench.session.build.updated == 100.0
        now[0] = 200.0
        await bench.run_script(CORE + 'brick("3001", 0, 0, 0, 14)')
        assert bench.session.build.updated == 100.0
        await bench.run_script(CORE + "# same geometry\n")
        assert bench.session.build.updated == 100.0
        await bench.run_script(CORE.replace(", 4)", ", 14)"))
        assert bench.session.build.updated == 200.0
        assert bench.session.store.load(bench.session.build.id).updated == 200.0
        now[0] = 300.0
        await bench.run_script("")
        assert bench.session.build.updated == 300.0
        assert bench.session.store.load(bench.session.build.id).pieces == []

    asyncio.run(run())


def test_failed_save_does_not_change_live_geometry_or_emit_events(bench, monkeypatch):
    async def run():
        await bench.run_script(CORE)
        before = bench.session.build.model_dump_json()
        queue = bench.session.subscribe()

        def fail(_):
            raise OSError("disk unavailable")

        monkeypatch.setattr(bench.session.store, "save", fail)
        with pytest.raises(OSError, match="disk unavailable"):
            await bench.run_script(CORE.replace(", 4)", ", 15)"))
        assert bench.session.build.model_dump_json() == before
        assert queue.empty()

    asyncio.run(run())


def test_cancelling_validation_does_not_publish_a_partial_candidate(bench, monkeypatch):
    async def run():
        await bench.run_script(CORE)
        before = bench.session.build.model_dump_json()
        queue = bench.session.subscribe()
        started, release, finished = threading.Event(), threading.Event(), threading.Event()
        check = Workbench._check

        def slow_check(self, *args):
            result = check(self, *args)
            started.set()
            try:
                release.wait(5)
                return result
            finally:
                finished.set()

        monkeypatch.setattr(Workbench, "_check", slow_check)
        task = asyncio.create_task(bench.run_script(CORE.replace(", 4)", ", 15)")))
        try:
            assert await asyncio.to_thread(started.wait, 3)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            release.set()
        assert await asyncio.to_thread(finished.wait, 3)
        assert bench.session.build.model_dump_json() == before
        assert bench.session.store.load(bench.session.build.id).model_dump_json() == before
        assert queue.empty()

    asyncio.run(run())


def test_support_is_checked_on_the_complete_step_in_any_line_order(bench):
    for heights in permutations((0, 3, 6)):
        code = 'step("Stack")\n' + "".join(f'brick("3001", 0, 0, {z}, 4)\n' for z in heights)
        result = asyncio.run(bench.run_script(code))
        assert result.problems == 0, result.text
        assert len(bench.pieces) == 3


def test_floating_bricks_are_placed_with_a_warning_and_cannot_support_each_other(bench):
    result = asyncio.run(
        bench.run_script('step("Floating pair")\nbrick("3001", 0, 0, 6, 4)\nbrick("3001", 0, 0, 9, 4)')
    )
    assert result.problems == 2 and "vertical contact path" in result.text
    assert "rejected" not in result.text and len(bench.pieces) == 2
    assert bench.session.build.checked_revision == bench.session.build.revision


def test_a_later_step_cannot_retroactively_support_an_earlier_step(bench):
    code = 'step("Top first")\nbrick("3001", 0, 0, 3, 4)\n' + CORE
    result = asyncio.run(bench.run_script(code))
    assert result.problems == 1 and "Top first" in result.text and "vertical contact path" in result.text


def test_fixed_manual_steps_survive_script_rejection_and_script_removal(bench):
    async def run():
        await bench.add("Manual base", [{"part": "3001", "x": 0, "y": 0, "z": 0, "color": 4}])
        fixed = list(bench.pieces)
        assert (await bench.run_script(CORE)).problems  # overlaps the fixed base
        assert bench.pieces == fixed
        assert not (await bench.run_script('step("Top")\nbrick("3001", 0, 0, 3, 15)')).problems
        assert not (await bench.run_script("")).problems
        assert bench.pieces == fixed
        assert [s.title for s in bench.session.build.steps] == ["Manual base"]

    asyncio.run(run())


def test_part_search_resolves_exact_ids_alias_spelling_and_dimensions(monkeypatch):
    # A controlled catalog keeps ranking deterministic; geometry uses the real library above.
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


def test_reference_selection_is_paired_with_renders_but_not_failed_candidates(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    photo = tmp_path / "reference.jpg"
    photo.write_bytes(b"reference")
    monkeypatch.setattr(sys, "argv", ["bricks", "reference", str(photo)])
    client.main()
    assert json.loads(client.REFERENCE.read_text())["path"] == str(photo)
    capsys.readouterr()
    (tmp_path / "build.py").write_text(CORE)

    def render(*args, **kwargs):
        return {
            "text": "Accepted",
            "images": [{"mime": "image/png", "data": base64.b64encode(b"png").decode()}],
            "caption": "Four views",
            "problems": 0,
        }

    monkeypatch.setattr(client, "call", render)
    monkeypatch.setattr(sys, "argv", ["bricks", "run"])
    with pytest.raises(SystemExit) as exit:
        client.main()
    assert exit.value.code == 0
    output = capsys.readouterr().out
    assert output.count("@@attach") == 2
    assert "@@attach render.png" in output and f"@@attach {photo}" in output

    monkeypatch.setattr(client, "call", lambda *args, **kwargs: {"text": "Rejected", "images": [], "problems": 1})
    with pytest.raises(SystemExit) as exit:
        client.main()
    assert exit.value.code == 1
    assert "@@attach" not in capsys.readouterr().out
