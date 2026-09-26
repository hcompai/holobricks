"""Live builds: a session owns one build, persists it, and streams every change to subscribers."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Protocol

from brickyard.model import Build, Camera, Message, Piece, Placement, Step

log = logging.getLogger("brickyard")
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

    @staticmethod
    def _file(folder: Path, name: str) -> Path:
        """`folder / name`; raises ValueError for names that reach outside `folder`."""
        path = os.path.realpath(folder / name)
        if not path.startswith(os.path.realpath(folder) + os.sep):
            raise ValueError(f"bad file name {name!r}")
        return Path(path)

    def thumbnail(self, build_id: str) -> Path:
        return self._file(self.root.parent / "thumbnails", f"{build_id}.png")

    def image(self, name: str) -> Path:
        return self._file(self.images, name)

    @property
    def images(self) -> Path:
        return self.root.parent / "images"

    def save_image(self, data: bytes, mime: str) -> str:
        """Keep an image shown in the chat; returns its URL."""
        name = f"{uuid.uuid4().hex[:12]}.{mime.split('/')[-1].replace('jpeg', 'jpg')}"
        self.images.mkdir(parents=True, exist_ok=True)
        (self.images / name).write_bytes(data)
        return f"/api/images/{name}"

    def load(self, build_id: str) -> Build | None:
        try:
            path = self._file(self.root, f"{build_id}.json")
        except ValueError:
            return None
        return Build.model_validate_json(path.read_text()) if path.exists() else None

    def all(self) -> list[Build]:
        builds = []
        for path in self.root.glob("*.json"):
            try:
                builds.append(Build.model_validate_json(path.read_text()))
            except ValueError as e:
                log.warning("skipping unreadable build %s: %s", path.name, e)
        return sorted(builds, key=lambda b: -b.created)


class Session:
    def __init__(self, build: Build, store: Store):
        self.build = build
        self.store = store
        self.subscribers: set[asyncio.Queue[dict]] = set()
        self.task: asyncio.Task | None = None
        self.renders: dict[str, tuple[dict, asyncio.Future[bytes]]] = {}
        self.lock = asyncio.Lock()
        """Held while a tool changes the build, one tool at a time."""

    @property
    def busy(self) -> bool:
        return bool(self.task and not self.task.done()) or self.lock.locked()

    def subscribe(self) -> asyncio.Queue[dict]:
        """A queue of every change from now on, starting with the renders still waiting for a viewer."""
        queue: asyncio.Queue[dict] = asyncio.Queue()
        for event, _ in self.renders.values():
            queue.put_nowait(event)
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self.subscribers.discard(queue)

    def _publish(self, event: dict) -> None:
        self.store.save(self.build)
        for queue in self.subscribers:
            queue.put_nowait(event)

    async def say(self, text: str, role: str = "assistant", images: list[str] | None = None) -> None:
        message = Message(role=role, text=text, images=images or [])  # type: ignore[arg-type]
        self.build.messages.append(message)
        self._publish({"type": "message", "message": message.model_dump()})

    async def step(self, title: str, placements: list[Placement], key: str | None = None) -> Step:
        """Add placements as one step of the build."""
        step = Step(index=len(self.build.steps), title=title, key=key)
        next_id = max((p.id for p in self.build.pieces), default=0) + 1
        pieces = [Piece(id=next_id + i, step=step.index, **pl.model_dump()) for i, pl in enumerate(placements)]
        self.build.steps.append(step)
        self.build.pieces += pieces
        self._publish({"type": "step", "step": step.model_dump(), "pieces": [p.model_dump() for p in pieces]})
        await asyncio.sleep(0)
        return step

    async def rewind(self, steps: int) -> None:
        """Keep only the first `steps` steps and their pieces."""
        self.build.steps = self.build.steps[:steps]
        self.build.pieces = [p for p in self.build.pieces if p.step < steps]
        self._publish({"type": "rewind", "steps": steps})

    def think(self, text: str, reset: bool = False) -> None:
        """Stream the builder's live reasoning; ephemeral, never persisted."""
        for queue in self.subscribers:
            queue.put_nowait({"type": "thinking", "text": text, "reset": reset})

    async def render(self, camera: Camera | None = None, *, timeout: float = 30) -> bytes | None:
        """Ask an open viewer to render the model, in the four standard views unless `camera` is set; None when no viewer answers in time."""
        request = uuid.uuid4().hex[:8]
        future: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()
        event = {"type": "render", "request": request, "camera": camera.model_dump() if camera else None}
        self.renders[request] = (event, future)
        for queue in self.subscribers:
            queue.put_nowait(event)
        try:
            return await asyncio.wait_for(future, timeout)
        except TimeoutError:
            return None
        finally:
            self.renders.pop(request, None)

    def deliver_render(self, request: str, png: bytes) -> bool:
        if request not in self.renders or (future := self.renders[request][1]).done():
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
