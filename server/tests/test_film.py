import socket
import subprocess
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn

from brickyard import ldraw
from brickyard.film import GIF_MAX_BYTES, ffmpeg
from brickyard.model import Build, Piece, Step, place
from brickyard.viewer import chrome

WEB = Path(__file__).resolve().parents[2] / "web" / "dist" / "index.html"
pytestmark = pytest.mark.skipif(
    not (ldraw.LDRAW.exists() and chrome() and ffmpeg() and WEB.exists()),
    reason="needs LDraw, Chrome, ffmpeg and the built web app",
)


@pytest.fixture
def server(tmp_path, monkeypatch):
    from brickyard import app as app_module
    from brickyard.session import Store

    store = Store(tmp_path)
    monkeypatch.setattr(app_module, "store", store)
    placements = [place("3001.dat", 4 * (i % 2), 0, 3 * (i // 2), [4, 14, 1, 2][i]) for i in range(4)]
    pieces = [Piece(id=i, step=i // 2, **p.model_dump()) for i, p in enumerate(placements)]
    store.save(
        Build(
            id="tiny",
            name="Tiny tower",
            prompt="a tiny tower",
            builder="holo",
            status="done",
            steps=[Step(index=0, title="Base"), Step(index=1, title="Top")],
            pieces=pieces,
        )
    )
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    running = uvicorn.Server(uvicorn.Config(app_module.app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=running.run, daemon=True)
    thread.start()
    while not running.started:
        time.sleep(0.05)
    with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30) as client:
        yield client
    running.should_exit = True
    thread.join()


def test_a_film_job_renders_a_decodable_mp4_with_clicks_and_a_gif_under_the_cap(server, tmp_path):
    options = {"width": 160, "height": 90, "seconds": 6, "fps": 10, "samples": 1, "clicks": True}
    job = server.post("/api/builds/tiny/film", json=options).json()
    for _ in range(600):
        job = server.get(f"/api/films/{job['id']}").json()
        if job["status"] not in ("queued", "rendering", "encoding"):
            break
        time.sleep(0.2)
    assert job["status"] == "done", job["error"]
    assert job["frames"] == 60 and job["options"]["branded"]
    video = tmp_path / "film.mp4"
    download = server.get(f"/api/films/{job['id']}/film.mp4")
    assert download.headers["content-disposition"].endswith("Tiny%20tower-build.mp4")
    video.write_bytes(download.content)
    decoded = subprocess.run(
        [ffmpeg(), "-v", "error", "-i", video, "-map", "0:v", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
        check=True,
    ).stdout
    assert len(decoded) == 60 * 160 * 90 * 3
    audio = subprocess.run([ffmpeg(), "-v", "error", "-i", video, "-map", "0:a", "-f", "null", "-"], check=False)
    assert audio.returncode == 0
    first, last = decoded[: 160 * 90 * 3], decoded[-160 * 90 * 3 :]
    assert first != last
    image = server.get(f"/api/films/{job['id']}/film.gif").content
    assert image.startswith(b"GIF89a") and len(image) <= GIF_MAX_BYTES
    assert job["files"]["gif"]["width"] == 160 and job["files"]["gif"]["height"] == 90
