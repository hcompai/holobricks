"""Live builds: a session owns one build, persists it, and streams every change to subscribers."""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Protocol

import PIL.Image

from brickyard import catalog
from brickyard.model import Box, Build, Camera, Message, Placement, Step
from brickyard.viewer import Viewers

log = logging.getLogger("brickyard")
DATA = Path(os.environ.get("BRICKYARD_DATA", Path(__file__).resolve().parents[2] / "data"))
SMALL_EDGE = 240
"""The short side of the chat's small images, twice their size on screen."""


class Store:
    def __init__(self, root: Path = DATA):
        self.root = root / "builds"
        self.root.mkdir(parents=True, exist_ok=True)
        self._summaries: dict[str, tuple[int, dict]] = {}

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

    def thumbnail_version(self, build_id: str) -> int | None:
        """When the thumbnail was saved, in milliseconds; None when there is none."""
        path = self.thumbnail(build_id)
        return path.stat().st_mtime_ns // 1_000_000 if path.exists() else None

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

    def small_image(self, name: str) -> Path:
        """The image as WebP with its short side at most SMALL_EDGE, for the chat; made on first use."""
        path = self._file(self.images / "small", f"{name}.webp")
        if not path.exists():
            with PIL.Image.open(self.image(name)) as image:
                edge = SMALL_EDGE * max(image.size) // min(image.size)
                image.thumbnail((edge, edge))
                path.parent.mkdir(exist_ok=True)
                tmp = path.with_name(f"{uuid.uuid4().hex}.tmp")
                image.save(tmp, "WEBP", quality=80)
            tmp.replace(path)
        return path

    def load(self, build_id: str) -> Build | None:
        try:
            path = self._file(self.root, f"{build_id}.json")
        except ValueError:
            return None
        return Build.model_validate_json(path.read_text()) if path.exists() else None

    def summaries(self) -> list[dict]:
        """Every build's summary, newest first; a build is parsed again only when its file changed."""
        out = []
        for path in self.root.glob("*.json"):
            mtime = path.stat().st_mtime_ns
            cached = self._summaries.get(path.name)
            if cached is None or cached[0] != mtime:
                try:
                    summary = Build.model_validate_json(path.read_text()).summary()
                except ValueError as e:
                    log.warning("skipping unreadable build %s: %s", path.name, e)
                    continue
                cached = self._summaries[path.name] = (mtime, summary)
            out.append(cached[1])
        return sorted(out, key=lambda s: -s["created"])


class Session:
    def __init__(self, build: Build, store: Store, viewers: Viewers | None = None):
        self.build = build
        self.store = store
        self.viewers = viewers
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

    def reload(self, build: Build) -> None:
        """Swaps in the build as saved on disk and has every open viewer resync to it."""
        self.build = build
        for queue in self.subscribers:
            queue.put_nowait({"type": "hello", "build": build.summary()})

    def _publish(self, event: dict) -> None:
        self.store.save(self.build)
        for queue in self.subscribers:
            queue.put_nowait(event)

    async def say(self, text: str, role: str = "assistant", images: list[str] | None = None) -> None:
        message = Message(role=role, text=text, images=images or [])  # type: ignore[arg-type]
        self.build.messages.append(message)
        self._publish({"type": "message", "message": message.model_dump()})

    async def step(self, title: str, placements: list[Placement], key: str | None = None) -> Step:
        """Validate the whole candidate before any builder can save or stream a direct addition."""
        candidate = self.build.model_copy(deep=True)
        step = candidate.add_step(title, placements, key)
        await self.validate_parts(candidate)
        candidate.updated = time.time()
        # Persist first: a failed validation/save must leave the live model and event stream unchanged.
        self.store.save(candidate)
        for name in ("pieces", "steps", "width", "depth", "updated"):
            setattr(self.build, name, getattr(candidate, name))
        pieces = [p for p in self.build.pieces if p.step == step.index]
        for queue in self.subscribers:
            queue.put_nowait(
                {
                    "type": "step",
                    "step": step.model_dump(),
                    "pieces": [p.model_dump() for p in pieces],
                    "width": self.build.width,
                    "depth": self.build.depth,
                }
            )
        await asyncio.sleep(0)
        return step

    async def validate_parts(self, candidate: Build) -> dict:
        return await asyncio.to_thread(catalog.require, candidate.pieces, self.store.root.parent / "bricklink-catalog")

    async def check_parts(self) -> dict:
        """The BrickLink verdict on every part/color pair of the model as it stands."""
        return await asyncio.to_thread(
            catalog.validate, self.build.pieces, self.store.root.parent / "bricklink-catalog"
        )

    async def save_script(self, script: str) -> None:
        self.build.script = script
        self.store.save(self.build)

    async def commit_script(self, candidate: Build, kept: int) -> None:
        """Persist the rebuilt model once, then publish its changed steps without yielding halfway through."""
        changes = {name: getattr(candidate, name) for name in ("script", "steps", "pieces", "width", "depth")}
        changes["updated"] = time.time() if candidate.revision != self.build.revision else self.build.updated
        self.store.save(self.build.model_copy(update=changes))
        for name, value in changes.items():
            setattr(self.build, name, value)
        events = [{"type": "rewind", "steps": kept, "width": candidate.width, "depth": candidate.depth}]
        events.extend(
            {
                "type": "step",
                "step": step.model_dump(),
                "pieces": [p.model_dump() for p in candidate.pieces if p.step == step.index],
                "width": candidate.width,
                "depth": candidate.depth,
            }
            for step in candidate.steps[kept:]
        )
        for queue in self.subscribers:
            for event in events:
                queue.put_nowait(event)

    def think(self, text: str, reset: bool = False) -> None:
        """Stream the builder's live reasoning; ephemeral, never persisted."""
        for queue in self.subscribers:
            queue.put_nowait({"type": "thinking", "text": text, "reset": reset})

    async def render(
        self, camera: Camera | None = None, box: Box | None = None, *, timeout: float = 30
    ) -> bytes | None:
        """Ask an open viewer to render the model, or only the pieces in `box`, in the four standard views unless `camera` is set; None when no viewer answers in time."""
        if self.viewers:
            await self.viewers.watch(self.build.id)
        request = uuid.uuid4().hex[:8]
        future: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()
        event = {
            "type": "render",
            "request": request,
            "camera": camera.model_dump() if camera else None,
            "box": box.model_dump() if box else None,
            "pieces": len(self.build.pieces),
            "revision": self.build.revision,
        }
        self.renders[request] = (event, future)
        for queue in self.subscribers:
            queue.put_nowait(event)
        try:
            return await asyncio.wait_for(future, timeout)
        except TimeoutError:
            return None
        finally:
            self.renders.pop(request, None)

    def deliver_render(self, request: str, png: bytes, pieces: int | None, revision: str | None = None) -> bool:
        """Takes a viewer's render if it shows the model as it was when asked, so a stale tab can't answer."""
        if request not in self.renders or (future := self.renders[request][1]).done():
            return False
        expected = self.renders[request][0]
        if pieces != expected["pieces"] or revision != expected["revision"] or revision != self.build.revision:
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

    async def run(self, session: Session, request: str, references: list[Path]) -> None:
        """Carry out `request`, with the images the user attached to it in `references`."""
        ...
