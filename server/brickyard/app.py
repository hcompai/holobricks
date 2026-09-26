"""HTTP API: builds, chat, a live event stream per build, and LDraw parts for the viewer."""

from __future__ import annotations

import asyncio
import json
import os
from collections import Counter
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from brickyard import ldraw
from brickyard.builders import BUILDERS
from brickyard.builders.holo import system_prompt
from brickyard.model import Build
from brickyard.session import Session, Store

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
HEARTBEAT_S = 15


class NewBuild(BaseModel):
    prompt: str
    builder: str = next(iter(BUILDERS))


class Say(BaseModel):
    text: str


store = Store()
sessions: dict[str, Session] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    warm = asyncio.create_task(asyncio.to_thread(lambda: (ldraw.catalog(), system_prompt())))
    yield
    warm.cancel()


app = FastAPI(title="Brickyard", lifespan=lifespan)


def session_for(build_id: str) -> Session:
    if build_id not in sessions:
        build = store.load(build_id)
        if build is None:
            raise HTTPException(404, f"no build {build_id}")
        sessions[build_id] = Session(build, store)
    return sessions[build_id]


def start(session: Session, request: str) -> None:
    if session.task and not session.task.done():
        raise HTTPException(409, "this build is still running")
    builder = BUILDERS.get(session.build.builder) or next(iter(BUILDERS.values()))

    async def run() -> None:
        await session.set_status("building")
        try:
            await builder.run(session, request)
            await session.set_status("done")
        except asyncio.CancelledError:
            await session.say("Stopped.", role="system")
            await session.set_status("done")
        except Exception as e:  # noqa: BLE001
            await session.say(f"Builder failed: {e}", role="system")
            await session.set_status("error")

    session.task = asyncio.create_task(run())


@app.get("/api/builders")
def builders() -> list[str]:
    return list(BUILDERS)


@app.get("/api/builds")
def list_builds() -> list[dict]:
    return [b.summary() | {"thumbnail": store.thumbnail(b.id).exists()} for b in store.all()]


@app.post("/api/builds")
async def create_build(body: NewBuild) -> dict:
    if body.builder not in BUILDERS:
        raise HTTPException(400, f"unknown builder {body.builder}; available: {list(BUILDERS)}")
    build = Build(prompt=body.prompt, builder=body.builder, name=body.prompt[:48] or "Untitled build")
    store.save(build)
    session = session_for(build.id)
    await session.say(body.prompt, role="user")
    start(session, body.prompt)
    return build.summary()


@app.get("/api/builds/{build_id}")
def get_build(build_id: str) -> Build:
    return session_for(build_id).build


@app.post("/api/builds/{build_id}/messages")
async def post_message(build_id: str, body: Say) -> dict:
    session = session_for(build_id)
    await session.say(body.text, role="user")
    start(session, body.text)
    return session.build.summary()


@app.post("/api/builds/{build_id}/stop")
def stop(build_id: str) -> dict:
    session = session_for(build_id)
    if session.task and not session.task.done():
        session.task.cancel()
    return {"ok": True}


@app.put("/api/builds/{build_id}/renders/{request}")
async def put_render(build_id: str, request: str, body: Request) -> dict:
    return {"accepted": session_for(build_id).deliver_render(request, await body.body())}


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
def get_thumbnail(build_id: str) -> FileResponse:
    path = store.thumbnail(build_id)
    if not path.exists():
        raise HTTPException(404, "no thumbnail yet")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-cache"})


@app.get("/api/builds/{build_id}/bom")
def bill_of_materials(build_id: str) -> list[dict]:
    counts = Counter((p.part, p.color) for p in session_for(build_id).build.pieces)
    palette = ldraw.colors()
    return [
        {
            "part": part,
            "title": ldraw.info(part).title,
            "color": color,
            "colorName": palette.get(color, (str(color), "#888888"))[0],
            "hex": palette.get(color, (str(color), "#888888"))[1],
            "count": n,
        }
        for (part, color), n in counts.most_common()
    ]


@app.get("/api/builds/{build_id}/download.ldr")
def download(build_id: str) -> PlainTextResponse:
    build = session_for(build_id).build
    return PlainTextResponse(
        build.to_ldraw(), headers={"Content-Disposition": f'attachment; filename="{build.name}.ldr"'}
    )


@app.get("/api/parts/{part}")
def part(part: str, color: int = 16) -> PlainTextResponse:
    if not ldraw.exists(part):
        raise HTTPException(404, f"unknown part {part}")
    return PlainTextResponse(ldraw.pack(part, color), headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/parts/{part}/info")
def part_info(part: str) -> dict:
    if not ldraw.exists(part):
        raise HTTPException(404, f"unknown part {part}")
    info = ldraw.info(part)
    return {"part": info.part, "title": info.title, "footprint": info.footprint, "plates": info.plates}


@app.get("/api/images/{name}")
def image(name: str) -> FileResponse:
    path = store.images / name
    if "/" in name or not path.is_file():
        raise HTTPException(404, "no such image")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/ldconfig")
def ldconfig() -> FileResponse:
    return FileResponse(ldraw.LDRAW / "LDConfig.ldr", media_type="text/plain")


if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")


def main() -> None:
    import uvicorn

    with suppress(KeyboardInterrupt):
        uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("BRICKYARD_PORT", "8000")))
