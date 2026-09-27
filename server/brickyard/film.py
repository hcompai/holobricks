"""Build films: a headless Chrome renders every frame of the web app's film, ffmpeg encodes an MP4 master and a GIF."""

from __future__ import annotations

import argparse
import array
import asyncio
import logging
import math
import os
import random
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import uuid
import wave
from contextlib import suppress
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, Field

from brickyard.model import Build
from brickyard.viewer import Tab, chrome

log = logging.getLogger("brickyard")
ASPECTS = {"16:9": (1920, 1080), "1:1": (1080, 1080), "9:16": (1080, 1920)}
GIF_MAX_BYTES = 15 * 1024 * 1024
"""X's GIF upload limit."""
GIF_STEPS = ((720, 30), (720, 25), (640, 25), (540, 25), (540, 20), (480, 20), (400, 15))
"""GIF long sides and frame rates, best first; the first that fits under GIF_MAX_BYTES wins."""
IDLE_S = 180
"""How long the film page may go without a frame, loading the parts included."""
KEEP_S = 3600
CHROME_FLAGS = (
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--enable-unsafe-swiftshader",
)
X264 = (
    *("-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p"),
    *("-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"),
    *("-movflags", "+faststart"),
)
RGB_TO_YUV = "scale=out_color_matrix=bt709:out_range=tv"
CLICK_GAP_S = 0.045
"""At most one landing click this often, however many pieces land."""
RATE = 48000


class FilmError(Exception):
    pass


def ffmpeg() -> str | None:
    """BRICKYARD_FFMPEG, or ffmpeg on the PATH."""
    return shutil.which(os.environ.get("BRICKYARD_FFMPEG", "ffmpeg"))


class FilmOptions(BaseModel):
    aspect: Literal["16:9", "1:1", "9:16"] = "16:9"
    width: int | None = Field(None, ge=64, le=3840, multiple_of=2, description="overrides the aspect's width")
    height: int | None = Field(None, ge=64, le=3840, multiple_of=2, description="overrides the aspect's height")
    seconds: int = Field(20, ge=6, le=60)
    fps: int = Field(60, ge=10, le=60)
    samples: int | None = Field(None, ge=1, le=64, description="renders averaged per frame; default fits the budget")
    budget: float = Field(900, gt=0, le=6 * 3600, description="seconds of rendering to spend on samples")
    gif: bool = True
    branded: bool | None = Field(None, description="HOLO4 / H Company branding; default for Holo builds only")
    label: str | None = Field(None, max_length=40, description="a large corner title, naming a comparison's side")
    clicks: bool = Field(False, description="a soft click as pieces land")
    dof: bool = Field(False, description="tilt-shift blur")

    @property
    def size(self) -> tuple[int, int]:
        width, height = ASPECTS[self.aspect]
        return self.width or width, self.height or height


class FilmStart(BaseModel):
    frames: int = Field(ge=1)
    samples: int = Field(ge=1)
    landings: list[int]


class Film:
    """One render: queued, then rendering in a headless tab, then encoding, then done with its files."""

    def __init__(self, build: Build, options: FilmOptions, folder: Path):
        self.id = uuid.uuid4().hex[:12]
        self.build = build
        self.options = options
        self.folder = folder
        self.status: Literal["queued", "rendering", "encoding", "done", "error", "cancelled"] = "queued"
        self.error: str | None = None
        self.frames = 0
        self.samples = options.samples
        self.landings: list[int] = []
        self.next = 0
        self.active = time.monotonic()
        self.elapsed = 0.0
        self.finished: float | None = None
        self.files: dict[str, dict] = {}
        self.encoder: asyncio.subprocess.Process | None = None
        self.rendered = asyncio.Event()
        self.task: asyncio.Task | None = None

    @property
    def branded(self) -> bool:
        return self.options.branded if self.options.branded is not None else self.build.builder == "holo"

    def summary(self) -> dict:
        width, height = self.options.size
        o = self.options
        done = self.status in ("encoding", "done")
        return {
            "id": self.id,
            "build": self.build.id,
            "name": self.build.name,
            "status": self.status,
            "progress": 1.0 if done else self.next / self.frames if self.frames else 0.0,
            "error": self.error,
            "frames": self.frames,
            "samples": self.samples,
            "budget": o.budget,
            "elapsed": round(self.elapsed, 1),
            "options": {
                "width": width,
                "height": height,
                "seconds": o.seconds,
                "fps": o.fps,
                "samples": o.samples,
                "branded": self.branded,
                "label": o.label,
                "dof": o.dof,
            },
            "files": self.files,
        }


class Films:
    """Film jobs, rendered one at a time since they share the GPU."""

    def __init__(self, web: Path):
        self.web = web
        self.jobs: dict[str, Film] = {}
        self._turn = asyncio.Lock()

    def missing(self) -> str | None:
        """Why films cannot be rendered here, or None."""
        if chrome() is None:
            return "No Chrome or Chromium found (set BRICKYARD_CHROME)."
        if ffmpeg() is None:
            return "No ffmpeg found (set BRICKYARD_FFMPEG)."
        if not (self.web / "index.html").exists():
            return "The web app is not built (cd web && npm run build)."
        return None

    def create(self, build: Build, options: FilmOptions, url: str) -> Film:
        """Queue a film of this frozen build; `url` serves the web app to the headless tab."""
        now = time.monotonic()
        for old in [f for f in self.jobs.values() if f.finished and now - f.finished > KEEP_S]:
            self.forget(old)
        film = Film(build, options, Path(tempfile.mkdtemp(prefix="brickyard-film-")))
        self.jobs[film.id] = film
        film.task = asyncio.create_task(self._run(film, url))
        return film

    def get(self, job: str) -> Film | None:
        return self.jobs.get(job)

    def forget(self, film: Film) -> None:
        if film.task and not film.task.done():
            film.task.cancel()
        self.jobs.pop(film.id, None)
        shutil.rmtree(film.folder, ignore_errors=True)

    async def _run(self, film: Film, url: str) -> None:
        try:
            async with self._turn:
                film.status = "rendering"
                film.active = start = time.monotonic()
                tab = await Tab.open(chrome() or "", f"{url}/?build={film.build.id}&film={film.id}", *CHROME_FLAGS)
                try:
                    while not film.rendered.is_set():
                        with suppress(TimeoutError):
                            await asyncio.wait_for(film.rendered.wait(), 1)
                        if not film.rendered.is_set() and not tab.running:
                            raise FilmError("The film page closed before its last frame.")
                        if time.monotonic() - film.active > IDLE_S:
                            raise FilmError(f"The film page sent no frame for {IDLE_S} seconds.")
                finally:
                    await tab.close()
                if film.error:
                    raise FilmError(film.error)
                if film.encoder and await film.encoder.wait():
                    raise FilmError(f"ffmpeg failed: {_tail(film.folder / 'ffmpeg.log')}")
                film.elapsed = time.monotonic() - start
            film.status = "encoding"
            await self._finish(film)
            film.status = "done"
        except asyncio.CancelledError:
            film.status = "cancelled"
        except Exception as e:
            log.exception("film %s of build %s failed", film.id, film.build.id)
            film.status = "error"
            film.error = str(e)
        finally:
            if film.encoder and film.encoder.returncode is None:
                film.encoder.kill()
            film.finished = time.monotonic()

    async def start(self, film: Film, body: FilmStart) -> None:
        """The film page is ready: open the encoder for its frames."""
        o = film.options
        if film.status != "rendering" or film.encoder:
            raise FilmError(f"film {film.id} is {film.status}")
        if body.frames != o.seconds * o.fps or len(body.landings) != body.frames:
            raise FilmError(f"expected {o.seconds * o.fps} frames and as many landings")
        width, height = o.size
        film.frames, film.samples, film.landings = body.frames, body.samples, body.landings
        film.active = time.monotonic()
        with (film.folder / "ffmpeg.log").open("wb") as errors:
            film.encoder = await asyncio.create_subprocess_exec(
                ffmpeg() or "ffmpeg",
                *("-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{width}x{height}"),
                *("-framerate", str(o.fps), "-i", "-", "-vf", RGB_TO_YUV, *X264, str(film.folder / "video.mp4")),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=errors,
            )

    async def frame(self, film: Film, index: int, samples: int, rgba: bytes) -> None:
        width, height = film.options.size
        if film.status != "rendering" or film.encoder is None or film.encoder.stdin is None:
            raise FilmError(f"film {film.id} is not taking frames")
        if index != film.next:
            raise FilmError(f"expected frame {film.next}, got {index}")
        if len(rgba) != width * height * 4:
            raise FilmError(f"frame {index} has {len(rgba)} bytes, not {width * height * 4}")
        film.encoder.stdin.write(rgba)
        await film.encoder.stdin.drain()
        film.next += 1
        film.samples = samples
        film.active = time.monotonic()
        if film.next == film.frames:
            film.encoder.stdin.close()
            film.rendered.set()

    def fail(self, film: Film, message: str) -> None:
        film.error = message or "The film page failed."
        film.rendered.set()

    async def _finish(self, film: Film) -> None:
        """Add the landing clicks to the master if asked, then derive the GIF from it."""
        o = film.options
        width, height = o.size
        video = film.folder / "video.mp4"
        master = film.folder / "film.mp4"
        if o.clicks:
            clicks(film.landings, o.fps, film.folder / "clicks.wav")
            await asyncio.to_thread(
                _ffmpeg,
                *("-i", video, "-i", film.folder / "clicks.wav", "-map", "0:v", "-map", "1:a", "-c:v", "copy"),
                *("-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", master),
            )
            video.unlink()
        else:
            video.rename(master)
        film.files["mp4"] = {"size": master.stat().st_size, "width": width, "height": height, "fps": o.fps}
        if o.gif:
            film.files["gif"] = await asyncio.to_thread(gif, master, film.folder / "film.gif")

    async def stop(self) -> None:
        for film in list(self.jobs.values()):
            self.forget(film)


def _ffmpeg(*args: str | Path) -> None:
    result = subprocess.run(
        [ffmpeg() or "ffmpeg", "-v", "error", "-y", *map(str, args)], capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise FilmError(f"ffmpeg failed: {result.stderr.strip()[-500:]}")


def _tail(path: Path) -> str:
    return path.read_text(errors="replace").strip()[-500:] if path.exists() else ""


def gif(source: Path, out: Path, max_bytes: int = GIF_MAX_BYTES) -> dict:
    """A looping GIF of the video with one palette for the whole film, at the best size and rate under `max_bytes`."""
    for long, fps in GIF_STEPS:
        size = f"'if(gte(iw,ih),min(iw,{long}),-2)':'if(gte(iw,ih),-2,min(ih,{long}))'"
        scale = f"fps={fps},scale={size}:flags=lanczos"
        with tempfile.TemporaryDirectory() as tmp:
            palette = Path(tmp) / "palette.png"
            _ffmpeg(
                "-i", source, "-vf", f"{scale},palettegen=stats_mode=diff", "-frames:v", "1", "-update", "1", palette
            )
            dither = "paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"
            _ffmpeg("-i", source, "-i", palette, "-lavfi", f"{scale}[x];[x][1:v]{dither}", "-loop", "0", out)
        if (length := out.stat().st_size) <= max_bytes:
            width, height = struct.unpack("<HH", out.read_bytes()[6:10])
            return {"size": length, "width": width, "height": height, "fps": fps}
    raise FilmError(f"Even the smallest GIF is over {max_bytes / 2**20:.0f} MB; try a shorter film.")


def clicks(landings: list[int], fps: int, path: Path) -> None:
    """A soft plastic tick when pieces land, louder for more pieces, at most one every CLICK_GAP_S."""
    rng = random.Random(0)
    length = int(RATE * len(landings) / fps)
    track = [0.0] * (length + RATE // 10)
    last = -math.inf
    for frame, count in enumerate(landings):
        at = frame / fps
        if not count or at - last < CLICK_GAP_S:
            continue
        last = at
        gain = 0.22 * min(1.0, 0.45 + 0.12 * math.log2(1 + count))
        pitch = rng.uniform(0.85, 1.2)
        start = int(at * RATE)
        for k in range(int(0.03 * RATE)):
            s = k / RATE
            body = 0.65 * math.sin(2 * math.pi * 2100 * pitch * s) + 0.3 * math.sin(2 * math.pi * 3500 * pitch * s)
            snap = rng.uniform(-1, 1) * math.exp(-s / 0.0015)
            track[start + k] += gain * (1 - math.exp(-s / 0.0004)) * (math.exp(-s / 0.007) * body + 0.4 * snap)
    peak = max(0.5, max(map(abs, track), default=0))
    samples = array.array("h", (int(v / peak * 0.5 * 32767) for v in track))
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(samples.tobytes())


def compose(first: Path, second: Path, out: Path, vertical: bool, audio: bool) -> None:
    """Both films side by side (or stacked when `vertical`), split by a thin line."""
    stack, line = ("vstack", "x=0:y=ih/2-2:w=iw:h=4") if vertical else ("hstack", "x=iw/2-2:y=0:w=4:h=ih")
    video = f"[0:v][1:v]{stack}=inputs=2,drawbox={line}:color=0x1c1c26@0.2:t=fill[v]"
    sound = ";[0:a][1:a]amix=inputs=2:normalize=0[a]" if audio else ""
    mapping = ("-map", "[v]", *(("-map", "[a]", "-c:a", "aac", "-b:a", "160k") if audio else ()))
    _ffmpeg("-i", first, "-i", second, "-filter_complex", video + sound, *mapping, *X264, out)


def stem(name: str) -> str:
    """A file name for a build, like the web app's downloads."""
    safe = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "-", name)[:100].rstrip(". ").strip()
    return f"{safe or 'brickyard'}-build"


def _render(client: httpx.Client, build: str, options: FilmOptions, out: Path, name: str) -> dict:
    """Render one film on the server, showing progress, and download its files as `out/name.*`."""
    response = client.post(f"/api/builds/{build}/film", json=options.model_dump(exclude_none=True))
    if response.is_error:
        sys.exit(f"brickyard-film: {response.status_code} {response.text}")
    job = response.json()
    while job["status"] in ("queued", "rendering", "encoding"):
        time.sleep(2)
        job = client.get(f"/api/films/{job['id']}").json()
        samples = f", {job['samples']} samples" if job["samples"] else ""
        print(f"\r{job['name']}: {job['status']} {job['progress']:.0%}{samples}   ", end="", file=sys.stderr)
    print(file=sys.stderr)
    if job["status"] != "done":
        sys.exit(f"brickyard-film: {job['name']} {job['status']}: {job['error']}")
    for kind in job["files"]:
        with (
            client.stream("GET", f"/api/films/{job['id']}/film.{kind}") as download,
            (out / f"{name}.{kind}").open("wb") as file,
        ):
            for chunk in download.iter_bytes():
                file.write(chunk)
    return job


def _report(path: Path, job: dict | None = None) -> None:
    stats = f" · {job['frames']} frames · {job['samples']} samples · {job['elapsed']:.0f} s rendering" if job else ""
    print(f"{path} · {path.stat().st_size / 2**20:.1f} MB{stats}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="brickyard-film", description="Render a build's film to MP4 and GIF on a running Brickyard server."
    )
    parser.add_argument("build", help="build id")
    parser.add_argument("--vs", metavar="BUILD", help="film a second build the same way and put the two side by side")
    parser.add_argument("--labels", nargs=2, metavar=("FIRST", "SECOND"), help="comparison titles; default: names")
    parser.add_argument("--aspect", choices=list(ASPECTS), default="16:9")
    parser.add_argument("--seconds", type=int, default=20)
    parser.add_argument("--fps", type=int, default=60)
    parser.add_argument("--samples", type=int, help="renders averaged per frame; default: as many as --minutes allow")
    parser.add_argument("--minutes", type=float, default=15, help="rendering budget (default 15)")
    parser.add_argument("--no-gif", dest="gif", action="store_false")
    parser.add_argument("--clicks", action="store_true", help="a soft click as pieces land")
    parser.add_argument("--dof", action="store_true", help="tilt-shift blur")
    parser.add_argument("--out", type=Path, default=Path())
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    common = {"seconds": args.seconds, "fps": args.fps, "samples": args.samples, "clicks": args.clicks, "dof": args.dof}
    url = os.environ.get("BRICKYARD_URL", "http://127.0.0.1:8000")
    with httpx.Client(base_url=url, timeout=60) as client:
        names = {b["id"]: b["name"] for b in client.get("/api/builds").json()}
        for build in filter(None, (args.build, args.vs)):
            if build not in names:
                sys.exit(f"brickyard-film: no build {build} on {url}")
        if not args.vs:
            options = FilmOptions(aspect=args.aspect, budget=args.minutes * 60, gif=args.gif, **common)
            job = _render(client, args.build, options, args.out, stem(names[args.build]))
            for kind in job["files"]:
                _report(args.out / f"{stem(names[args.build])}.{kind}", job)
            return
        if ffmpeg() is None:
            sys.exit("brickyard-film: comparisons need ffmpeg here (set BRICKYARD_FFMPEG)")
        width, height = ASPECTS[args.aspect]
        vertical = height > width
        half = {"width": width, "height": height // 2} if vertical else {"width": width // 2, "height": height}
        builds = (args.build, args.vs)
        labels = args.labels or [names[b] for b in builds]
        halves = []
        for build, label in zip(builds, labels, strict=True):
            options = FilmOptions(
                aspect=args.aspect, **half, budget=args.minutes * 30, gif=False, branded=False, label=label, **common
            )
            name = f"{stem(names[build])}-{uuid.uuid4().hex[:6]}"
            halves.append((_render(client, build, options, args.out, name), args.out / f"{name}.mp4"))
    both = stem(f"{names[args.build]} vs {names[args.vs]}")
    video, animation = args.out / f"{both}.mp4", args.out / f"{both}.gif"
    compose(halves[0][1], halves[1][1], video, vertical, args.clicks)
    for job, path in halves:
        _report(path, job)
        path.unlink()
    _report(video)
    if args.gif:
        gif(video, animation)
        _report(animation)
