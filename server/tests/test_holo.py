import asyncio
import json

import httpx
import pytest

from brickyard import ldraw
from brickyard.builders.holo import HoloBuilder
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
    assert "overlaps brick 1 of this step" in result.text
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


def test_window_frames_come_with_glass_and_removal_updates_the_build(bench):
    asyncio.run(bench.add("Window", [brick(part="60592", x=2, y=2, color=15)]))
    assert "overlaps #2 60592" in asyncio.run(bench.add("Blocked", [brick(part="3005", x=2, y=2)])).text
    assert [p.part for p in bench.pieces[1:]] == ["60592.dat", "60601.dat"]
    result = asyncio.run(bench.remove([p.id for p in bench.pieces[1:]] + [999]))
    assert "Removed 2 pieces. No such pieces: [999]." == result.text
    assert [p.part for p in bench.pieces] == ["3811.dat"]
    assert "placed 1 pieces as #2-#2" in asyncio.run(bench.add("Freed", [brick(part="3005", x=2, y=2)])).text
    assert "overlaps #2 3005 at x=2 y=2 z=0" in asyncio.run(bench.add("Taken", [brick(part="3005", x=2, y=2)])).text


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
                                        "name": "add_bricks",
                                        "arguments": json.dumps({"title": "Core", "bricks": [brick(x=14, y=15)]}),
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
    thoughts = session.subscribe()
    asyncio.run(session.say("one brick", role="user"))
    asyncio.run(builder.run(session, "one brick"))

    assert [s.title for s in session.build.steps] == ["Baseplate", "Core"]
    assert [m.text for m in session.build.messages] == [
        "one brick",
        "Placing one brick.",
        "Added 1 pieces: Core",
        "Done: one red brick.",
    ]
    tool_result = requests[1]["messages"][-1]
    assert tool_result["role"] == "tool" and tool_result["tool_call_id"] == "call1"
    assert "placed 1 pieces as #2-#2" in tool_result["content"]
    events = [thoughts.get_nowait() for _ in range(thoughts.qsize())]
    assert any(e["type"] == "thinking" and "red brick" in e["text"] for e in events)


def test_holo_survives_rate_limits_and_bad_tool_arguments(tmp_path):
    calls = [
        {"index": 0, "id": "a", "function": {"name": "add_bricks", "arguments": '{"bricks": null}'}},
        {"index": 1, "id": "b", "function": {"name": "remove_bricks", "arguments": '{"ids": ["x"]}'}},
        {"index": 2, "id": "c", "function": {"name": "list_pieces", "arguments": "[]"}},
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
    assert "add_bricks failed" in results[0] and "remove_bricks failed" in results[1]
    assert "must be a JSON object" in results[2]
    assert session.build.messages[-1].text == "Done."
