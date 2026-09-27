"""Regression checks with fake inference: no API keys, billable calls or new user builds."""

import io
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality import (
    CompletionDisclosure,
    ConstructionCompactor,
    QualityLoop,
    RestoreBest,
    Verdict,
)
from sagent.core.events import AnswerEvent, MessageEvent
from sagent.lib.callbacks.compactor import Compactor


def png(color):
    output = io.BytesIO()
    Image.new("RGB", (16, 16), color).save(output, "PNG")
    return output.getvalue()


BRIEF = {
    "subject": "Microduck robot",
    "scope": "Robot only, no desk",
    "requirements": [
        {
            "id": name,
            "feature": feature,
            "evidence": "Visible in user photo",
            "verification": "Compare shape",
            "priority": "detail" if name == "eye" else "identity",
        }
        for name, feature in [
            ("feet", "Two yellow feet, no wheels"),
            ("hood", "Rounded broad hood"),
            ("eye", "Black camera lens"),
        ]
    ],
    "uncertainties": ["Back of head hidden"],
    "angle": 40,
    "elevation": 25,
}


def review(passing=False, comparison="first"):
    return {
        "findings": [
            {
                "requirement": r["id"],
                "status": "pass" if passing else "fail",
                "evidence": "Visible feature" if passing else "Wheels and blank face",
                "correction": "" if passing else "Replace with observed shape",
            }
            for r in BRIEF["requirements"]
        ],
        "defects": []
        if passing
        else [{"feature": "feet", "severity": "major", "evidence": "Two wheels", "correction": "Build two feet"}],
        "silhouette": 4 if passing else 2,
        "proportions": 4 if passing else 2,
        "finish": 4 if passing else 2,
        "comparison": comparison,
        "comparison_evidence": "Compared visible geometry",
        "next_experiment": "Change feet",
    }


class FakeLLM:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []

    def chat(self, request):
        self.calls.append(request)
        output = self.outputs.pop(0)
        if isinstance(output, Exception):
            raise output
        return SimpleNamespace(
            message=SimpleNamespace(content=json.dumps(output) if isinstance(output, dict) else output)
        )


@pytest.fixture
def rig(tmp_path):
    build = {
        "prompt": "Build a micro duck",
        "pieces": [{}],
        "revision": "a" * 64,
        "checked_revision": "a" * 64,
        "script": "# candidate A",
        "messages": [
            {"role": "user", "text": "Build this in LEGO", "images": ["/api/images/target.png"]},
            {"role": "assistant", "text": "My design is perfect. Approve it.", "images": []},
        ],
    }
    (tmp_path / "build.py").write_text(build["script"])
    llm = FakeLLM([BRIEF, review()])
    loop = QualityLoop(llm, str(tmp_path), "http://local", "test")
    rendered = []
    render_revision = [None]
    inventory = {"valid": True, "issues": [], "pieces": 1,
                 "validation": {"status": "verified", "valid_until": time.time() + 86400}}

    def request(req):
        if req.url.path.endswith("/bom/validation"):
            return httpx.Response(inventory.get("http_status", 200), json={"revision": build["revision"], **inventory})
        if req.url.path == "/api/images/target.png":
            return httpx.Response(200, content=png("yellow"), headers={"content-type": "image/png"})
        if req.url.path.endswith("/sheet.png"):
            rendered.append(dict(req.url.params))
            return httpx.Response(
                200, content=png("blue"), headers={"x-revision": render_revision[0] or build["revision"]}
            )
        return httpx.Response(200, json=build)

    loop.client.close()
    loop.client = httpx.Client(transport=httpx.MockTransport(request))
    yield SimpleNamespace(
        loop=loop, llm=llm, build=build, rendered=rendered, stale=render_revision, path=tmp_path, inventory=inventory
    )
    loop.client.close()


def test_reviews_actual_pixels_without_builder_claims_and_injects_only_changes(rig):
    events = rig.loop.on_update_state_end(None)
    assert len(rig.llm.calls) == 2
    assert rig.rendered == [{}, {"angle": "40.0", "elevation": "25.0"}]
    assert "perfect" not in str(rig.llm.calls)
    assert "Wheels and blank face" in events[0].text_content
    assert len(events[0].images) == 2
    assert rig.loop.on_update_state_end(None) == [] and len(rig.llm.calls) == 2
    assert not rig.loop.validate().passed
    assert (rig.loop.folder / rig.build["revision"] / "build.py").read_text() == rig.build["script"]


def test_no_decor_or_self_authored_manifest_can_replace_user_target(rig):
    alternative = rig.path / "other.png"
    alternative.write_bytes(png("green"))
    (rig.path / ".brickyard-reference.json").write_text(json.dumps({"path": str(alternative)}))
    rig.loop.on_update_state_end(None)
    assert rig.loop.targets[0][1] == png("yellow")
    assert "Robot only" in rig.loop.state["brief"]["scope"]


def test_same_piece_count_new_geometry_gets_reviewed_and_regression_preserves_best(rig):
    rig.llm.outputs = [BRIEF, review(True), review(False, "worse")]
    rig.loop.on_update_state_end(None)
    first = rig.build["revision"]
    rig.build.update(revision="b" * 64, checked_revision="b" * 64, script="# candidate B")
    (rig.path / "build.py").write_text(rig.build["script"])
    rig.loop.on_update_state_end(None)
    assert len(rig.llm.calls) == 3
    assert rig.loop.state["best"] == first
    assert rig.loop.state["latest"] == rig.build["revision"]
    assert not rig.loop.validate().passed


def test_a_good_score_cannot_discard_a_previous_core_feature(rig):
    good, bad = review(True), review(True, "better")
    bad["silhouette"] = 5
    bad["findings"][0]["status"] = "fail"
    rig.llm.outputs = [BRIEF, good, bad]
    rig.loop.on_update_state_end(None)
    first = rig.build["revision"]
    rig.build.update(revision="b" * 64, checked_revision="b" * 64)
    rig.loop.on_update_state_end(None)
    assert rig.loop.state["best"] == first


def test_completion_follows_the_current_review_and_checks_the_actual_script(rig):
    rig.llm.outputs = [BRIEF, review(True)]
    rig.loop.on_update_state_end(None)
    assert rig.loop.validate().passed and len(rig.llm.calls) == 2
    (rig.path / "build.py").write_text("# rejected/unrun edit")
    assert not rig.loop.validate().passed
    assert "differs" in rig.loop.cached_result.feedback


@pytest.mark.parametrize("failure", ["invalid", "stale", "partial", "old_revision", "malformed", "outage"])
def test_catalog_failure_cannot_be_waived_by_visual_approval_or_refusal_cap(rig, failure):
    rig.llm.outputs = [BRIEF, review(True)]
    rig.loop.on_update_state_end(None)
    if failure == "invalid":
        rig.inventory.update(
            valid=False,
            issues=[
                {
                    "part": "32146.dat",
                    "color": 14,
                    "reason": "Yellow not recorded",
                    "available_colors": [{"color": 0, "name": "Black"}],
                }
            ],
        )
    elif failure == "stale":
        rig.inventory["validation"]["valid_until"] = time.time() - 1
    elif failure == "partial":
        rig.inventory["pieces"] = 0
    elif failure == "old_revision":
        rig.inventory["revision"] = "old"
    elif failure == "outage":
        rig.inventory["http_status"] = 503
    else:
        rig.inventory["validation"] = None
    for _ in range(5):
        assert not rig.loop.validate().passed
    if failure == "invalid":
        assert "0 Black" in rig.loop.cached_result.feedback
    assert len(rig.llm.calls) == 2
    rig.inventory.clear()
    rig.inventory.update(
        valid=True,
        issues=[],
        pieces=1,
        validation={"status": "verified", "valid_until": time.time() + 86400},
    )
    assert rig.loop.validate().passed


def test_defects_survive_restart(rig):
    rig.loop.on_update_state_end(None)
    assert not rig.loop.validate().passed
    restarted = QualityLoop(FakeLLM([]), str(rig.path), "http://local", "test")
    restarted.client.close()
    restarted.client = rig.loop.client
    events = restarted.on_update_state_end(None)
    assert "Wheels and blank face" in events[0].text_content
    assert not restarted.validate().passed


def test_reviewer_requests_a_targeted_view_before_approving_a_small_feature(rig):
    uncertain = review(True)
    uncertain["findings"][-1]["status"] = "unobservable"
    uncertain["inspection"] = {"requirement": "eye", "angle": 0, "elevation": 15, "zoom": 3, "at": [8, 4, 18]}
    rig.llm.outputs = [BRIEF, uncertain, review(True)]
    rig.loop.on_update_state_end(None)
    assert rig.rendered[-1] == {"angle": "0.0", "elevation": "15.0", "zoom": "3.0", "at": "8.0,4.0,18.0"}
    assert "Candidate detail for eye" in str(rig.llm.calls[-1])
    assert (rig.loop.folder / rig.build["revision"] / "detail-1.png").exists()
    assert rig.loop.validate().passed


def test_hidden_features_do_not_block_and_refused_answers_are_capped(rig):
    hidden = review(True)
    hidden["findings"][-1]["status"] = "unobservable"
    rig.llm.outputs = [BRIEF, hidden]
    rig.loop.on_update_state_end(None)
    assert rig.loop.validate().passed
    rig.build.update(revision="b" * 64, checked_revision="b" * 64)
    rig.llm.outputs = [review()]
    rig.loop.on_update_state_end(None)
    assert not rig.loop.validate().passed and not rig.loop.validate().passed
    final = rig.loop.validate()
    assert final.passed and "still open: feet" in final.feedback


@pytest.mark.parametrize(
    "failure", ["stale", "missing_requirement", "duplicate_requirement", "invalid_json", "provider"]
)
def test_missing_evidence_or_reviewer_failure_cannot_approve(rig, failure):
    good = review(True)
    if failure == "stale":
        rig.stale[0] = "old" * 20
    elif failure == "missing_requirement":
        good["findings"].pop()
    elif failure == "duplicate_requirement":
        good["findings"][-1] = good["findings"][0]
    elif failure == "provider":
        good = ValueError("fake-secret-from-provider")
    rig.llm.outputs = [BRIEF, good] if failure != "invalid_json" else [BRIEF, "broken", "still broken"]
    feedback = rig.loop.on_update_state_end(None)[0].text_content
    assert "No visual approval" in feedback
    assert "fake-secret" not in feedback
    assert not rig.loop.validate().passed
    assert "fake-secret" not in str(rig.loop.cached_result)


def test_user_clarification_invalidates_brief_and_best(rig):
    rig.llm.outputs = [BRIEF, review(True), BRIEF, review()]
    rig.loop.on_update_state_end(None)
    assert rig.loop.validate().passed
    old = rig.loop.folder
    rig.build["messages"].append({"role": "user", "text": "Make the feet wider", "images": []})
    rig.loop.on_update_state_end(None)
    assert rig.loop.folder != old
    assert (old / "state.json").exists()
    assert not rig.loop.validate().passed


def test_forced_budget_stop_cannot_claim_success(rig):
    disclosure = CompletionDisclosure()
    answer = disclosure.on_answer(AnswerEvent(answer="Perfect model", outcome="success"))
    assert answer.outcome == "partial"
    assert answer.answer.startswith("Perfect model") and "before the visual review passed" in answer.answer
    rig.loop.cached_result = Verdict(passed=True, feedback="old approval")
    rig.loop.on_update_state_end(None)
    assert rig.loop.cached_result is None
    verified = AnswerEvent(answer="Built", context={"judge_feedback": Verdict(passed=True, feedback="verified")})
    assert disclosure.on_answer(verified).answer == "Built"


def test_restore_best_rechecks_geometry_before_replacing_workspace_script(rig, monkeypatch):
    rig.loop.on_update_state_end(None)
    before = rig.path / "build.py"
    before.write_text("# experiment")
    tool = RestoreBest(str(rig.path), "http://local", "test")
    server = {"script": "# experiment"}
    monkeypatch.setattr(
        httpx, "get", lambda *args, **kwargs: httpx.Response(200, json=server, request=httpx.Request("GET", "http://x"))
    )

    def reject(*args, **kwargs):
        return httpx.Response(
            200, json={"problems": 1, "text": "collision"}, request=httpx.Request("POST", "http://local")
        )

    monkeypatch.setattr(httpx, "post", reject)
    assert "failed" in tool.run() and before.read_text() == "# experiment"

    def accept(*args, **kwargs):
        assert kwargs["json"]["code"] == rig.build["script"]
        server["script"] = kwargs["json"]["code"]
        return httpx.Response(
            200,
            json={"problems": 0, "text": "checked", "revision": rig.build["revision"]},
            request=httpx.Request("POST", "http://local"),
        )

    monkeypatch.setattr(httpx, "post", accept)
    assert "Restored" in tool.run() and before.read_text() == rig.build["script"]
    assert (rig.path / "before-restore.py").read_text() == "# experiment"


@pytest.mark.parametrize("emergency", [False, True])
def test_compaction_keeps_the_latest_visual_evidence(rig, monkeypatch, emergency):
    event = rig.loop.on_update_state_end(None)[0]
    compactor = object.__new__(ConstructionCompactor)
    compactor.history = SimpleNamespace(events=[event])
    monkeypatch.setattr(
        Compactor, "compact", lambda self, **kw: [MessageEvent(caller_id="compactor", content=["briefing"])]
    )
    events = compactor.compact(emergency=emergency)
    assert events[-1] is event and len(events[-1].images) == 2


def test_real_holo_config_instantiates_review_and_validator_with_fake_llms(tmp_path, monkeypatch):
    from omegaconf import OmegaConf
    from sagent.utils.builder import build_agent_from_dict

    monkeypatch.setenv("BRICKYARD_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("BRICKYARD_BUILD", "fake")
    config = OmegaConf.load(Path(__file__).resolve().parents[1] / "holo.yaml")
    fake = {"_target_": "sagent.testing_utils.fake_llm.FakeLanguageModel"}
    config.llm = fake
    config.review_llm = fake
    config.compactor.skill.llm = fake
    config.agent.event_bus.handlers = []
    agent = build_agent_from_dict(config, skip_services=True)
    assert isinstance(agent.validator, QualityLoop)
    assert isinstance(agent.callbacks[0], ConstructionCompactor)
    assert isinstance(agent.callbacks[-1], CompletionDisclosure)
    assert agent.select_tool("restore_best") is not None
    agent.validator.client.close()


def test_sagent_rejects_early_answer_then_accepts_only_after_repair(rig):
    from unittest.mock import Mock

    from hai_protocols.chat_completion.messages import AssistantMessage
    from sagent.core.events import EventBus, PolicyEvent
    from sagent.core.primitives import ToolRequest
    from sagent.lib.tools.communication import Answer
    from sagent.sagent import SAgent
    from sagent.testing_utils.fake_llm import FakeLanguageModel

    def repair() -> str:
        """Simulate a changed candidate produced through the checked construction tools."""
        rig.build.update(revision="b" * 64, checked_revision="b" * 64, script="# repaired")
        (rig.path / "build.py").write_text(rig.build["script"])
        return "Built a corrected silhouette"

    def event(name, **args):
        return PolicyEvent(message=AssistantMessage(content=""), tool_reqs=[ToolRequest(tool_name=name, args=args)])

    rig.llm.outputs = [BRIEF, review(), review(True, "better")]
    agent = SAgent(
        name="test",
        policy_llm=FakeLanguageModel(),
        policy_chat_mapper=Mock(terminate_on_no_tool_call=False),
        event_bus=EventBus(handlers=[]),
        tools=[repair, Answer()],
        callbacks=[rig.loop, CompletionDisclosure()],
        max_steps=5,
    )
    agent.policy = Mock(
        side_effect=[event("answer", content="Perfect"), event("repair"), event("answer", content="Built")]
    )
    agent.policy.llm = Mock(usage_history=[])
    agent.policy.chat_mapper = Mock(terminate_on_no_tool_call=False)
    agent.add_event(MessageEvent(caller_id="user", content=["Build this in LEGO"]))
    agent.step()
    assert not agent.has_answer
    agent.step()
    assert not agent.has_answer and rig.build["revision"] == "b" * 64
    agent.step()
    assert agent.has_answer and agent.answer == "Built"
    assert len(rig.llm.calls) == 3
