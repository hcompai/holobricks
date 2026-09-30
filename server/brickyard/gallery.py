"""Export builds as a static, read-only gallery: `brickyard-gallery SITE_DIR BUILD_ID...`.

web/scripts/thumbnails.mjs then draws their library tiles from their models.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from brickyard.model import Build
from brickyard.store import Store
from brickyard.workspace import bundle

URL = "/gallery"


def export(store: Store, ids: list[str], site: Path) -> Path:
    """Write every file the viewer reads for these builds under `site/gallery` but their tiles; returns that folder."""
    out = site / URL.strip("/")
    shutil.rmtree(out, ignore_errors=True)
    for folder in ("builds", "images/small"):
        (out / folder).mkdir(parents=True, exist_ok=True)
    summaries = []
    for build in (_load(store, i) for i in ids):
        for message in build.messages:
            message.images = [_image(store, url, out) for url in message.images]
        shown = bundle(build) | build.model_dump(include={"status", "messages"})
        (out / "builds" / f"{build.id}.json").write_text(json.dumps(shown, separators=(",", ":")))
        summaries.append(build.summary())
    (out / "builds.json").write_text(json.dumps(summaries))
    return out


def _load(store: Store, build_id: str) -> Build:
    build = store.load(build_id)
    if build is None:
        raise SystemExit(f"no build {build_id} in {store.root}")
    if build.status == "building":
        raise SystemExit(f"build {build_id} is still running")
    return build


def _image(store: Store, url: str, out: Path) -> str:
    name = url.rsplit("/", 1)[-1]
    shutil.copy(store.image(name), out / "images" / name)
    shutil.copy(store.small_image(name), out / "images" / "small" / f"{name}.webp")
    return f"{URL}/images/{name}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path, help="static site folder; the gallery goes in its gallery/ subfolder")
    parser.add_argument("ids", nargs="+", help="build ids, in gallery order")
    args = parser.parse_args()
    out = export(Store(), args.ids, args.site)
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"Exported {len(args.ids)} builds to {out} ({size / 1e6:.1f} MB)")
