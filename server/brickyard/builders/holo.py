"""Holo as a builder: a streaming tool-calling loop over the workbench, reasoning shown live in the chat."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import uuid
from dataclasses import dataclass, field

import httpx

from brickyard import ldraw
from brickyard.model import baseplate
from brickyard.session import Session
from brickyard.workbench import COMMON_COLORS, COMMON_PARTS, Result, Workbench, part_line

GREEN = 2
THINK_FLUSH_S = 0.25
RETRIES = 3
RETRY_CAP_S = 60
CONTEXT_CHARS = 200_000
RECENT = 12
TRIMMED_RESULT = 300
TRIMMED_LIST = 2

PROMPT = """You are Holo, a LEGO master builder working in Brickyard. You build what the user asks on a {width}x{depth} stud \
baseplate with real LDraw parts. The model is a Python build script: each time you write or edit it, Brickyard runs \
it from the top, checks every brick, shows each manual step to the user in 3D, and sends you a render.

How to work
- For a new build: call set_name, then find_reference with a concrete name of the real thing (like "Split Point \
Lighthouse" or "V-2 rocket"; search again if the photos are off). Then write a short plan: a map of the baseplate as \
rectangles (x, y, w, d) for each building, tower, street, garden or water, the height of each in plates, whether \
each long thing (a bridge, street, river, wall) runs along x or along y, and the palette.
- Start with write_script: the plan's rectangles and colors as constants, then the big shapes. Keep this first script \
under 60 lines.
- Grow it with edit_script, one or two elements per call, added at the end. Steps before the first changed one stay \
as they are, so the user sees only the new work appear.
- Every run returns the problems by script line, where each step sits, and a render. Compare the render with the \
reference photos and your plan: name what is off (proportions, missing features, gaps, floating parts, colors), then \
fix those lines.
- Fix every problem before adding more: a rejected brick is missing from the model, a floating one has nothing under \
it.
- Before each tool call, say in one short sentence what you are about to do.
- When the model is finished and the last render looks right, reply with a two-sentence summary and no tool call.

The script
- Plain Python: constants, loops, and your own functions for anything that repeats (a window bay, a tree, a lamp). \
Stack things on the heights the calls return, never on hand-counted ones.
- step(title): starts a manual step; the calls after it go into it.
- walls(x, y, w, d, z, courses, color, corners=None, windows=None, openings=[]) -> top z: hollow walls of bonded \
bricks around the rectangle x to x+w-1, y to y+d-1, each course 3 plates tall. corners is the color of the four \
corner columns. windows={{"color": 40, "courses": [1, 3], "every": 2, "width": 1}} sets glass into every side, every \
N studs, on the courses listed (from 0); corners stay solid. openings=[{{"side": "south", "at": 3, "width": 2, \
"courses": 2, "arch": True}}] cuts doors, gates and shopfronts from the bottom; at counts studs from the side's west \
or south end; arches need a width of 2 or 4.
- fill(x, y, w, d, z, color=None, palette=None, kind="plate", skip=[]): covers the rectangle at height z with plates, \
tiles or bricks, largest parts first: floors, ceilings, streets, water, lawns. Cells already filled at that height \
are left out, so it paves around what stands there. A palette of [color, weight] pairs uses small parts in random \
colors, for textured ground. skip lists [x, y, w, d] rectangles to leave out.
- roof(x, y, w, d, z, color, steep=False) -> top z: a plate ceiling at z, then a hipped roof of slopes; w and d must \
be even. It rises about 1.5 plates per stud of its shorter side, 4.5 when steep; steep on a square ends in a spire.
- brick(part, x, y, z, color, rotation=0): one part, for details.
- top(x, y, w=1, d=1) -> z: the highest plate height filled over the rectangle so far, 0 on the bare baseplate.
- print() output comes back with the run.

Example
```python
PAVING = [[71, 5], [72, 2], [19, 1]]

def tree(x, y):
    for z in (0, 3, 6):
        brick("3941", x + 1, y + 1, z, 70)
    brick("87081", x, y, 9, 2)
    brick("6222", x, y, 12, 288)
    brick("3941", x + 1, y + 1, 15, 10)

step("Town hall walls")
eaves = walls(10, 12, 12, 8, 0, 6, 15, corners=71, windows={{"color": 40, "courses": [1, 3, 5]}},
              openings=[{{"side": "south", "at": 5, "width": 2, "courses": 2, "arch": True}}])
step("Town hall roof")
roof(10, 12, 12, 8, eaves, 320)
step("Trees")
for x in (2, 26):
    tree(x, 2)
step("Paving")
fill(0, 0, 32, 32, 0, palette=PAVING, kind="tile")
```

Quality bar
- Match the real proportions: tall things are tall. A lighthouse is about four times taller than it is wide.
- Aim for a rich model of 400 to 2000 pieces that fills the baseplate: the main subject, plus a setting with \
textured ground, paths or streets, water, trees and small props.
- Buildings are hollow walls with windows on every side and a real roof, never solid blocks of bricks. Give walls a \
contrasting color for corners or a plinth, and roofs a color of their own.
- Walls rest only on what is under their own bricks: before narrower walls go on top of wider ones (a tower on a \
pier, an upper storey set back), fill a plate slab over the lower walls' top.
- Keep one scale across the model: a storey is 2 courses, walls are at least as tall as the roof on them, and lamps, \
benches and fences stay below the eaves.
- Add the details that make it recognizable: trims and stripes in accent colors, and shaped parts like slopes, round \
bricks, cones, arches and fences instead of only plain bricks.

Coordinates
- x runs 0-{xmax} from left to right, y runs 0-{ymax} from front to back, z is the height in plates above the baseplate. \
Bricks are 3 plates tall; plates and tiles are 1.
- The sides of a rectangle are south (the front, lowest y), north (the back), west (left, lowest x) and east (right).
- A part placed at (x, y) covers studs x to x+W-1 and y to y+D-1, with W x D as listed at rotation 0. Rotation 90 or \
270 swaps W and D.
- Parts on the baseplate use z=0. To stack, put the upper part at z = lower z + lower height.
- Slopes at rotation 0 descend toward the front (-y), at 180 toward the back (+y), at 90 toward -x, at 270 toward +x.
- Parts must stay on the baseplate, must not overlap other pieces, and should rest on something. Runs name every \
brick that does not, with the script line that made it.

Recipes that work
- Ground and water: build everything that stands on the baseplate first (buildings, piers, tree trunks), then fill \
the ground and the water at z=0 with tiles and a palette, as the last steps. Paving [[71, 5], [72, 2], [19, 1]], \
grass [[2, 4], [10, 2], [288, 1]], water [[272, 5], [1, 2], [73, 1]].
- House: walls of 2 courses per storey with windows on courses 1, 3, 5 (trans black 40, or trans yellow 46 for lit \
rooms) and a door opening, then a roof on the walls' top z, with steep=True for tall Gothic or Nordic roofs.
- Tower and spire: square walls with narrow windows, or stacked round bricks (3941 is 2x2, 3062b is 1x1). A steep \
roof on a square tower ends in a spire; 4589 cones on the corners make pinnacles.
- Street lamp: a 3062b in black, a 3062b in trans yellow 46 on it, and a 4589 cone in black on top.
- Window 60592 gets its glass automatically; put it in a wall opening with a black brick behind it.

Common parts at rotation 0. Use find_parts for anything else.
{parts}

Colors (LDraw code: name)
{colors}"""


def _tool(name: str, description: str, /, **properties: dict) -> dict:
    schema = {"type": "object", "properties": properties, "required": list(properties)}
    return {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}


EDIT = {
    "type": "object",
    "properties": {
        "old": {"type": "string", "description": "text that appears exactly once in the script"},
        "new": {"type": "string", "description": "what replaces it"},
    },
    "required": ["old", "new"],
}
TOOLS = [
    _tool(
        "write_script",
        "Replace the whole build script and run it. Returns the problems by line, the steps, and a render.",
        code={"type": "string", "description": "the Python build script"},
    ),
    _tool(
        "edit_script",
        "Apply exact text replacements to the build script, in order, then run it like write_script.",
        edits={"type": "array", "items": EDIT},
    ),
    _tool("read_script", "The current build script, with line numbers."),
    _tool("find_parts", "Search all LDraw parts by title words, e.g. 'slope 45 2 x 2'.", query={"type": "string"}),
    _tool(
        "find_reference",
        "Photos of the real object from Wikipedia, up to 3, with their page titles.",
        query={"type": "string", "description": "a concrete name, like 'Split Point Lighthouse'"},
    ),
    _tool("set_name", "Name the build.", name={"type": "string"}),
]


def system_prompt(width: int = 32, depth: int = 32) -> str:
    palette = ldraw.colors()
    parts = "\n".join(part_line(f"{p}.dat") for p in COMMON_PARTS)
    colors = ", ".join(f"{c}: {palette[c][0].lower()}" for c in COMMON_COLORS if c in palette)
    return PROMPT.format(parts=parts, colors=colors, width=width, depth=depth, xmax=width - 1, ymax=depth - 1)


@dataclass
class Reply:
    content: str = ""
    reasoning_tokens: int = 0
    finish: str | None = None
    calls: dict[int, dict] = field(default_factory=dict)

    def message(self) -> dict:
        """The assistant turn for the history; arguments that are not JSON become {} so the API accepts the history."""
        message: dict = {"role": "assistant", "content": self.content}
        if self.calls:
            message["tool_calls"] = [
                {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": _json_or_empty(c)}}
                for c in self.calls.values()
            ]
        return message


def _json_or_empty(call: dict) -> str:
    try:
        json.loads(call["arguments"] or "{}")
    except json.JSONDecodeError:
        return "{}"
    return call["arguments"] or "{}"


def _size(message: dict) -> int:
    content = message["content"]
    text = content if isinstance(content, str) else "".join(part.get("text", "") for part in content)
    return len(text) + sum(len(c["function"]["arguments"]) for c in message.get("tool_calls", []))


def trim(messages: list[dict], budget: int = CONTEXT_CHARS) -> None:
    """Shorten the oldest tool calls and results until the text fits the budget; recent turns stay whole."""
    total = sum(map(_size, messages))
    for m in messages[:-RECENT]:
        if total <= budget:
            return
        before = _size(m)
        if m["role"] == "tool" and len(m["content"]) > TRIMMED_RESULT:
            m["content"] = m["content"][:TRIMMED_RESULT] + "... (trimmed; read_script shows the current script)"
        for c in m.get("tool_calls", []):
            args = json.loads(c["function"]["arguments"])
            if isinstance(args, dict):
                c["function"]["arguments"] = json.dumps({k: _shorten(v) for k, v in args.items()})
        total -= before - _size(m)


def _shorten(value: object) -> object:
    if isinstance(value, list):
        return [_shorten(v) for v in value[:TRIMMED_LIST]]
    if isinstance(value, dict):
        return {k: _shorten(v) for k, v in value.items()}
    if isinstance(value, str) and len(value) > TRIMMED_RESULT:
        return value[:TRIMMED_RESULT] + "..."
    return value


class HoloBuilder:
    def __init__(
        self,
        model: str,
        base_url: str,
        api_key: str,
        max_turns: int = 80,
        max_tokens: int = 12000,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.name = "holo"
        self.model = model
        self.url = f"{base_url.rstrip('/')}/chat/completions"
        self.api_key = api_key
        self.max_turns = max_turns
        self.max_tokens = max_tokens
        self.transport = transport

    @classmethod
    def from_env(cls) -> HoloBuilder | None:
        key = os.environ.get("HOLO_API_KEY") or os.environ.get("HAI_API_KEY")
        if not key:
            return None
        model = os.environ.get("HOLO_MODEL", "holo4-27b")
        base_url = os.environ.get("HOLO_BASE_URL", f"https://api.hcompany.ai/v1/models/{model}")
        return cls(model, base_url, key)

    async def run(self, session: Session, request: str) -> None:
        bench = Workbench(session)
        if not session.build.pieces:
            await session.step("Baseplate", [baseplate(GREEN)])
        messages = [
            {
                "role": "system",
                "content": await asyncio.to_thread(system_prompt, session.build.width, session.build.depth),
            },
            *self._history(session, request, await asyncio.to_thread(bench.brief)),
        ]
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=30), transport=self.transport) as client:
            for _ in range(self.max_turns):
                trim(messages)
                reply = await self._complete(client, session, messages)
                if reply.finish == "length":
                    reply.calls = {}
                messages.append(reply.message())
                if reply.content:
                    await session.say(reply.content)
                if not reply.calls:
                    if reply.finish == "length":
                        messages.append(
                            {"role": "user", "content": "You ran out of tokens. Take one smaller step now."}
                        )
                        continue
                    return
                shown = []
                for call in reply.calls.values():
                    result = await self._call(bench, call)
                    messages.append({"role": "tool", "tool_call_id": call["id"], "content": result.text})
                    if result.note:
                        await session.say(result.note, role="tool")
                    if result.images:
                        shown.append(result)
                for result in shown:
                    self._show(messages, result)
        await session.say(f"Stopped after {self.max_turns} turns.", role="system")

    @staticmethod
    def _history(session: Session, request: str, state: str) -> list[dict]:
        earlier = [
            {"role": m.role, "content": m.text} for m in session.build.messages[:-1] if m.role in ("user", "assistant")
        ]
        return [*earlier, {"role": "user", "content": f"{request}\n\nCurrent model:\n{state}"}]

    @staticmethod
    def _show(messages: list[dict], result: Result) -> None:
        """Attach images for the model to see; older images of the same kind leave the context."""
        for m in messages:
            if result.kind and m.get("kind") == result.kind:
                m["content"] = f"(Older {result.kind} images were here.)"
                del m["kind"]
        images = [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}}
            for data, mime in result.images
        ]
        messages.append(
            {"role": "user", "content": [{"type": "text", "text": result.caption}, *images], "kind": result.kind}
        )

    @staticmethod
    async def _call(bench: Workbench, call: dict) -> Result:
        try:
            args = json.loads(call["arguments"] or "{}")
        except json.JSONDecodeError as e:
            return Result(f"Arguments are not valid JSON ({e}). Resend the call.")
        if not isinstance(args, dict):
            return Result("Arguments must be a JSON object. Resend the call.")
        tools = {
            "write_script": lambda: bench.write_script(args["code"]),
            "edit_script": lambda: bench.edit_script(list(args["edits"])),
            "read_script": bench.read_script,
            "find_parts": lambda: bench.find_parts(str(args.get("query", ""))),
            "find_reference": lambda: bench.find_reference(str(args.get("query", ""))),
            "set_name": lambda: bench.rename(str(args.get("name", ""))),
        }
        if call["name"] not in tools:
            return Result(f"Unknown tool {call['name']}. Available: {', '.join(tools)}.")
        try:
            return await tools[call["name"]]()
        except (TypeError, ValueError, LookupError, AttributeError) as e:
            return Result(f"{call['name']} failed on these arguments ({type(e).__name__}: {e}). Fix them and resend.")

    async def _complete(self, client: httpx.AsyncClient, session: Session, messages: list[dict]) -> Reply:
        body = {
            "model": self.model,
            "messages": [{k: v for k, v in m.items() if k != "kind"} for m in messages],
            "tools": TOOLS,
            "stream": True,
            "max_tokens": self.max_tokens,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        for attempt in range(RETRIES):
            session.think("", reset=True)
            try:
                async with client.stream("POST", self.url, json=body, headers=headers) as response:
                    if (response.status_code == 429 or response.status_code >= 500) and attempt < RETRIES - 1:
                        wait = response.headers.get("retry-after", "")
                        await asyncio.sleep(min(int(wait), RETRY_CAP_S) if wait.isdigit() else 2**attempt)
                        continue
                    if response.status_code != 200:
                        size = len(json.dumps(body["messages"]))
                        raise RuntimeError(
                            f"Holo API {response.status_code}: {(await response.aread()).decode()[:300]} "
                            f"({len(messages)} messages, {size} characters)"
                        )
                    return await self._read(response, session)
            except (httpx.TransportError, httpx.RemoteProtocolError):
                if attempt == RETRIES - 1:
                    raise
                await asyncio.sleep(2**attempt)
        raise RuntimeError("Holo API kept failing")

    @staticmethod
    async def _read(response: httpx.Response, session: Session) -> Reply:
        reply = Reply()
        thinking, flushed = "", time.monotonic()
        async for line in response.aiter_lines():
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[6:])
            for choice in chunk.get("choices", []):
                delta = choice.get("delta", {})
                thinking += delta.get("reasoning") or delta.get("reasoning_content") or ""
                reply.content += delta.get("content") or ""
                for t in delta.get("tool_calls") or []:
                    call = reply.calls.setdefault(
                        t["index"], {"id": t.get("id") or uuid.uuid4().hex[:12], "name": "", "arguments": ""}
                    )
                    call["name"] += t.get("function", {}).get("name") or ""
                    call["arguments"] += t.get("function", {}).get("arguments") or ""
                reply.finish = choice.get("finish_reason") or reply.finish
            if thinking and time.monotonic() - flushed > THINK_FLUSH_S:
                session.think(thinking)
                thinking, flushed = "", time.monotonic()
        if thinking:
            session.think(thinking)
        reply.content = reply.content.strip()
        return reply
