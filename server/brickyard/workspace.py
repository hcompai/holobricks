"""The build being edited: `build.json` is the model, `model.json.gz` everything the browser renders it from."""

from __future__ import annotations

import gzip
import json
import time
import uuid
from collections.abc import Callable
from pathlib import Path

from brickyard import ldraw, shopping
from brickyard.model import Build

BUILD = "build.json"
MODEL = "model.json.gz"


def write(path: Path, data: str | bytes) -> None:
    tmp = path.with_name(f".{uuid.uuid4().hex}.tmp")
    tmp.write_bytes(data.encode() if isinstance(data, str) else data)
    tmp.replace(path)


def bundle(build: Build, *, recovery: bool = False) -> dict:
    """The build as the browser shows it: every part packed into one MPD each, the LDraw file, parts list and shopping list."""
    parts = sorted({p.part for p in build.pieces})
    model = build.model_dump(exclude={"script", "recovery_script", "messages", "status"}) | {
        "parts": {part: ldraw.pack(part) for part in parts},
        "ldr": build.to_ldraw(),
        "bom": _verified(build.bom),
        "shopping": _verified(lambda: shopping.package(build)),
    }
    if recovery and build.recovery_script is not None:
        model["recovery"] = {"version": 1, "revision": build.revision, "script": build.recovery_script}
    return model


def _verified(make: Callable[[], dict]) -> dict:
    try:
        return make()
    except ValueError as exc:
        return {"error": str(exc)}


class Workspace:
    """A build and, when it has a folder, the files that keep it."""

    def __init__(self, build: Build, folder: Path | None = None):
        self.build = build
        self.folder = folder

    @classmethod
    def open(cls, folder: Path) -> Workspace:
        path = folder / BUILD
        return cls(Build.model_validate_json(path.read_text()) if path.exists() else Build(builder="holo"), folder)

    @property
    def evidence(self) -> Path:
        """Where the accepted assembly plan and its report are kept."""
        if self.folder is None:
            raise ValueError("An unsaved build keeps no assembly evidence.")
        return self.folder / ".brickyard-assembly"

    def save(self, build: Build | None = None) -> None:
        """Keep `build`, the current one by default, as the current one once its files are written."""
        build = build or self.build
        if self.folder is not None:
            write(
                self.folder / MODEL,
                gzip.compress(json.dumps(bundle(build, recovery=True), separators=(",", ":")).encode(), mtime=0),
            )
            write(self.folder / BUILD, build.model_dump_json())
        self.build = build

    def commit(self, candidate: Build) -> None:
        """Take the rebuilt model; its time of change moves only when its geometry did."""
        changes = {name: getattr(candidate, name) for name in ("script", "steps", "pieces", "width", "depth")}
        changes["recovery_script"] = candidate.script
        changes["updated"] = time.time() if candidate.revision != self.build.revision else self.build.updated
        self.save(self.build.model_copy(update=changes))

    def restore(self, path: Path) -> None:
        """Restore an attached checkpoint in a fresh workspace without executing its script."""
        if self.folder is None or (self.folder / BUILD).exists() or (self.folder / "build.py").exists():
            raise ValueError("Restore needs a fresh workspace; the existing build was left unchanged.")
        raw = path.read_bytes()
        model = json.loads(gzip.decompress(raw) if raw.startswith(b"\x1f\x8b") else raw)
        checkpoint = model.get("recovery") or {}
        if checkpoint.get("version") != 1 or not isinstance(checkpoint.get("script"), str):
            raise ValueError("This model has no supported recovery checkpoint.")
        source = checkpoint["script"]
        build = Build.model_validate(model | {"script": source, "recovery_script": source, "messages": []})
        if build.revision != model.get("revision") or build.revision != checkpoint.get("revision"):
            raise ValueError("The recovery checkpoint does not match this model's revision.")
        self.save(build)
        write(self.folder / "build.py", source)
