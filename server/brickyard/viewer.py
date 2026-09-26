"""A headless Chrome tab on a build, so renders never wait for the user to keep the build open."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
import tempfile
from collections.abc import AsyncIterator

log = logging.getLogger("brickyard")
CHROMES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
)
STOP_S = 5


def chrome() -> str | None:
    """BRICKYARD_CHROME, or the first Chrome or Chromium found on this machine."""
    for candidate in (os.environ.get("BRICKYARD_CHROME"), *CHROMES):
        if candidate and (found := shutil.which(candidate)):
            return found
    return None


@contextlib.asynccontextmanager
async def headless(url: str, build_id: str) -> AsyncIterator[bool]:
    """Keep the viewer open on a build while the block runs; yields whether a browser was found."""
    binary = chrome()
    if binary is None:
        log.warning("No Chrome or Chromium found (set BRICKYARD_CHROME): renders need an open tab on the build.")
        yield False
        return
    with tempfile.TemporaryDirectory(prefix="brickyard-viewer-") as profile:
        process = await asyncio.create_subprocess_exec(
            binary,
            "--headless=new",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--mute-audio",
            "--window-size=1280,800",
            f"{url}/?build={build_id}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            yield True
        finally:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), STOP_S)
            except TimeoutError:
                process.kill()
                await process.wait()
