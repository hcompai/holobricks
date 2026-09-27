"""Hidden Chrome tabs on the builds that ask for renders, so renders never wait for the user to keep a build open."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile

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
IDLE_S = 600


def chrome() -> str | None:
    """BRICKYARD_CHROME, or the first Chrome or Chromium found on this machine."""
    for candidate in (os.environ.get("BRICKYARD_CHROME"), *CHROMES):
        if candidate and (found := shutil.which(candidate)):
            return found
    return None


class Tab:
    """A headless Chrome on one page, with its own throwaway profile."""

    def __init__(self, process: asyncio.subprocess.Process, profile: tempfile.TemporaryDirectory):
        self.process = process
        self.profile = profile

    @classmethod
    async def open(cls, binary: str, url: str, *flags: str) -> Tab:
        profile = tempfile.TemporaryDirectory(prefix="brickyard-viewer-")
        process = await asyncio.create_subprocess_exec(
            binary,
            "--headless=new",
            f"--user-data-dir={profile.name}",
            "--no-first-run",
            "--no-default-browser-check",
            "--mute-audio",
            "--window-size=1280,800",
            *flags,
            url,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        return cls(process, profile)

    @property
    def running(self) -> bool:
        return self.process.returncode is None

    async def close(self) -> None:
        if self.running:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), STOP_S)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()
        self.profile.cleanup()


class Viewers:
    """One hidden viewer per build that asks for a render, open until released or IDLE_S after its last render."""

    def __init__(self, url: str):
        self.url = url
        self.binary = chrome()
        self._open: dict[str, Tab] = {}
        self._idle: dict[str, asyncio.TimerHandle] = {}
        self._lock = asyncio.Lock()
        if self.binary is None:
            log.warning("No Chrome or Chromium found (set BRICKYARD_CHROME): renders need an open tab on the build.")

    async def watch(self, build_id: str) -> None:
        """Keep a viewer on the build for IDLE_S more seconds, starting one if none is running."""
        if self.binary is None:
            return
        async with self._lock:
            opened = self._open.get(build_id)
            if opened is None or not opened.running:
                self._open[build_id] = await Tab.open(self.binary, f"{self.url}/?build={build_id}&renderer=1")
            if timer := self._idle.pop(build_id, None):
                timer.cancel()
            self._idle[build_id] = asyncio.get_running_loop().call_later(
                IDLE_S, lambda: asyncio.ensure_future(self.release(build_id))
            )

    async def release(self, build_id: str) -> None:
        if timer := self._idle.pop(build_id, None):
            timer.cancel()
        opened = self._open.pop(build_id, None)
        if opened is not None:
            await opened.close()

    async def stop(self) -> None:
        await asyncio.gather(*(self.release(build_id) for build_id in list(self._open)))
