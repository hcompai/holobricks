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


def bundle(build: Build) -> dict:
    """The build as the browser shows it: every part packed into one MPD each, the LDraw file, parts list and shopping list."""
    parts = sorted({p.part for p in build.pieces})
    return build.model_dump(exclude={"script", "messages", "status"}) | {
        "parts": {part: ldraw.pack(part) for part in parts},
        "ldr": build.to_ldraw(),
        "bom": _verified(build.bom),
        "shopping": _verified(lambda: shopping.package(build)),
    }


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
                self.folder / MODEL, gzip.compress(json.dumps(bundle(build), separators=(",", ":")).encode(), mtime=0)
            )
            write(self.folder / BUILD, build.model_dump_json())
        self.build = build

    def commit(self, candidate: Build) -> None:
        """Take the rebuilt model; its time of change moves only when its geometry did."""
        changes = {name: getattr(candidate, name) for name in ("script", "steps", "pieces", "width", "depth")}
        changes["updated"] = time.time() if candidate.revision != self.build.revision else self.build.updated
        self.save(self.build.model_copy(update=changes))
