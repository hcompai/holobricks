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

PROMPT = """You are Holo, a LEGO master builder working in Brickyard. You build what the user asks on a {width}x{depth} stud \
baseplate with real LDraw parts, one instruction-manual step at a time, while the user watches each step appear in 3D.

How to work
- For a new build: call set_name, then find_reference with a concrete name of the real thing (like "Split Point \
Lighthouse" or "V-2 rocket"; search again if the photos are off). Then write a short design brief: overall size \
(footprint in studs, height in plates), the sections from bottom to top with their z ranges, and the palette.
- Then build in small steps. One add_bricks call is one manual step: a meaningful sub-assembly of at most 40 bricks, \
like "Wall course 2". Do not plan every brick up front: place the next step, read the result, continue.
- Call look every 2 or 3 steps. Compare the render with the reference photos and your brief: name what is off \
(proportions, missing features, gaps, colors), fix it with remove_bricks and add_bricks, then continue.
- Before each tool call, say in one short sentence what you are about to do.
- When the model is finished and you have looked at it, reply with a two-sentence summary and no tool call.

Quality bar
- Match the real proportions: tall things are tall. A lighthouse is about four times taller than it is wide.
- Aim for a rich model of 150 to 400 pieces that uses a good part of the baseplate, with a small setting around it \
when it fits: rocks, a path, water made of blue tiles, plants.
- Add the details that make it recognizable: windows, railings, trims and stripes in accent colors, and shaped parts \
like slopes, round bricks, arches and grilles instead of only plain bricks.

Coordinates
- x runs 0-{xmax} from left to right, y runs 0-{ymax} from front to back, z is the height in plates above the baseplate. \
Bricks are 3 plates tall; plates and tiles are 1.
- A part placed at (x, y) covers studs x to x+W-1 and y to y+D-1, with W x D as listed at rotation 0. Rotation 90 or \
270 swaps W and D.
- Parts on the baseplate use z=0. To stack, put the upper part at z = lower z + lower height.
- Slopes at rotation 0 descend toward the front (-y), at 180 toward the back (+y), at 90 toward -x, at 270 toward +x.
- Parts must stay on the baseplate, must not overlap other pieces, and should rest on something. add_bricks rejects \
bad bricks and says why; fix and resend only those.
- Stagger joints between courses, like real LEGO walls. Window 60592 gets its glass automatically.

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


def _tool(name: str, description: str, /, **properties: dict) -> dict:
    schema = {"type": "object", "properties": properties, "required": list(properties)}
    return {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}


TOOLS = [
    _tool(
        "add_bricks",
        "Add one build step. Returns the new piece ids, plus any bricks rejected and why.",
        title={"type": "string", "description": "manual step title"},
        bricks={"type": "array", "items": BRICK},
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
        message: dict = {"role": "assistant", "content": self.content}
        if self.calls:
            message["tool_calls"] = [
                {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}}
                for c in self.calls.values()
            ]
        return message


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
                messages.append(reply.message())
                if reply.content:
                    await session.say(reply.content)
                if not reply.calls:
                    if reply.finish == "length":
                        messages.append({"role": "user", "content": "You ran out of tokens. Take one small step now."})
                        continue
                    return
                for call in reply.calls.values():
                    result = await self._call(bench, call)
                    messages.append({"role": "tool", "tool_call_id": call["id"], "content": result.text})
                    if result.note:
                        await session.say(result.note, role="tool")
                    if result.images:
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
        tools = {
            "add_bricks": lambda: bench.add(str(args.get("title", "Step")), list(args.get("bricks", []))),
            "remove_bricks": lambda: bench.remove([int(i) for i in args.get("ids", [])]),
            "look": bench.look,
            "find_parts": lambda: bench.find_parts(str(args.get("query", ""))),
            "find_reference": lambda: bench.find_reference(str(args.get("query", ""))),
            "list_pieces": bench.list_pieces,
            "set_name": lambda: bench.rename(str(args.get("name", ""))),
        }
        if call["name"] not in tools:
            return Result(f"Unknown tool {call['name']}. Available: {', '.join(tools)}.")
        return await tools[call["name"]]()

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
                    if response.status_code >= 500 and attempt < RETRIES - 1:
                        await asyncio.sleep(2**attempt)
                        continue
                    if response.status_code != 200:
                        raise RuntimeError(
                            f"Holo API {response.status_code}: {(await response.aread()).decode()[:300]}"
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
