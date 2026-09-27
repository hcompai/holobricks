"""Compose Hogwarts' showcase render from four close-ups: `server/.venv/bin/python scripts/hogwarts-sheet.py`."""

import io
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

VIEWS = [
    ("3/4 front, from the lake", "angle=20&elevation=22&zoom=1.3"),
    ("Great Hall front, Viaduct Courtyard", "angle=105&elevation=30&zoom=3.5&at=82,62,190"),
    ("South Courtyard garden", "angle=180&elevation=65&zoom=3.5&at=78,105,125"),
    ("Hagrid's hut, pumpkins, boats", "angle=330&elevation=25&zoom=5&at=28,40,30"),
]
TILE = 640
OUT = Path(__file__).resolve().parents[1] / "agent" / "showcase" / "hogwarts.png"

sheet = Image.new("RGB", (2 * TILE, 2 * TILE), "white")
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 26)
for i, (label, camera) in enumerate(VIEWS):
    url = f"http://localhost:8000/api/builds/hogwarts/sheet.png?{camera}"
    view = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=180).read())).convert("RGB")
    x, y = i % 2 * TILE, i // 2 * TILE
    sheet.paste(view.resize((TILE, TILE), Image.LANCZOS), (x, y))
    draw.rectangle((x + 10, y + 10, x + 26 + draw.textlength(label, font=font), y + 48), fill="white")
    draw.text((x + 18, y + 14), label, fill="black", font=font)
    draw.rectangle((x, y, x + TILE - 1, y + TILE - 1), outline=(210, 210, 220), width=2)
sheet.quantize(256, dither=Image.Dither.NONE).save(OUT, optimize=True)
print(OUT)
