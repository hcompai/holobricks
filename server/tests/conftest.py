import time

import pytest

from brickyard import catalog

COLORS = {
    0: (0, 11),
    2: (2, 6),
    4: (4, 5),
    14: (14, 3),
    15: (15, 1),
    47: (47, 12),
    70: (70, 88),
    71: (71, 86),
    72: (72, 85),
    78: (78, 90),
    326: (326, 158),
}
"""LDraw code -> (Rebrickable id, BrickLink id)."""


@pytest.fixture
def offline_catalog(monkeypatch):
    """Explicit catalog facts for offline tests; production validation itself is never bypassed."""
    common = [0, 4, 14, 15, 70, 78, 326]
    parts = {
        "3001.dat": ("3001", "3001", common),
        "3024.dat": ("3024", "3024", common),
        "3069.dat": ("3069b", "3069", common),
        "3069b.dat": ("3069b", "3069", common),
        "3069a.dat": ("3069a", "3069a", common),
        "3069bp01.dat": ("3069bp01", "3069bp01", common),
        "6143.dat": ("3941", "3941", common),
        "3811.dat": ("3811", "3811", [2]),
        "60592.dat": ("60592", "60592", [15]),
        "60601.dat": ("60601", "60601", [47]),
    }
    records = {
        part: {"rebrickable": rebrickable, "bricklink": bricklink, "colors": list(colors)}
        for part, (rebrickable, bricklink, colors) in parts.items()
    }
    colors = {code: {"rebrickable": rb, "bricklink": bl, "bricklink_name": None} for code, (rb, bl) in COLORS.items()}
    built = time.time()
    monkeypatch.setattr(catalog, "snapshot", lambda: catalog.Snapshot(built, "f" * 64, colors, records))
    return records
