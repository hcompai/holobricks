#!/usr/bin/env python3
"""Install the pinned CC-BY-SA LDCad shadow library used for assembly checks."""

import io
import json
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

COMMIT = "9b1131fb1991f8c0bfc072325e4e12f6271aba35"
URL = f"https://codeload.github.com/RolandMelkert/LDCadShadowLibrary/tar.gz/{COMMIT}"
root = Path(__file__).resolve().parents[1]
destination = root / "shadow"
if destination.exists():
    marker = destination / "brickyard-source.json"
    if marker.exists() and json.loads(marker.read_text()).get("commit") == COMMIT:
        print("Pinned connector library already installed.")
        raise SystemExit(0)
    raise SystemExit("shadow/ already exists with different or unknown provenance; move it aside before installing.")
with urllib.request.urlopen(URL, timeout=90) as response:
    data = response.read(80_000_001)
if len(data) > 80_000_000:
    raise SystemExit("Connector archive exceeds size limit.")
with tempfile.TemporaryDirectory(prefix=".shadow-", dir=root) as tmp:
    staging = Path(tmp) / "library"
    staging.mkdir()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        total = 0
        for member in archive:
            parts = Path(member.name).parts[1:]
            if not parts or ".." in parts or member.name.startswith("/"):
                continue
            if parts[0] not in {"p", "parts", "LICENSE.md", "README.md"}:
                continue
            if member.isdir():
                continue
            if not member.isfile():
                raise SystemExit("Unexpected link or special file in connector archive.")
            total += member.size
            if total > 150_000_000:
                raise SystemExit("Connector library exceeds size limit.")
            target = staging.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
    if not (staging / "LICENSE.md").is_file() or not (staging / "p/stud.dat").is_file():
        raise SystemExit("Incomplete connector archive.")
    (staging / "brickyard-source.json").write_text(
        json.dumps(
            {
                "commit": COMMIT,
                "source": URL,
                "license": "CC-BY-SA-4.0",
                "author": "Roland Melkert and LDCad shadow library contributors",
            },
            indent=2,
        )
        + "\n"
    )
    staging.rename(destination)
print(f"Installed connector data {COMMIT} into {destination}")
