"""Exercise real HAI serialization against a gateway-shaped HTTP stub, without inference."""

import base64
import io
import json
import sys
from pathlib import Path

import httpx
import pytest
from hai_adapters import chat_provider_builder
from hai_protocols.chat_completion.messages import ImageContentChunk, UserMessage
from hai_protocols.chat_completion.request import ChatCompletionRequest
from hai_protocols.image.source import Base64ImageSource
from hydra.utils import instantiate
from omegaconf import OmegaConf
from openai import OpenAI
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from image_transport import bounded_images


def picture(color="red"):
    data = io.BytesIO()
    Image.new("RGB", (32, 24), color).save(data, "PNG")
    return ImageContentChunk(
        source=Base64ImageSource(data=base64.b64encode(data.getvalue()).decode(), media_type="image/png")
    )


@pytest.fixture
def gateway(monkeypatch):
    sent = []

    def handle(request):
        payload = json.loads(request.content)
        sent.append(payload)
        images = [
            part
            for message in payload["messages"]
            if isinstance(message.get("content"), list)
            for part in message["content"]
            if part["type"] == "image_url"
        ]
        if len(images) > 5 or any(part["image_url"] is None for part in images):
            return httpx.Response(400, json={"error": {"message": "Invalid request", "type": "invalid_request_error"}})
        return httpx.Response(
            200,
            json={
                "id": "test",
                "object": "chat.completion",
                "created": 0,
                "model": payload["model"],
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 1,
                    "total_tokens": 101,
                    "prompt_tokens_details": {"cached_tokens": 80},
                },
            },
        )

    monkeypatch.setenv("HAI_API_KEY", "test-only")
    monkeypatch.setenv("HAI_BASE_URL", "https://holo.invalid/v1/models")
    monkeypatch.setenv("HOLO_MODEL", "holo4-27b")
    with OpenAI(
        api_key="test-only",
        base_url="https://holo.invalid",
        http_client=httpx.Client(transport=httpx.MockTransport(handle)),
    ) as client:
        monkeypatch.setattr(chat_provider_builder, "_select_client_from_config", lambda config: client)
        yield sent


@pytest.mark.parametrize("role", ["llm", "review_llm", "compactor.skill.llm"])
def test_real_config_resends_image_bytes_and_preserves_cache_accounting(gateway, role):
    config = OmegaConf.load(Path(__file__).resolve().parents[1] / "holo.yaml")
    llm = instantiate(OmegaConf.select(config, role))
    request = ChatCompletionRequest(messages=[UserMessage(content=[picture()])])
    for _ in range(2):
        assert llm.chat(request).message.content == "OK"
    assert len(gateway) == 2
    first, second = [p["messages"][0]["content"][0] for p in gateway]
    assert first == second
    assert first["image_url"]["url"].startswith("data:image/png;base64,")
    assert first["uuid"]  # Stable image identity is retained even when bytes are resent.
    assert llm.total_usage.cached_tokens == 160


def image_chunks(request):
    return [
        part
        for message in request.messages
        if isinstance(message.content, (list, tuple))
        for part in message.content
        if isinstance(part, ImageContentChunk)
    ]


@pytest.mark.parametrize("role", ["llm", "review_llm", "compactor.skill.llm"])
def test_real_config_bounds_combined_reference_render_and_inspection_images(gateway, role):
    config = OmegaConf.load(Path(__file__).resolve().parents[1] / "holo.yaml")
    llm = instantiate(OmegaConf.select(config, role))
    # Four references, two candidate views, two previous-best views, four requested details.
    request = ChatCompletionRequest(messages=[UserMessage(content=[picture((i * 20, 10, 80))]) for i in range(12)])
    original = request.model_dump()
    for _ in range(2):
        assert llm.chat(request).message.content == "OK"
    for payload in gateway:
        images = [p for m in payload["messages"] for p in m["content"] if p["type"] == "image_url"]
        assert len(images) == 5
        assert all(p["image_url"] is not None for p in images)
        assert images[0]["image_url"]["url"] == image_chunks(request)[0].source.to_url()
        assert images[-1]["image_url"]["url"] == image_chunks(request)[-1].source.to_url()
    assert gateway[0] == gateway[1]  # deterministic transport preserves cacheable identity
    assert request.model_dump() == original


def test_overflow_deduplicates_pixels_without_losing_labels_or_mutating_history():
    from hai_protocols.chat_completion.messages import TextContentChunk

    a, b = picture("red"), picture("blue")
    chunks = [chunk for i in range(6) for chunk in (TextContentChunk(text=f"source {i}"), a if i % 2 else b)]
    request = ChatCompletionRequest(messages=[UserMessage(content=chunks)])
    original = request.model_dump()
    result = bounded_images(request, 5)
    assert len(image_chunks(result)) == 2
    text = " ".join(c.text for c in result.messages[0].content if isinstance(c, TextContentChunk))
    assert all(f"source {i}" in text for i in range(6))
    assert "same pixels" in text
    assert request.model_dump() == original


@pytest.mark.parametrize("count", [6, 8, 12])
def test_sheets_keep_every_distinct_view_visible(count):
    colors = [(i * 20, 10, 80) for i in range(count)]
    request = ChatCompletionRequest(messages=[UserMessage(content=[picture(c) for c in colors])])
    result = bounded_images(request, 5)
    assert len(image_chunks(result)) == 5
    visible = set()
    for chunk in image_chunks(result):
        with chunk.load() as img:
            visible.update(color for _, color in img.getcolors(maxcolors=10000))
    assert set(colors) <= visible


def test_within_budget_keeps_request_unchanged():
    request = ChatCompletionRequest(messages=[UserMessage(content=[picture()] * 5)])
    assert bounded_images(request, 5) is request


def test_one_budget_spans_message_and_tool_images_preserving_tool_identity():
    from hai_protocols.chat_completion.messages import TextContentChunk, ToolMessage

    tools = ToolMessage(tool_call_id="inspection", content=[TextContentChunk(text="detail"), picture("blue")] * 3)
    request = ChatCompletionRequest(messages=[UserMessage(content=[picture("red")] * 5), tools])
    original = request.model_dump()
    result = bounded_images(request, 5)
    assert len(image_chunks(result)) == 2
    assert result.messages[-1].role == tools.role
    assert result.messages[-1].tool_call_id == "inspection"
    assert request.model_dump() == original


def test_batch_requests_each_get_their_own_budget(gateway):
    config = OmegaConf.load(Path(__file__).resolve().parents[1] / "holo.yaml")
    llm = instantiate(config.llm)
    requests = [
        ChatCompletionRequest(messages=[UserMessage(content=[picture((i * 20, 10, 80)) for i in range(count)])])
        for count in [2, 7]
    ]
    responses = llm.chat(requests)
    assert [r.message.content for r in responses] == ["OK", "OK"]
    assert sorted(
        sum(p["type"] == "image_url" for m in call["messages"] for p in m["content"]) for call in gateway
    ) == [2, 5]


def test_original_caching_setting_reproduces_the_second_turn_failure(gateway):
    from hai_adapters.interface import InvalidRequestError

    config = OmegaConf.load(Path(__file__).resolve().parents[1] / "holo.yaml")
    config.llm.chat_provider.enable_client_side_img_caching = True
    llm = instantiate(config.llm)
    request = ChatCompletionRequest(messages=[UserMessage(content=[picture()])])
    llm.chat(request)
    with pytest.raises(InvalidRequestError):
        llm.chat(request)
    assert gateway[-1]["messages"][0]["content"][0]["image_url"] is None
