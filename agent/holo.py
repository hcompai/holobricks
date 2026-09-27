"""Holo on a Brickyard build: a sagent runner, started by the server with hai's Python, and its chat handler."""

import json
import logging
import os
import signal
import sys
from pathlib import Path

import httpx
from hai_adapters.langfuse_tracing import flush as langfuse_flush
from hai_protocols.image.encoding import MediaType
from hai_protocols.image.serializable_image import SerializableImage
from sagent.core.events import AnswerEvent, EventHandler, EventRecord, PolicyEvent
from sagent.utils.builder import build_agent

CONFIG = Path(__file__).resolve().with_name("holo.yaml")
POST_TIMEOUT_S = 10
MEDIA_TYPES = {".jpg": MediaType.JPEG, ".png": MediaType.PNG, ".webp": MediaType.WEBP}
LOGGER = logging.getLogger(__name__)


class Chat(EventHandler):
    """Posts the agent's reasoning, messages and answer to the build's chat."""

    def __init__(self, url: str, build: str):
        self.url = f"{url.rstrip('/')}/api/builds/{build}/say"

    def handle_event(self, record: EventRecord) -> None:
        match record.event:
            case PolicyEvent(message=message):
                if message.reasoning_content:
                    self._post(message.reasoning_content, "thinking")
                if message.content and message.content.strip():
                    self._post(message.content.strip(), "assistant")
            case AnswerEvent(answer=answer):
                self._post(str(answer), "assistant")

    def flush(self) -> None:
        pass

    def _post(self, text: str, role: str) -> None:
        try:
            httpx.post(
                self.url, json={"text": text, "role": role}, timeout=POST_TIMEOUT_S
            ).raise_for_status()
        except httpx.HTTPError as e:
            LOGGER.warning("Brickyard chat post failed: %s", e)


def references() -> list[SerializableImage]:
    """The images the user attached to this request, listed in BRICKYARD_REFERENCES."""
    paths = [Path(p) for p in json.loads(os.environ.get("BRICKYARD_REFERENCES", "[]"))]
    return [
        SerializableImage.from_bytes(p.read_bytes(), MEDIA_TYPES[p.suffix])
        for p in paths
    ]


def main() -> None:
    """Build the agent from holo.yaml, overridable with key=value arguments, and run the task on stdin."""
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    agent = build_agent(CONFIG.stem, overrides=sys.argv[1:], config_dir=CONFIG.parent)
    agent.policy_context["max_completion_tokens"] = (
        agent.policy.llm.base_request.max_completion_tokens
    )
    try:
        agent([sys.stdin.read(), *references()])
    finally:
        for handler in agent.event_bus.handlers:
            handler.flush()
        langfuse_flush()


if __name__ == "__main__":
    main()
