"""Holo as a builder: a sagent agent that edits build.py in its own workspace and runs it with the bricks CLI."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import sys
import time
from pathlib import Path

from brickyard.session import Session

AGENT = Path(__file__).resolve().parents[3] / "agent" / "holo.py"
SHOWCASE = AGENT.parent / "showcase"
STOP_S = 10
REFERENCES = "references"


class HoloBuilder:
    """Runs the agent command once per request, with the request on stdin and the build in BRICKYARD_* variables."""

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

    async def run(self, session: Session, request: str, references: list[Path]) -> None:
        build = session.build
        workspace = session.store.root.parent / "workspaces" / build.id
        runs = workspace / "runs"
        runs.mkdir(parents=True, exist_ok=True)
        (workspace / "build.py").write_text(build.script)
        if not os.path.lexists(workspace / "showcase"):
            (workspace / "showcase").symlink_to(SHOWCASE, target_is_directory=True)
        attached = await asyncio.to_thread(self.keep_references, workspace, references)
        run = runs / time.strftime("%Y%m%d-%H%M%S")
        env = os.environ | {
            "BRICKYARD_URL": self.url,
            "BRICKYARD_BUILD": build.id,
            "BRICKYARD_WORKSPACE": str(workspace),
            "BRICKYARD_TRAJECTORY": f"{run}.jsonl",
            "BRICKYARD_BIN": str(Path(sys.executable).parent),
            "BRICKYARD_REFERENCES": json.dumps([str(workspace / name) for name in attached]),
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
                await process.communicate(request.encode())
            finally:
                if process.returncode is None:
                    await _stop(process)
        if process.returncode:
            raise RuntimeError(f"Holo exited with code {process.returncode}; its log is {run}.log")

    @staticmethod
    def keep_references(workspace: Path, references: list[Path]) -> list[str]:
        """Copy the request's images into the workspace's references/; returns their workspace paths."""
        folder = workspace / REFERENCES
        folder.mkdir(exist_ok=True)
        for path in references:
            shutil.copyfile(path, folder / path.name)
        return [f"{REFERENCES}/{path.name}" for path in references]


async def _stop(process: asyncio.subprocess.Process) -> None:
    """Ask the agent's process group to stop, then kill it."""
    os.killpg(process.pid, signal.SIGTERM)
    try:
        await asyncio.wait_for(process.wait(), STOP_S)
    except TimeoutError:
        os.killpg(process.pid, signal.SIGKILL)
        await process.wait()
