"""Live builds: a session owns one build, persists it, and streams every change to subscribers."""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path
from typing import Protocol

from brickyard.model import Build, Message, Piece, Placement, Step

DATA = Path(os.environ.get("BRICKYARD_DATA", Path(__file__).resolve().parents[2] / "data"))


class Store:
    def __init__(self, root: Path = DATA):
        self.root = root / "builds"
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, build: Build) -> None:
        path = self.root / f"{build.id}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(build.model_dump_json())
        tmp.replace(path)

    def thumbnail(self, build_id: str) -> Path:
        return self.root.parent / "thumbnails" / f"{build_id}.png"

    def load(self, build_id: str) -> Build | None:
        path = self.root / f"{build_id}.json"
        return Build.model_validate_json(path.read_text()) if path.exists() else None

    def all(self) -> list[Build]:
        builds = [Build.model_validate_json(p.read_text()) for p in self.root.glob("*.json")]
        return sorted(builds, key=lambda b: -b.created)


class Session:
    def __init__(self, build: Build, store: Store):
        self.build = build
        self.store = store
        self.subscribers: set[asyncio.Queue[dict]] = set()
        self.task: asyncio.Task | None = None
        self.renders: dict[str, asyncio.Future[bytes]] = {}

    def subscribe(self) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self.subscribers.discard(queue)

    def _publish(self, event: dict) -> None:
        self.store.save(self.build)
        for queue in self.subscribers:
            queue.put_nowait(event)

    async def say(self, text: str, role: str = "assistant") -> None:
        message = Message(role=role, text=text)  # type: ignore[arg-type]
        self.build.messages.append(message)
        self._publish({"type": "message", "message": message.model_dump()})

    async def step(self, title: str, placements: list[Placement]) -> Step:
        """Add placements as one step of the build."""
        step = Step(index=len(self.build.steps), title=title)
        next_id = max((p.id for p in self.build.pieces), default=0) + 1
        pieces = [Piece(id=next_id + i, step=step.index, **pl.model_dump()) for i, pl in enumerate(placements)]
        self.build.steps.append(step)
        self.build.pieces += pieces
        self._publish({"type": "step", "step": step.model_dump(), "pieces": [p.model_dump() for p in pieces]})
        await asyncio.sleep(0)
        return step

    async def remove(self, ids: set[int]) -> list[Piece]:
        removed = [p for p in self.build.pieces if p.id in ids]
        self.build.pieces = [p for p in self.build.pieces if p.id not in ids]
        self._publish({"type": "remove", "ids": [p.id for p in removed]})
        return removed

    def think(self, text: str, reset: bool = False) -> None:
        """Stream the builder's live reasoning; ephemeral, never persisted."""
        for queue in self.subscribers:
            queue.put_nowait({"type": "thinking", "text": text, "reset": reset})

    async def render(self, timeout: float = 30) -> bytes | None:
        """Ask an open viewer to render the model; None when no viewer answers in time."""
        request = uuid.uuid4().hex[:8]
        future: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()
        self.renders[request] = future
        for queue in self.subscribers:
            queue.put_nowait({"type": "render", "request": request})
        try:
            return await asyncio.wait_for(future, timeout)
        except TimeoutError:
            return None
        finally:
            self.renders.pop(request, None)

    def deliver_render(self, request: str, png: bytes) -> bool:
        future = self.renders.get(request)
        if future is None or future.done():
            return False
        future.set_result(png)
        return True

    async def rename(self, name: str) -> None:
        self.build.name = name
        self._publish({"type": "build", "build": self.build.summary()})

    async def set_status(self, status: str) -> None:
        self.build.status = status  # type: ignore[assignment]
        self._publish({"type": "build", "build": self.build.summary()})


class Builder(Protocol):
    """Anything that turns a request into steps: the scripted demo today, an agent tomorrow."""

    name: str

    async def run(self, session: Session, request: str) -> None: ...
