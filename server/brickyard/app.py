"""HTTP API: builds, chat, a live event stream per build, and LDraw parts for the viewer."""

from __future__ import annotations

import asyncio
import base64
import inspect
import json
import logging
import os
import re
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from brickyard import ldraw
from brickyard.builders import BUILDERS
from brickyard.model import Box, Build, Camera, Message
from brickyard.session import Session, Store
from brickyard.viewer import Viewers
from brickyard.workbench import Workbench

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
HEARTBEAT_S = 15
SHUTDOWN_S = 3
SHEET_TIMEOUT_S = 90
MAX_REFERENCES = 2
MAX_REFERENCE_BYTES = 8_000_000
REFERENCE = re.compile(r"data:(image/(?:jpeg|png|webp));base64,(.+)", re.DOTALL)
log = logging.getLogger("brickyard")


class NewBuild(BaseModel):
    prompt: str
    builder: str = next(iter(BUILDERS))
    images: list[str] = []


class Say(BaseModel):
    text: str
    images: list[str] = []


class AgentSay(BaseModel):
    text: str
    role: Literal["assistant", "thinking"] = "assistant"


store = Store()
sessions: dict[str, Session] = {}
viewers = Viewers(f"http://127.0.0.1:{os.environ.get('BRICKYARD_PORT', '8000')}")
TOOLS = {
    "run": Workbench.run_script,
    "look": Workbench.look,
    "parts": Workbench.find_parts,
    "name": Workbench.rename,
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Builds left building by a server that died are done; on shutdown, every running build stops with the server."""
    for summary in store.summaries():
        if summary["status"] == "building" and (build := store.load(summary["id"])):
            build.status = "done"
            build.messages.append(Message(role="system", text="Stopped: the server restarted."))
            store.save(build)
    warm = asyncio.create_task(asyncio.to_thread(lambda: (ldraw.catalog(), ldraw.colors())))
    yield
    warm.cancel()
    running = [s.task for s in sessions.values() if s.task and not s.task.done()]
    for task in running:
        task.cancel()
    await asyncio.gather(*running, return_exceptions=True)
    await viewers.stop()


app = FastAPI(title="Brickyard", lifespan=lifespan)


def session_for(build_id: str) -> Session:
    """The live session of a build; idle ones re-read the build so edits made on disk show up."""
    session = sessions.get(build_id)
    if session and session.busy:
        return session
    build = store.load(build_id)
    if build is None:
        raise HTTPException(404, f"no build {build_id}")
    if session:
        if len(build.pieces) != len(session.build.pieces) or len(build.steps) != len(session.build.steps):
            session.reload(build)
        else:
            session.build = build
    else:
        session = sessions[build_id] = Session(build, store, viewers)
    return session


def idle(session: Session) -> Session:
    if session.busy:
        raise HTTPException(409, "this build is still running")
    return session


def references(images: list[str]) -> list[tuple[bytes, str]]:
    """The user's reference images, sent as data URLs, as bytes and media type."""
    if len(images) > MAX_REFERENCES:
        raise HTTPException(400, f"at most {MAX_REFERENCES} images per message")
    decoded = []
    for image in images:
        match = REFERENCE.fullmatch(image)
        if not match:
            raise HTTPException(400, "images must be JPEG, PNG or WebP data URLs")
        try:
            data = base64.b64decode(match[2], validate=True)
        except ValueError:
            raise HTTPException(400, "an image is not valid base64") from None
        if len(data) > MAX_REFERENCE_BYTES:
            raise HTTPException(400, f"images must be under {MAX_REFERENCE_BYTES // 1_000_000} MB")
        decoded.append((data, match[1]))
    return decoded


async def ask(session: Session, text: str, images: list[tuple[bytes, str]]) -> None:
    """Post the user's message with its images to the chat, then start the builder on it."""
    idle(session)
    urls = [store.save_image(data, mime) for data, mime in images]
    await session.say(text, role="user", images=urls)
    start(session, text, [store.image(Path(url).name) for url in urls])


def start(session: Session, request: str, references: list[Path]) -> None:
    idle(session)
    if session.build.builder not in BUILDERS:
        session.build.builder = next(iter(BUILDERS))
    builder = BUILDERS[session.build.builder]

    async def run() -> None:
        await session.set_status("building")
        try:
            await builder.run(session, request, references)
            await session.set_status("done")
        except asyncio.CancelledError:
            await session.say("Stopped.", role="system")
            await session.set_status("done")
        except Exception as e:
            log.exception("build %s failed", session.build.id)
            await session.say(f"Builder failed: {e}", role="system")
            await session.set_status("error")
        finally:
            await viewers.release(session.build.id)

    session.task = asyncio.create_task(run())


@app.get("/api/builds")
def list_builds() -> list[dict]:
    return [s | {"thumbnail": store.thumbnail_version(s["id"])} for s in store.summaries()]


@app.post("/api/builds")
async def create_build(body: NewBuild) -> dict:
    if body.builder not in BUILDERS:
        raise HTTPException(400, f"unknown builder {body.builder}; available: {list(BUILDERS)}")
    images = references(body.images)
    build = Build(prompt=body.prompt, builder=body.builder, name=body.prompt[:48] or "Untitled build")
    store.save(build)
    session = session_for(build.id)
    await ask(session, body.prompt, images)
    return build.summary()


@app.get("/api/builds/{build_id}")
async def get_build(build_id: str) -> Response:
    return Response(session_for(build_id).build.model_dump_json(), media_type="application/json")


@app.post("/api/builds/{build_id}/messages")
async def post_message(build_id: str, body: Say) -> dict:
    session = session_for(build_id)
    await ask(session, body.text, references(body.images))
    return session.build.summary()


@app.post("/api/builds/{build_id}/stop")
async def stop(build_id: str) -> dict:
    session = session_for(build_id)
    if session.task and not session.task.done():
        session.task.cancel()
    return {"ok": True}


@app.post("/api/builds/{build_id}/tools/{tool}")
async def call_tool(build_id: str, tool: str, args: dict[str, Any]) -> dict:
    """Run a workbench tool for an agent working outside the server, like Holo through the bricks CLI."""
    if tool not in TOOLS:
        raise HTTPException(404, f"unknown tool {tool}; available: {list(TOOLS)}")
    try:
        inspect.signature(TOOLS[tool]).bind(None, **args)
    except TypeError as e:
        raise HTTPException(400, f"{tool}: {e}") from e
    session = session_for(build_id)
    async with session.lock:
        result = await TOOLS[tool](Workbench(session), **args)
    return {
        "text": result.text,
        "problems": result.problems,
        "caption": result.caption,
        "revision": session.build.revision,
        "images": [{"mime": p.mime, "data": base64.b64encode(p.data).decode()} for p in result.images],
    }


@app.post("/api/builds/{build_id}/say")
async def agent_say(build_id: str, body: AgentSay) -> dict:
    """Show a message or the live reasoning of an agent working outside the server."""
    session = session_for(build_id)
    if body.role == "thinking":
        session.think(body.text, reset=True)
    else:
        await session.say(body.text)
    return {"ok": True}


@app.get("/api/builds/{build_id}/sheet.png")
async def get_sheet(
    build_id: str,
    angle: float | None = None,
    elevation: float = 30,
    zoom: float = 1,
    at: str | None = None,
    box: str | None = None,
) -> Response:
    """The four views a builder checks its work on, or one view when `angle` is set; `at` is "x,y,z", `box` "x0,y0,z0,x1,y1,z1"."""
    try:
        camera = None if angle is None else Camera(angle=angle, elevation=elevation, zoom=zoom, at=at and at.split(","))
        inside = None if box is None else Box.of([int(v) for v in box.split(",")])
    except (ValidationError, ValueError) as e:
        raise HTTPException(400, str(e)) from e
    session = session_for(build_id)
    revision = session.build.revision
    png = await session.render(camera, inside, timeout=SHEET_TIMEOUT_S)
    if png is None:
        raise HTTPException(503, "no viewer rendered the build; build the web app and install Chrome")
    return Response(png, media_type="image/png", headers={"X-Revision": revision})


@app.put("/api/builds/{build_id}/renders/{request}")
async def put_render(build_id: str, request: str, body: Request) -> dict:
    pieces = body.headers.get("x-pieces")
    png = await body.body()
    return {
        "accepted": session_for(build_id).deliver_render(
            request, png, int(pieces) if pieces else None, body.headers.get("x-revision")
        )
    }


@app.get("/api/builds/{build_id}/events")
async def events(build_id: str) -> StreamingResponse:
    session = session_for(build_id)
    queue = session.subscribe()

    async def stream():
        try:
            yield f"data: {json.dumps({'type': 'hello', 'build': session.build.summary()})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), HEARTBEAT_S)
                    yield f"data: {json.dumps(event)}\n\n"
                except TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            session.unsubscribe(queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


@app.put("/api/builds/{build_id}/thumbnail.png")
async def put_thumbnail(build_id: str, request: Request) -> dict:
    session_for(build_id)
    path = store.thumbnail(build_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(await request.body())
    return {"ok": True}


@app.get("/api/builds/{build_id}/thumbnail.png")
def get_thumbnail(build_id: str, v: int | None = None) -> FileResponse:
    """Cached for good when `v`, the version from the build list, names the file."""
    try:
        path = store.thumbnail(build_id)
    except ValueError:
        path = None
    if path is None or not path.exists():
        raise HTTPException(404, "no thumbnail yet")
    cache = "public, max-age=31536000, immutable" if v is not None else "no-cache"
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": cache})


@app.get("/api/builds/{build_id}/bom")
async def bill_of_materials(build_id: str) -> list[dict]:
    return session_for(build_id).build.bom()


@app.get("/api/builds/{build_id}/download.ldr")
async def download(build_id: str) -> PlainTextResponse:
    build = session_for(build_id).build
    disposition = f"attachment; filename*=UTF-8''{quote(f'{build.name}.ldr')}"
    return PlainTextResponse(build.to_ldraw(), headers={"Content-Disposition": disposition})


@app.get("/api/parts/{part}")
def part(part: str) -> PlainTextResponse:
    if not ldraw.exists(part):
        raise HTTPException(404, f"unknown part {part}")
    return PlainTextResponse(ldraw.pack(part), headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/images/{name}")
def image(name: str) -> FileResponse:
    try:
        path = store.image(name)
    except ValueError:
        path = None
    if path is None or not path.is_file():
        raise HTTPException(404, "no such image")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/images/small/{name}.webp")
def small_image(name: str) -> FileResponse:
    try:
        if not store.image(name).is_file():
            raise HTTPException(404, "no such image")
        path = store.small_image(name)
    except ValueError:
        raise HTTPException(404, "no such image") from None
    except OSError as e:
        raise HTTPException(415, f"cannot read {name}: {e}") from e
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/ldconfig")
def ldconfig() -> FileResponse:
    return FileResponse(ldraw.LDRAW / "LDConfig.ldr", media_type="text/plain")


if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")


def main() -> None:
    import uvicorn

    with suppress(KeyboardInterrupt):
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=int(os.environ.get("BRICKYARD_PORT", "8000")),
            timeout_graceful_shutdown=SHUTDOWN_S,
        )
