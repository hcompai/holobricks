"""Pack what an agent's Workstation needs to build into web/public/brickyard.tgz: server/.venv/bin/python scripts/pack-toolkit.py"""

import io
import sys
import tarfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "brickyard.tgz"
LIMIT = 2_000_000
"""User files share 7 MB per message with the user's photos."""


def files() -> list[tuple[str, bytes]]:
    server = ROOT / "server"
    sources = [server / "pyproject.toml", server / "uv.lock", *sorted((server / "brickyard").rglob("*.py"))]
    sources += [ROOT / "setup.sh", ROOT / "scripts" / "fetch-ldraw.sh", ROOT / "scripts" / "fetch-connectors.py"]
    sources += [ROOT / "data" / "rebrickable.json.gz"]
    sources += sorted(p for p in (ROOT / "agent" / "showcase").iterdir() if p.suffix in (".py", ".md"))
    out = [(str(p.relative_to(ROOT)), p.read_bytes()) for p in sources]
    for png in sorted((ROOT / "agent" / "showcase").glob("*.png")):
        jpeg = io.BytesIO()
        with Image.open(png) as image:
            image.convert("RGB").save(jpeg, "JPEG", quality=85)
        out.append((str(png.relative_to(ROOT).with_suffix(".jpg")), jpeg.getvalue()))
    return out


def main() -> None:
    if not (ROOT / "data" / "rebrickable.json.gz").exists():
        sys.exit("Build the catalog snapshot first: server/.venv/bin/brickyard-catalog")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(OUT, "w:gz") as archive:
        for name, data in files():
            info = tarfile.TarInfo(f".brickyard/{name}")
            info.size, info.mode = len(data), 0o755 if name.endswith(".sh") else 0o644
            archive.addfile(info, io.BytesIO(data))
    size = OUT.stat().st_size
    if size > LIMIT:
        sys.exit(f"{OUT} is {size / 1e6:.1f} MB, over the {LIMIT / 1e6:.0f} MB budget")
    print(f"{OUT} ({size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
