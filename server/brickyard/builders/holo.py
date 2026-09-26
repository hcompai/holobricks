"""Holo as a builder: a sagent agent that edits build.py in its own workspace and runs it with the bricks CLI."""

from __future__ import annotations

import asyncio
import os
import signal
import sys
import time
from pathlib import Path

from brickyard.guide import guide
from brickyard.model import baseplate
from brickyard.session import Session
from brickyard.workbench import Workbench

AGENT = Path(__file__).resolve().parents[3] / "agent" / "holo.py"
GREEN = 2
EARLIER = 10
EARLIER_CHARS = 400
STOP_S = 10


class HoloBuilder:
    """Runs the agent command once per request, with the task on stdin and the build in BRICKYARD_* variables."""

    name = "holo"

    def __init__(self, command: list[str], url: str):
        self.command = command
        self.url = url

    @classmethod
    def from_env(cls) -> HoloBuilder | None:
        """Holo needs a hai checkout with its venv, in HAI_ROOT, for sagent."""
        python = Path(os.environ.get("HAI_ROOT", "/nonexistent")) / ".venv" / "bin" / "python"
        if not python.exists():
            return None
        return cls([str(python), str(AGENT)], f"http://127.0.0.1:{os.environ.get('BRICKYARD_PORT', '8000')}")

    async def run(self, session: Session, request: str) -> None:
        build = session.build
        if not build.pieces:
            await session.step("Baseplate", [baseplate(GREEN)])
        workspace = session.store.root.parent / "workspaces" / build.id
        runs = workspace / "runs"
        runs.mkdir(parents=True, exist_ok=True)
        (workspace / "build.py").write_text(build.script)
        task = await asyncio.to_thread(self.task, session, request)
        run = runs / time.strftime("%Y%m%d-%H%M%S")
        env = os.environ | {
            "BRICKYARD_URL": self.url,
            "BRICKYARD_BUILD": build.id,
            "BRICKYARD_WORKSPACE": str(workspace),
            "BRICKYARD_TRAJECTORY": f"{run}.jsonl",
            "BRICKYARD_BIN": str(Path(sys.executable).parent),
        }
        log = await asyncio.to_thread(open, f"{run}.log", "wb")
        with log:
            process = await asyncio.create_subprocess_exec(
                *self.command,
                stdin=asyncio.subprocess.PIPE,
                stdout=log,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
                cwd=workspace,
                start_new_session=True,
            )
            try:
                await process.communicate(task.encode())
            finally:
                if process.returncode is None:
                    await _stop(process)
        if process.returncode:
            raise RuntimeError(f"Holo exited with code {process.returncode}; its log is {run}.log")

    @staticmethod
    def task(session: Session, request: str) -> str:
        """The request, the guide to the build script, and the model as it stands."""
        build = session.build
        earlier = [
            f"{m.role}: {m.text[:EARLIER_CHARS]}" for m in build.messages[:-1] if m.role in ("user", "assistant")
        ][-EARLIER:]
        parts = [f"# Request\n{request}"]
        if earlier:
            parts.append("# Earlier in this chat\n" + "\n".join(earlier))
        parts.append(guide(build.width, build.depth))
        parts.append(f"# The model now\n{Workbench(session).brief()}\n`build.py` in your workspace holds this script.")
        return "\n\n".join(parts)


async def _stop(process: asyncio.subprocess.Process) -> None:
    """Ask the agent's process group to stop, then kill it."""
    os.killpg(process.pid, signal.SIGTERM)
    try:
        await asyncio.wait_for(process.wait(), STOP_S)
    except TimeoutError:
        os.killpg(process.pid, signal.SIGKILL)
        await process.wait()
