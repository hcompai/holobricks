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
    # The demo's actual combinations, checked against public Known colors on 2026-09-27.
    # Deliberately exclude 3043/Dark Red and 3471/Dark Green: the former demo invented those pairs.
    records.update(
        {
            "3004": {1: "White", 85: "Dark Bluish Gray"},
            "3005": {1: "White"},
            "3010": {1: "White", 85: "Dark Bluish Gray"},
            "3020": {1: "White"},
            "3037": {5: "Red"},
            "3043": {5: "Red"},
            "3068": {86: "Light Bluish Gray"},
            "3470": {6: "Green"},
            "3471": {6: "Green"},
            "3622": {1: "White", 85: "Dark Bluish Gray"},
            "3633": {88: "Reddish Brown"},
            "3659": {88: "Reddish Brown"},
            "3742": {5: "Red", 3: "Yellow"},
            "3811": {6: "Green"},
            "60592": {1: "White"},
            "60601": {12: "Trans-Clear"},
        }
    )
    fetched = time.time()

    def get(self, item):
        if item not in records:
            raise catalog.UnmappedPart("No verified entry for this reference.")
        return catalog.Part(item, records[item], f"{catalog.CATALOG_URL}?P={item}", fetched, "f" * 64)

    monkeypatch.setattr(catalog.Catalog, "get", get)
    return records
