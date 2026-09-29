"""The library of finished builds the showcase writes and the static gallery publishes."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import PIL.Image

from brickyard.model import Build
from brickyard.workspace import write

DATA = Path(os.environ.get("BRICKYARD_DATA", Path(__file__).resolve().parents[2] / "data"))
SMALL_EDGE = 240
"""The short side of the chat's small images, twice their size on screen."""


class Store:
    def __init__(self, root: Path = DATA):
        self.root = root / "builds"
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, build: Build) -> None:
        write(self.root / f"{build.id}.json", build.model_dump_json())

    @staticmethod
    def _file(folder: Path, name: str) -> Path:
        """`folder / name`; raises ValueError for names that reach outside `folder`."""
        path = os.path.realpath(folder / name)
        if not path.startswith(os.path.realpath(folder) + os.sep):
            raise ValueError(f"bad file name {name!r}")
        return Path(path)

    def thumbnail(self, build_id: str) -> Path:
        return self._file(self.root.parent / "thumbnails", f"{build_id}.png")

    def thumbnail_version(self, build_id: str) -> int | None:
        """When the thumbnail was saved, in milliseconds; None when there is none."""
        path = self.thumbnail(build_id)
        return path.stat().st_mtime_ns // 1_000_000 if path.exists() else None

    def image(self, name: str) -> Path:
        return self._file(self.root.parent / "images", name)

    def small_image(self, name: str) -> Path:
        """The image as WebP with its short side at most SMALL_EDGE, for the chat; made on first use."""
        path = self._file(self.root.parent / "images" / "small", f"{name}.webp")
        if not path.exists():
            with PIL.Image.open(self.image(name)) as image:
                edge = SMALL_EDGE * max(image.size) // min(image.size)
                image.thumbnail((edge, edge))
                path.parent.mkdir(exist_ok=True)
                tmp = path.with_name(f"{uuid.uuid4().hex}.tmp")
                image.save(tmp, "WEBP", quality=80)
            tmp.replace(path)
        return path

    def load(self, build_id: str) -> Build | None:
        try:
            path = self._file(self.root, f"{build_id}.json")
        except ValueError:
            return None
        return Build.model_validate_json(path.read_text()) if path.exists() else None
