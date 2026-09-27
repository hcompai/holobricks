"""Check pixels at the inference boundary, with fake inference and synthetic images only."""

import base64
import io
import json
import sys
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality import ConstructionCompactor
from sagent.core.events import EventBus, MessageEvent, ToolResultEvent
from sagent.core.primitives import ToolRequest
from sagent.lib.policy_chat_mappers.tool_calling import ToolCallingChatMapper
from sagent.sagent import SAgent
from sagent.testing_utils.fake_llm import FakeLanguageModel
from test_quality import BRIEF, png, review
from test_quality import rig as build_rig
from visual_memory import MESSAGE_IMAGE_BUDGET, ImageLibrary, ListImages, ViewImage, VisualMemory

rig = build_rig  # Reuse the synthetic server fixture across the two test modules.


def colors(images):
    return [image.pil_image.convert("RGB").getpixel((0, 0)) for image in images]


def request_colors(request):
    return [
        Image.open(io.BytesIO(base64.b64decode(c.source.data))).convert("RGB").getpixel((0, 0))
        for message in request.messages
        for c in (message.content if isinstance(message.content, list) else [])
        if hasattr(c, "source")
    ]


def two_photos(rig):
    first = rig.build["messages"][0]
    rig.build["messages"] = [
        first,
        {"role": "user", "text": "Here is the back of the same robot", "images": ["/api/images/back.png"]},
    ]
    old = rig.loop.client

    def request(req):
        if req.url.path == "/api/images/back.png":
            return httpx.Response(200, content=png("green"), headers={"content-type": "image/png"})
        return old.send(req)

    rig.loop.client = httpx.Client(transport=httpx.MockTransport(request))


def test_later_upload_keeps_old_pixels_for_builder_and_reviewer(rig):
    two_photos(rig)
    rig.loop.on_update_state_end(None)
    assert request_colors(rig.llm.calls[0]) == [(0, 128, 0), (255, 255, 0)]
    assert request_colors(rig.llm.calls[1])[:2] == [(0, 128, 0), (255, 255, 0)]
    packet = VisualMemory(rig.path).on_update_state_end(None)[0]
    assert colors(packet.images) == [(0, 128, 0), (255, 255, 0), (0, 0, 255)]
    assert "back of the same robot" in packet.text_content
    assert len(rig.loop.images.catalogue()) == 2


def test_new_subject_keeps_provenance_instead_of_silently_treating_old_image_as_current(rig):
    two_photos(rig)
    rig.build["messages"][-1]["text"] = "Change the subject: build this lighthouse instead"
    rig.loop.on_update_state_end(None)
    packet = rig.loop.images.packet()
    assert "Change the subject" in packet.text_content
    assert "later instructions may supersede" in packet.text_content
    assert "Change the subject" in str(rig.llm.calls[0])
    assert len(rig.loop.images.references()) == 2


def test_external_reference_supplements_but_cannot_displace_user_photograph(rig):
    image = rig.path / "reference.png"
    image.write_bytes(png("red"))
    (rig.path / ".brickyard-reference.json").write_text(json.dumps({"path": str(image)}))
    rig.loop.on_update_state_end(None)
    assert request_colors(rig.llm.calls[0]) == [(255, 255, 0), (255, 0, 0)]
    assert rig.loop.images.references()[0]["kind"] == "user"


def test_deleted_selected_file_does_not_hide_user_photos(rig):
    (rig.path / ".brickyard-reference.json").write_text(json.dumps({"path": str(rig.path / "missing.png")}))
    rig.loop.on_update_state_end(None)
    assert colors(rig.loop.images.packet().images)[0] == (255, 255, 0)
    assert len(rig.llm.calls) == 2


def test_selected_reference_survives_removal_of_download_and_restart(rig):
    rig.build["messages"][0]["images"] = []
    path = rig.path / "reference.png"
    path.write_bytes(png("red"))
    (rig.path / ".brickyard-reference.json").write_text(json.dumps({"path": str(path)}))
    rig.loop.on_update_state_end(None)
    before = rig.loop.images.targets()
    path.unlink()
    restarted = ImageLibrary(rig.path)
    restarted.sync(rig.build, rig.loop.client, "http://local")
    assert restarted.targets() == before


def test_bad_download_is_not_registered_as_visual_evidence(tmp_path, monkeypatch):
    class BadDownload:
        def __enter__(self):
            return httpx.Response(
                200, content=b"<html>Forbidden</html>", request=httpx.Request("GET", "https://example/photo")
            )

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(httpx, "stream", lambda *args, **kwargs: BadDownload())
    tool = ViewImage(str(tmp_path))
    with pytest.raises(OSError):
        tool.run(Mock(), "https://example/photo")
    assert tool.library.read()["images"] == {}


def test_url_image_is_archived_once_and_reopened_offline_by_either_source_or_id(tmp_path, monkeypatch):
    url = "https://images.example/robot.png"
    calls = []

    def fetch(*args, **kwargs):
        calls.append(args)
        return httpx.Response(200, content=png("red"), request=httpx.Request("GET", url))

    class Stream:
        def __enter__(self):
            return fetch()

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(httpx, "stream", lambda *args, **kwargs: Stream())
    tool = ViewImage(str(tmp_path))
    sandbox = Mock()
    result = tool.run(sandbox, url)
    entry = tool.library.references()[0]
    assert entry["sources"] == [url]
    assert colors(result[1:]) == [(255, 0, 0)]
    monkeypatch.setattr(httpx, "stream", Mock(side_effect=AssertionError("No network on reopen")))
    restarted = ViewImage(str(tmp_path))
    assert colors(restarted.run(sandbox, entry["id"])[1:]) == [(255, 0, 0)]
    assert colors(restarted.run(sandbox, url)[1:]) == [(255, 0, 0)]
    assert len(calls) == 1 and sandbox.read_bytes.call_count == 0
    assert ImageLibrary(tmp_path).data(entry["id"]) == png("red")
    assert url in ListImages(str(tmp_path)).run()


def test_crop_uses_saved_original_before_downscaling_and_preserves_original(tmp_path):
    image = Image.new("RGB", (4000, 2000), "red")
    image.paste("blue", (3000, 0, 4000, 2000))
    output = io.BytesIO()
    image.save(output, "PNG")
    library = ImageLibrary(tmp_path)
    image_id = library.remember(output.getvalue(), kind="reference", source="detail.png")
    result = ViewImage(str(tmp_path)).run(Mock(), image_id, (0.75, 0, 1, 1))
    assert result[1].pil_image.size == (960, 1920)
    assert colors(result[1:]) == [(0, 0, 255)]
    assert library.data(image_id) == output.getvalue()
    assert len(library.read()["images"]) == 1


@pytest.mark.parametrize("crop", [(1, 0, 0, 1), (0, 0, 2, 1), (0, 0, 0, 1), (0, 0, float("nan"), 1)])
def test_invalid_crop_is_rejected(tmp_path, crop):
    library = ImageLibrary(tmp_path)
    image_id = library.remember(png("red"), kind="reference", source="a.png")
    with pytest.raises(ValueError, match="Crop"):
        library.image(image_id, crop)


def test_reviewer_can_reopen_reference_outside_pinned_subset_and_crop_it(rig):
    ids = [
        rig.loop.images.remember(png(c), kind="reference", source=f"https://example/{c}.png")
        for c in ("red", "green", "black", "white", "purple")
    ]
    requested = review()
    requested["reference_inspection"] = {"image_id": ids[0], "crop": [0, 0, 0.5, 1]}
    rig.llm.outputs = [BRIEF, requested, review(True)]
    rig.loop.on_update_state_end(None)
    assert len(rig.loop.targets) == 4
    assert (255, 0, 0) not in request_colors(rig.llm.calls[1])
    assert request_colors(rig.llm.calls[2])[-1] == (255, 0, 0)
    assert ids[0] in str(rig.llm.calls[1])  # discoverable even before its pixels are requested
    assert rig.loop.validate().passed
    audit = [json.loads(line) for line in (rig.loop.root / "calls.jsonl").read_text().splitlines()]
    assert ids[0] in audit[-1]["images"][-1]["label"]


def test_invalid_reference_request_cannot_approve(rig):
    requested = review(True)
    requested["reference_inspection"] = {"image_id": "invented-id", "crop": None}
    rig.llm.outputs = [BRIEF, requested]
    events = rig.loop.on_update_state_end(None)
    assert "unknown reference" in events[0].text_content
    assert not rig.loop.state["reviews"]


def test_reviewer_failure_does_not_drop_target_or_verified_geometry(rig):
    rig.llm.outputs = [BRIEF, ValueError("inference unavailable")]
    assert "No visual approval" in rig.loop.on_update_state_end(None)[0].text_content
    packet = VisualMemory(rig.path).on_update_state_end(None)[0]
    assert colors(packet.images) == [(255, 255, 0), (0, 0, 255)]


def test_stale_render_is_neither_archived_nor_reattached_as_current(rig):
    rig.loop.on_update_state_end(None)
    old_render = rig.loop.images.read()["render"]
    rig.build.update(revision="b" * 64, checked_revision="b" * 64)
    rig.stale[0] = "a" * 64
    assert "No fresh render" in rig.loop.on_update_state_end(None)[0].text_content
    packet = rig.loop.images.packet()
    assert colors(packet.images) == [(255, 255, 0)]
    assert "No verified sheet" in packet.text_content
    assert rig.loop.images.read()["render"] == old_render
    assert ImageLibrary(rig.path).data(old_render) == png("blue")  # history is still accessible


def test_modified_archive_fails_integrity_check(tmp_path):
    library = ImageLibrary(tmp_path)
    image_id = library.remember(png("red"), kind="reference", source="photo.png")
    entry = library.read()["images"][image_id]
    (library.root / entry["path"]).write_bytes(png("blue"))
    with pytest.raises(ValueError, match="integrity"):
        library.image(image_id)


@pytest.mark.parametrize("emergency", [False, True])
def test_actual_sagent_policy_retains_pixels_after_eviction_failure_and_compaction(rig, emergency):
    two_photos(rig)
    rig.loop.images.remember(png("red"), kind="reference", source="red.png")
    rig.loop.images.remember(png("purple"), kind="reference", source="purple.png")
    rig.loop.on_update_state_end(None)
    memory = VisualMemory(rig.path)
    compactor = ConstructionCompactor(
        workspace=str(rig.path),
        skill=lambda _: "Text summary only; deliberately no images",
        trigger_tokens=120000,
        passthrough_images={"message": MESSAGE_IMAGE_BUDGET, "tool_result": 3},
        passthrough_actions=10,
        passthrough_arg_paths=True,
        max_briefing_paths=30,
        max_action_arg_chars=300,
    )
    mapper = ToolCallingChatMapper(coordinate_system="relative", prompt_path="holo.j2", prompt_source_module="holo")
    agent = SAgent(
        name="memory-test",
        policy_llm=FakeLanguageModel(),
        policy_chat_mapper=mapper,
        event_bus=EventBus(handlers=[]),
        callbacks=[compactor, memory],
        max_images={"message": MESSAGE_IMAGE_BUDGET, "tool_result": 3},
    )
    agent.policy_context["max_completion_tokens"] = 32768
    for event in memory.on_update_state_end(None):
        agent.add_event(event)
    distractor = ImageLibrary(rig.path).packet().images[-1]
    for _ in range(12):
        agent.add_event(
            ToolResultEvent(
                tool_req=ToolRequest(tool_name="view_image", args={"source": "render.png"}), result=distractor
            )
        )
    # Another message can consume the whole message budget. The last callback must repin actual files.
    agent.add_event(MessageEvent(caller_id="another-callback", content=[distractor] * 5))
    for event in memory.on_update_state_end(None):
        agent.add_event(event)
    agent.add_event(MessageEvent(caller_id="construction-review", content=["Review unavailable; no approval"]))
    for event in compactor.compact(emergency=emergency):
        agent.add_event(event)
    agent.check_for_flow_event()
    policy_input = agent.make_policy_input()
    packet = [e for e in policy_input.events if isinstance(e, MessageEvent) and e.caller_id == "visual-memory"][-1]
    expected = [(0, 128, 0), (255, 255, 0), (128, 0, 128), (255, 0, 0), (0, 0, 255)]
    assert colors(packet.images) == expected
    assert memory.on_update_state_end(None) == []  # no need to grow history on unchanged steps
    # Check the actual chat request mapping too, not just presence of files or callback output.
    request = mapper.input_to_prompt(policy_input)
    transmitted = request_colors(request)
    assert transmitted == expected


def test_reference_packet_is_bounded_but_library_is_not(tmp_path):
    library = ImageLibrary(tmp_path)
    for index in range(30):
        library.remember(png((index, 0, 0)), kind="reference", source=f"photo-{index}.png")
    assert len(library.packet().images) == 4
    first = json.loads(ListImages(str(tmp_path)).run())
    second = json.loads(ListImages(str(tmp_path)).run(offset=first["next_offset"]))
    assert first["total"] == 30 and len(first["images"]) == 25 and len(second["images"]) == 5
