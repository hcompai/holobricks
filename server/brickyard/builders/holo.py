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

PROMPT = """You are Holo, a LEGO master builder working in Brickyard. You build what the user asks on a {width}x{depth} stud \
baseplate with real LDraw parts, one instruction-manual step at a time, while the user watches each step appear in 3D.

How to work
- For a new build: call set_name, then find_reference with a concrete name of the real thing (like "Split Point \
Lighthouse" or "V-2 rocket"; search again if the photos are off). Then write a short plan: a map of the baseplate as \
rectangles (x, y, w, d) for each building, tower, street, garden or water, the height of each in plates, whether \
each long thing (a bridge, street, river, wall) runs along x or along y, and the palette.
- Build the big shapes with the shape tools, one manual step per call: walls for hollow buildings and towers, fill for \
floors, ceilings, streets, water, grass and paving, roof for roofs. They return the top z to build on next.
- Add the details with add_bricks, at most 40 bricks per step: doors and arches, window frames, chimneys, round \
towers, spires, pinnacles, trees, lamps, fences, boats, benches.
- Call look every 3 or 4 steps. Compare the render with the reference photos and your plan: name what is off \
(proportions, missing features, gaps, floating parts, colors), fix it with remove_bricks and new steps, then continue.
- Before each tool call, say in one short sentence what you are about to do.
- When the model is finished and you have looked at it, reply with a two-sentence summary and no tool call.

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
- Parts must stay on the baseplate, must not overlap other pieces, and should rest on something. Tools reject bad \
bricks and say why; fix and resend only those.

Recipes that work (shift z up by the ground height if the spot is paved)
- Ground and water: first build everything that stands on the baseplate (buildings, piers, tree trunks), then fill \
the ground and the water at z=0 with tiles and a palette; fill leaves out the cells already taken. Paving [[71, 5], [72, 2], [19, 1]], grass [[2, 4], [10, 2], [288, 1]], water [[272, 5], \
[1, 2], [73, 1]].
- House: walls of 2 courses per storey with windows on courses 1, 3, 5 (trans black 40, or trans yellow 46 for lit \
rooms) and a door opening, then a roof on the walls' top z, with steep true for tall Gothic or Nordic roofs.
- Tower and spire: square walls with narrow windows, or stacked round bricks (3941 is 2x2, 3062b is 1x1). A steep \
roof on a square tower ends in a point, a spire; 4589 cones on the corners make pinnacles.
- Tree on a free 4x4 spot at (x, y): 3941 in reddish brown 70 at (x+1, y+1) for z 0, 3 and 6; then a 4x4 round \
brick 87081 at (x, y, z=9) in green 2, another 6222 at (x, y, z=12) in dark green 288, and a 3941 in bright green 10 at \
(x+1, y+1, z=15).
- Street lamp: a 3062b in black, a 3062b in trans yellow 46 on it, and a 4589 cone in black on top.
- Doors and gates: an opening 2 or 4 wide and 2 courses high with arch true.
- Window 60592 gets its glass automatically; put it in a wall opening with a black brick behind it.

Common parts at rotation 0. Use find_parts for anything else.
{parts}

Colors (LDraw code: name)
{colors}"""

BRICK = {
    "type": "object",
    "properties": {
        "part": {"type": "string", "description": "LDraw part id, e.g. 3001"},
        "x": {"type": "integer"},
        "y": {"type": "integer"},
        "z": {"type": "integer", "description": "height in plates"},
        "color": {"type": "integer", "description": "LDraw color code"},
        "rotation": {"type": "integer", "enum": [0, 90, 180, 270]},
    },
    "required": ["part", "x", "y", "z", "color"],
}


INT = {"type": "integer"}
TITLE = {"type": "string", "description": "manual step title"}
AREA = {
    "x": INT,
    "y": INT,
    "w": {"type": "integer", "description": "width in studs along x"},
    "d": {"type": "integer", "description": "depth in studs along y"},
    "z": {"type": "integer", "description": "height in plates of the bottom"},
}
SIDE = {"type": "string", "enum": ["south", "north", "west", "east"]}
WINDOWS = {
    "type": "object",
    "description": "glass bricks set into every side; corners stay solid",
    "properties": {
        "color": {"type": "integer", "description": "glass color, like 40 trans black or 46 trans yellow"},
        "every": {"type": "integer", "description": "one window group every N studs along each side, default 2"},
        "width": {"type": "integer", "description": "studs of glass per group, default 1"},
        "courses": {"type": "array", "items": INT, "description": "which courses get glass, counted from 0"},
    },
    "required": ["color", "courses"],
}
OPENING = {
    "type": "object",
    "description": "a gap from the bottom of the walls, for doors, gates and shopfronts",
    "properties": {
        "side": SIDE,
        "at": {"type": "integer", "description": "studs from the side's west or south end"},
        "width": INT,
        "courses": {"type": "integer", "description": "height in courses"},
        "arch": {"type": "boolean", "description": "put an arch over it; width 2 or 4"},
    },
    "required": ["side", "at", "width", "courses"],
}
PALETTE = {
    "type": "array",
    "items": {"type": "array", "items": INT, "minItems": 2, "maxItems": 2},
    "description": "[color, weight] pairs for a random texture, like [[2, 4], [10, 2], [288, 1]] for grass",
}


def _tool(name: str, description: str, /, optional: tuple[str, ...] = (), **properties: dict) -> dict:
    schema = {"type": "object", "properties": properties, "required": [p for p in properties if p not in optional]}
    return {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}


TOOLS = [
    _tool(
        "add_bricks",
        "Add one build step. Returns the new piece ids, plus any bricks rejected and why.",
        title=TITLE,
        bricks={"type": "array", "items": BRICK},
    ),
    _tool(
        "walls",
        "One step of hollow walls of bonded bricks around the rectangle x to x+w-1, y to y+d-1, with optional "
        "windows and openings. Returns the top z.",
        optional=("corners", "windows", "openings"),
        title=TITLE,
        **AREA,
        courses={"type": "integer", "description": "height in brick courses of 3 plates"},
        color=INT,
        corners={"type": "integer", "description": "color of the four corner columns"},
        windows=WINDOWS,
        openings={"type": "array", "items": OPENING},
    ),
    _tool(
        "fill",
        "One step covering the rectangle at height z with plates, tiles or bricks, largest parts first: floors, "
        "ceilings, streets, water, lawns. Cells already taken at that height are left out, so it paves around "
        "buildings. With a palette it uses small parts in random colors, for textured ground.",
        optional=("kind", "color", "palette", "skip"),
        title=TITLE,
        **AREA,
        kind={"type": "string", "enum": ["plate", "tile", "brick"], "description": "default plate"},
        color={"type": "integer", "description": "one color, or give a palette instead"},
        palette=PALETTE,
        skip={"type": "array", "items": {"type": "array", "items": INT}, "description": "[x, y, w, d] to leave out"},
    ),
    _tool(
        "roof",
        "One step of a plate ceiling over the rectangle at z, then a hipped roof of slopes on it; w and d must be "
        "even. Put it on the walls' top z. It rises about 1.5 plates per stud of its shorter side, 4.5 when steep. "
        "Returns the top z.",
        optional=("steep",),
        title=TITLE,
        **AREA,
        color=INT,
        steep={"type": "boolean", "description": "75 degree slopes, three times taller, for spires and Gothic roofs"},
    ),
    _tool("remove_bricks", "Remove pieces by id.", ids={"type": "array", "items": {"type": "integer"}}),
    _tool("look", "Render the model: 3/4 front-right, 3/4 back-left, front and top views, as one image."),
    _tool("find_parts", "Search all LDraw parts by title words, e.g. 'slope 45 2 x 2'.", query={"type": "string"}),
    _tool(
        "find_reference",
        "Photos of the real object from Wikipedia, up to 3, with their page titles.",
        query={"type": "string", "description": "a concrete name, like 'Split Point Lighthouse'"},
    ),
    _tool("list_pieces", "List every piece with its id, part, position and color."),
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
            *self._history(session, request, await asyncio.to_thread(bench.describe)),
        ]
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=30), transport=self.transport) as client:
            for _ in range(self.max_turns):
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
            "add_bricks": lambda: bench.add(str(args.get("title", "Step")), list(args.get("bricks", []))),
            "walls": lambda: bench.walls(str(args.pop("title", "Walls")), args),
            "fill": lambda: bench.fill(str(args.pop("title", "Fill")), args),
            "roof": lambda: bench.roof(str(args.pop("title", "Roof")), args),
            "remove_bricks": lambda: bench.remove([int(i) for i in args.get("ids", [])]),
            "look": bench.look,
            "find_parts": lambda: bench.find_parts(str(args.get("query", ""))),
            "find_reference": lambda: bench.find_reference(str(args.get("query", ""))),
            "list_pieces": bench.list_pieces,
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
