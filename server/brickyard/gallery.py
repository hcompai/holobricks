"""Export builds as a static, read-only gallery: `brickyard-gallery SITE_DIR BUILD_ID...`."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from brickyard import ldraw, shopping
from brickyard.model import Build
from brickyard.session import Store

URL = "/gallery"


def export(store: Store, ids: list[str], site: Path) -> Path:
    """Write every file the viewer reads for these builds under `site/gallery`; returns that folder."""
    out = site / URL.strip("/")
    shutil.rmtree(out, ignore_errors=True)
    for folder in ("builds", "parts", "images/small", "thumbnails"):
        (out / folder).mkdir(parents=True, exist_ok=True)
    builds = [_load(store, i) for i in ids]
    summaries = []
    for build in builds:
        for message in build.messages:
            message.images = [_image(store, url, out) for url in message.images]
        (out / "builds" / f"{build.id}.json").write_text(build.model_dump_json())
        (out / "builds" / f"{build.id}.bom.json").write_text(json.dumps(build.bom()))
        (out / "builds" / f"{build.id}.ldr").write_text(build.to_ldraw())
        try:
            package = shopping.save(build, out / "shopping")
        except ValueError as exc:
            package = {"error": str(exc)}
        (out / "builds" / f"{build.id}.shopping.json").write_text(json.dumps(package))
        thumbnail = store.thumbnail(build.id)
        if thumbnail.exists():
            shutil.copy(thumbnail, out / "thumbnails" / f"{build.id}.png")
        summaries.append(build.summary() | {"thumbnail": store.thumbnail_version(build.id)})
    for part in {p.part for build in builds for p in build.pieces}:
        (out / "parts" / part).write_text(ldraw.pack(part))
    shutil.copy(ldraw.LDRAW / "LDConfig.ldr", out / "LDConfig.ldr")
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
