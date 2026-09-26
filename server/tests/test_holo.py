import asyncio
import json

import httpx
import pytest

from brickyard import ldraw
from brickyard.builders.holo import RECENT, TRIMMED_RESULT, HoloBuilder, trim
from brickyard.model import Build, baseplate, grid
from brickyard.session import Session, Store
from brickyard.workbench import Workbench

pytestmark = pytest.mark.skipif(not ldraw.LDRAW.exists(), reason="LDraw library not downloaded")


def brick(part="3001", x=0, y=0, z=0, color=4, rotation=0):
    return {"part": part, "x": x, "y": y, "z": z, "color": color, "rotation": rotation}


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
    first = asyncio.run(bench.write_script(HOUSE))
    assert first.problems == 0 and "roof top" in first.text, first.text
    assert [s.title for s in bench.session.build.steps] == ["Baseplate", "Walls", "Roof", "Paving"]
    assert any(p.part == "3659.dat" for p in bench.pieces)
    walls = [p for p in bench.pieces if p.step == 1]

    recolored = asyncio.run(bench.edit_script([{"old": "320", "new": "4"}]))
    assert "kept step 2, rebuilt 2 steps" in recolored.text
    assert [p for p in bench.pieces if p.step == 1] == walls
    assert {p.color for p in bench.pieces if p.step == 2} == {4}

    stray = [{"old": 'kind="tile")', "new": 'kind="tile")\nbrick("3001", 40, 0, 0, 4)'}]
    for result in (asyncio.run(bench.edit_script(stray)), asyncio.run(bench.run_script(bench.session.build.script))):
        assert result.problems == 1 and "kept steps 2 to 3, rebuilt 1 steps" in result.text
        assert 'line 9 `brick("3001", 40, 0, 0, 4)` (3001 at x=40 y=0 z=0): outside' in result.text

    before = list(bench.pieces)
    broken = asyncio.run(bench.edit_script([{"old": "40, 0, 0, 4)", "new": "4, 0, 0, 4)\nundefined()"}]))
    assert "did not change" in broken.text and "line 10 `undefined()`: NameError" in broken.text
    assert bench.pieces == before
    assert "undefined()" in bench.session.build.script


def sse(*chunks: dict) -> bytes:
    return b"".join(f"data: {json.dumps(c)}\n\n".encode() for c in chunks) + b"data: [DONE]\n\n"


def test_holo_loop_executes_tool_calls_until_a_plain_reply(tmp_path):
    turns = [
        sse(
            {"choices": [{"delta": {"reasoning": "A red brick in the middle."}}]},
            {"choices": [{"delta": {"content": "Placing one brick."}}]},
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call1",
                                    "function": {
                                        "name": "write_script",
                                        "arguments": json.dumps({"code": 'step("Core")\nbrick("3001", 14, 15, 0, 4)'}),
                                    },
                                }
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
        ),
        sse({"choices": [{"delta": {"content": "Done: one red brick."}, "finish_reason": "stop"}]}),
    ]
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, content=turns[len(requests) - 1], headers={"content-type": "text/event-stream"})

    builder = HoloBuilder("holo", "http://holo.test/v1", "key", transport=httpx.MockTransport(respond))
    session = Session(Build(prompt="one brick"), Store(tmp_path))
    session.render = lambda: asyncio.sleep(0)
    thoughts = session.subscribe()
    asyncio.run(session.say("one brick", role="user"))
    asyncio.run(builder.run(session, "one brick"))

    assert [s.title for s in session.build.steps] == ["Baseplate", "Core"]
    assert [m.text for m in session.build.messages] == [
        "one brick",
        "Placing one brick.",
        "Ran the script: 1 pieces (no viewer open)",
        "Done: one red brick.",
    ]
    tool_result = requests[1]["messages"][-1]
    assert tool_result["role"] == "tool" and tool_result["tool_call_id"] == "call1"
    assert (
        "No problems" in tool_result["content"] and "2 Core: 1 piece, x 14-17, y 15-16, z 0-3" in tool_result["content"]
    )
    events = [thoughts.get_nowait() for _ in range(thoughts.qsize())]
    assert any(e["type"] == "thinking" and "red brick" in e["text"] for e in events)


def test_holo_survives_rate_limits_and_bad_tool_arguments(tmp_path):
    calls = [
        {"index": 0, "id": "a", "function": {"name": "write_script", "arguments": '{"code": null}'}},
        {"index": 1, "id": "b", "function": {"name": "edit_script", "arguments": '{"edits": "x"}'}},
        {"index": 2, "id": "c", "function": {"name": "read_script", "arguments": "[]"}},
    ]
    turns = [
        httpx.Response(429, headers={"retry-after": "0"}),
        httpx.Response(200, content=sse({"choices": [{"delta": {"tool_calls": calls}}]})),
        httpx.Response(200, content=sse({"choices": [{"delta": {"content": "Done."}, "finish_reason": "stop"}]})),
    ]
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return turns[len(requests) - 1]

    builder = HoloBuilder("holo", "http://holo.test/v1", "key", transport=httpx.MockTransport(respond))
    session = Session(Build(prompt="p"), Store(tmp_path))
    asyncio.run(builder.run(session, "p"))

    results = [m["content"] for m in requests[-1]["messages"] if m["role"] == "tool"]
    assert "write_script failed" in results[0] and "edit_script failed" in results[1]
    assert "must be a JSON object" in results[2]
    assert session.build.messages[-1].text == "Done."


def test_long_runs_trim_old_turns_but_keep_recent_ones_and_every_call_paired():
    code = 'brick("3001", 0, 0, 0, 4)\n' * 100
    messages = [{"role": "system", "content": "rules"}, {"role": "user", "content": "build"}]
    for n in range(100):
        args = json.dumps({"edits": [{"old": f"# {n}", "new": code}] * 3})
        messages.append(
            {"role": "assistant", "content": "", "tool_calls": [{"id": str(n), "function": {"arguments": args}}]}
        )
        messages.append(
            {"role": "tool", "tool_call_id": str(n), "content": f"Step {n}: placed 40 pieces. " + "x" * 2000}
        )
    before, recent = json.dumps(messages), json.dumps(messages[-RECENT:])
    trim(messages, budget=100_000)
    assert len(json.dumps(messages)) < len(before) / 4
    assert json.dumps(messages[-RECENT:]) == recent
    first = json.loads(messages[2]["tool_calls"][0]["function"]["arguments"])
    assert first == {"edits": [{"old": "# 0", "new": code[:TRIMMED_RESULT] + "..."}] * 2}
    assert messages[3]["tool_call_id"] == "0" and messages[3]["content"].startswith("Step 0: placed 40 pieces.")
    assert messages[:2] == [{"role": "system", "content": "rules"}, {"role": "user", "content": "build"}]
