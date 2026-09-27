import json
import time

import httpx
import pytest

from brickyard import catalog, ldraw
from brickyard.model import Piece


def page(item="3069", known=(("88", "Reddish Brown"), ("90", "Light Nougat"), ("158", "Yellowish Green"))):
    # Minimal public catalog contract. All/seller colors deliberately include a color
    # that is NOT in Known colors; it must never authorize a purchase.
    rows = "".join(
        f'<div class="pciSelectColorColorItem" data-tab="Known" data-color="{code}" data-name="{name}"></div>'
        for code, name in known
    )
    return f"""<html><script>var _var_item = {{type:'P',itemno:'{item}',itemStatus:'A'}};</script>
    <div id="_idColorListAll"><div class="pciSelectColorColorItem" data-tab="All" data-color="49" data-name="Very Light Gray"></div></div>
    <div id="_idColorListKnown">{rows}</div>
    <div class="pciSelectColorColorItem" data-tab="Pop" data-color="49" data-name="Very Light Gray"></div></html>"""


@pytest.fixture
def library(monkeypatch):
    monkeypatch.setattr(ldraw, "catalog", lambda: {"3069b.dat": "Tile", "9999.dat": "Another part"})
    monkeypatch.setattr(ldraw, "resolve", lambda p: p if p in ldraw.catalog() else None)
    monkeypatch.setattr(
        ldraw, "read", lambda p: ("0 Tile", "", "0 !KEYWORDS BrickLink 3069") if p == "3069b.dat" else ("0 Part",)
    )
    monkeypatch.setattr(
        ldraw,
        "colors",
        lambda: {
            70: ("Reddish Brown", "#1"),
            78: ("Light Nougat", "#2"),
            326: ("Yellowish Green", "#3"),
            503: ("Very Light Grey", "#4"),
        },
    )


def piece(color=70, part="3069b.dat"):
    return Piece(id=1, part=part, color=color, pos=(0, 0, 0), step=0)


@pytest.fixture
def network(monkeypatch):
    original = httpx.Client
    requests = []
    state = {"status": 200, "body": page()}

    def handler(request):
        requests.append(request)
        if state.get("timeout"):
            raise httpx.ReadTimeout("offline")
        return httpx.Response(state["status"], text=state["body"])

    monkeypatch.setattr(
        catalog.httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)
    )
    monkeypatch.setattr(catalog.time, "sleep", lambda _: None)
    return state, requests


def test_only_known_colors_are_evidence_and_ldraw_codes_are_converted(library, network, tmp_path):
    report = catalog.validate([piece(70), piece(78), piece(326)], tmp_path)
    assert report["valid"]
    assert [row["bricklink_color"] for row in report["inventory"]] == [88, 90, 158]
    assert {row["bricklink_part"] for row in report["inventory"]} == {"3069"}
    assert len(network[1]) == 1  # one query per unique part, not per brick/color
    invalid = catalog.validate([piece(503)], tmp_path)
    assert not invalid["valid"] and invalid["issues"][0]["code"] == "color_not_verified"
    assert {c["color"] for c in invalid["issues"][0]["available_colors"]} == {70, 78, 326}
    assert len(network[1]) == 1


def test_name_matching_is_exact_after_spelling_normalization_not_rgb_or_numeric(
    library, monkeypatch, network, tmp_path
):
    monkeypatch.setattr(ldraw, "colors", lambda: {88: ("Something else", "#1"), 71: ("Light_Bluish_Grey", "#2")})
    network[0]["body"] = page(known=(("86", "Light Bluish Gray"), ("88", "Reddish Brown")))
    report = catalog.validate([piece(88), piece(71)], tmp_path)
    assert not report["valid"] and len(report["inventory"]) == 1
    assert report["inventory"][0]["bricklink_color"] == 86


@pytest.mark.parametrize(
    "body",
    [
        "<html>Login required</html>",
        page().replace("itemStatus:'A'", "itemStatus:'D'"),
        page().replace("type:'P'", "type:'S'"),
        page().replace("_idColorListKnown", "changed-markup"),
        page().replace("</html>", ""),
        page(item="3001"),
    ],
)
def test_unknown_changed_truncated_or_wrong_identity_pages_fail_closed(library, network, tmp_path, body):
    network[0]["body"] = body
    report = catalog.validate([piece()], tmp_path)
    assert not report["valid"] and not report["inventory"]
    assert not list(tmp_path.glob("*.json"))


def test_only_an_explicit_catalog_alias_can_explain_a_different_canonical_id():
    with pytest.raises(catalog.UnmappedPart):
        catalog.parse_page(page(), "3069b", time.time())
    document = page().replace("</html>", "Alternate Item No: <span>3069b, 30070</span></html>")
    assert catalog.parse_page(document, "3069b", time.time()).item == "3069"


def test_stale_cache_is_not_used_during_outage_and_fresh_data_revalidates(library, network, tmp_path, monkeypatch):
    assert catalog.validate([piece()], tmp_path)["valid"]
    saved = json.loads((tmp_path / "3069.json").read_text())
    now = saved["fetched_at"] + catalog.CACHE_TTL + 1
    monkeypatch.setattr(catalog.time, "time", lambda: now)
    network[0]["status"] = 429
    rejected = catalog.validate([piece()], tmp_path)
    assert not rejected["valid"] and rejected["issues"][0]["code"] == "catalog_unavailable"
    assert json.loads((tmp_path / "3069.json").read_text()) == saved
    network[0]["status"] = 200
    network[0]["body"] = page(known=(("90", "Light Nougat"),))
    report = catalog.validate([piece()], tmp_path)
    assert not report["valid"] and report["issues"][0]["code"] == "color_not_verified"


def test_corrupted_cache_is_not_trusted(library, network, tmp_path):
    assert catalog.validate([piece()], tmp_path)["valid"]
    file = tmp_path / "3069.json"
    saved = json.loads(file.read_text())
    saved["html"] = saved["html"].replace("Reddish Brown", "Imaginary Color")
    file.write_text(json.dumps(saved))
    network[0]["timeout"] = True
    assert not catalog.validate([piece()], tmp_path)["valid"]
    assert len(network[1]) == 2


@pytest.mark.parametrize("status", [302, 403, 404, 429, 500])
def test_http_failures_never_authorize_an_order(library, network, tmp_path, status):
    network[0]["status"] = status
    assert not catalog.validate([piece()], tmp_path)["valid"]
    assert len(network[1]) == 1


def test_multiple_alias_candidates_are_not_arbitrarily_selected(library, monkeypatch, offline_catalog, tmp_path):
    monkeypatch.setattr(ldraw, "read", lambda _: ("0 Part", "0 !KEYWORDS BrickLink 3069, BrickLink 3001"))
    report = catalog.validate([piece()], tmp_path)
    assert not report["valid"] and "ambiguous" in report["issues"][0]["reason"]


def test_unsafe_ids_and_suffix_guesses_do_not_issue_requests(network, tmp_path, monkeypatch):
    provider = catalog.Catalog(tmp_path)
    with pytest.raises(catalog.UnmappedPart):
        provider.get("../3069")
    assert not network[1]
    monkeypatch.setattr(ldraw, "read", lambda _: ("0 Printed part",))
    assert catalog.candidates("3069bp123.dat") == ["3069bp123"]


def test_time_budget_keeps_unchecked_remainder_out_of_exports(library, network, tmp_path, monkeypatch):
    monkeypatch.setattr(catalog, "VALIDATION_BUDGET", -1)
    report = catalog.validate([piece()], tmp_path)
    assert not report["valid"] and not report["inventory"] and not network[1]
