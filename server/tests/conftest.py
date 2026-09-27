import time

import pytest

from brickyard import catalog


@pytest.fixture
def offline_catalog(monkeypatch):
    """Explicit catalog facts for offline tests; production validation itself is never bypassed."""
    colors = {
        1: "White",
        3: "Yellow",
        5: "Red",
        11: "Black",
        88: "Reddish Brown",
        90: "Light Nougat",
        158: "Yellowish Green",
    }
    records = {item: dict(colors) for item in ("3001", "3024", "3069", "3069a", "3069bp01", "3941")}
    fetched = time.time()

    def get(self, item):
        if item not in records:
            raise catalog.UnmappedPart("No verified entry for this reference.")
        return catalog.Part(item, records[item], f"{catalog.CATALOG_URL}?P={item}", fetched, "f" * 64)

    monkeypatch.setattr(catalog.Catalog, "get", get)
    return records
