"""The real Holo config, with fake inference: no API keys or billable calls."""

import sys
from pathlib import Path

from hai_protocols.chat_completion.messages import AssistantMessage
from omegaconf import OmegaConf
from sagent.core.events import ErrorEvent, EventRecord, FlowEvent, MessageEvent, PolicyEvent
from sagent.core.primitives import ToolRequest
from sagent.lib.callbacks.compactor import Compactor
from sagent.utils.builder import build_agent_from_dict

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import holo


def agent(tmp_path, monkeypatch):
    monkeypatch.setenv("BRICKYARD_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("BRICKYARD_BUILD", "fake")
    config = OmegaConf.load(holo.CONFIG)
    config.llm = config.compactor.skill.llm = {"_target_": "sagent.testing_utils.fake_llm.FakeLanguageModel"}
    config.agent.event_bus.handlers = []
    return build_agent_from_dict(config, skip_services=True)


def test_holo_resumes_its_last_compacted_history_and_settles_stopped_calls(tmp_path, monkeypatch):
    holo_agent = agent(tmp_path, monkeypatch)
    assert [type(c) for c in holo_agent.callbacks] == [Compactor]
    assert holo_agent.callbacks[0]._user_images.maxlen == 2

    stopped = ToolRequest(tool_name="submit_command", args={"command": "bricks run"})
    events = [
        MessageEvent(caller_id="user", content=["a castle"]),
        FlowEvent(flow="reset_history", origin="compactor"),
        MessageEvent(caller_id="user", content=["taller towers"]),
        PolicyEvent(message=AssistantMessage(content="Raising them."), tool_reqs=[stopped]),
    ]
    (tmp_path / "runs").mkdir()
    (tmp_path / "runs" / "1.jsonl").write_text("".join(EventRecord(event=e).model_dump_json() + "\n" for e in events))

    holo.resume(holo_agent, holo.earlier_history())

    replayed = holo_agent.history.events
    assert [type(e) for e in replayed] == [MessageEvent, PolicyEvent, ErrorEvent]
    assert replayed[0].content == ["taller towers"]
    assert replayed[-1].tool_req.id == stopped.id
