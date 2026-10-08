import io
import json
from pathlib import Path

import PIL.Image
import pytest

from brickyard import ldraw
from brickyard.gallery import export
from brickyard.model import Build, Message, Piece, place
from brickyard.store import Store

pytestmark = pytest.mark.skipif(not ldraw.LDRAW.exists(), reason="LDraw library not downloaded")


def test_place_puts_parts_on_the_stud_grid_at_plate_heights():
    brick = place("3001.dat", 0, 0, 0, 4)
    assert brick.pos == (40.0, -24.0, 20.0)
    turned = place("3001.dat", 5, 7, 3, 4, rotation=90)
    assert turned.pos == (5 * 20 + 20, -3 * 8 - 24, 7 * 20 + 40)
    tree = place("3471.dat", 1, 1, 0, 288)
    assert tree.pos[0] == pytest.approx(1 * 20 + 40) and tree.pos[2] == pytest.approx(1 * 20 + 40)


def test_packed_part_embeds_every_subfile_under_the_names_the_viewer_resolves():
    packed = ldraw.pack("3001.dat")
    assert packed.startswith("0 FILE brickyard.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat")
    names = [line[7:] for line in packed.splitlines() if line.startswith("0 FILE ")]
    assert "3001.dat" in names and "stud.dat" in names
    assert all(not n.startswith(("s/", "48/")) for n in names)


def test_gallery_export_holds_every_file_the_static_site_reads(tmp_path, offline_catalog):
    store = Store(tmp_path / "data")
    png = io.BytesIO()
    PIL.Image.new("RGB", (800, 600), "red").save(png, "PNG")
    store.image("look.png").parent.mkdir()
    store.image("look.png").write_bytes(png.getvalue())
    pieces = [place("3001.dat", 0, 0, 0, 4), place("3024.dat", 0, 0, 3, 15)]
    build = Build(
        status="done",
        pieces=[Piece(id=i, step=0, **p.model_dump()) for i, p in enumerate(pieces)],
        messages=[Message(role="tool", text="Looked", images=["/api/images/look.png"])],
    )
    store.save(build)
    out = export(store, [build.id], tmp_path / "site")

    assert [b["id"] for b in json.loads((out / "builds.json").read_text())] == [build.id]
    exported = json.loads((out / "builds" / f"{build.id}.json").read_text())
    shown = exported["messages"][0]["images"][0]
    assert shown.startswith("/gallery/") and (out.parent / shown.lstrip("/")).read_bytes() == png.getvalue()
    with PIL.Image.open(out / "images" / "small" / f"{Path(shown).name}.webp") as small:
        assert small.size == (320, 240)
    assert exported["parts"].keys() == {p.part for p in build.pieces}
    assert exported["status"] == "done" and exported["bom"]["validation"]["status"] == "verified"


def test_build_ids_cannot_leave_the_data_folder(tmp_path):
    (tmp_path / "secret.json").write_text("{}")
    store = Store(tmp_path / "data")
    assert store.load("../../secret") is None
    with pytest.raises(ValueError):
        store.image("../../secret.json")
