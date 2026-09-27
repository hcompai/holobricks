import asyncio

from fastapi.testclient import TestClient

from brickyard import app as app_module
from brickyard.model import Build, Message, Piece, Step
from brickyard.session import Session, Store


def test_state_token_covers_same_count_edits_chat_and_metadata(tmp_path, monkeypatch):
    store = Store(tmp_path)
    build = Build(
        pieces=[Piece(id=1, part="3001.dat", color=4, pos=(20, 0, 20), step=0)],
        steps=[Step(index=0, title="Base")],
        script="private implementation",
    )
    store.save(build)
    monkeypatch.setattr(app_module, "store", store)
    monkeypatch.setattr(app_module, "sessions", {})
    client = TestClient(app_module.app)
    url = f"/api/builds/{build.id}/state"
    response = client.get(url)
    first = response.json()
    assert response.headers["cache-control"] == "no-store"
    assert first["build"]["revision"] == build.revision
    assert "script" not in first["build"]
    assert client.get(url, params={"after": first["token"]}).json()["build"] is None
    build.pieces[0].color = 15  # Same count, no timestamp update, no emitted event.
    store.save(build)
    second = client.get(url, params={"after": first["token"]}).json()
    assert second["build"]["pieces"][0]["color"] == 15
    assert second["build"]["revision"] != first["build"]["revision"]
    build.messages.append(Message(role="user", text="A new detail"))
    build.name = "Renamed"
    store.save(build)
    third = client.get(url, params={"after": second["token"]}).json()
    assert third["build"]["revision"] == second["build"]["revision"]
    assert third["build"]["name"] == "Renamed"
    assert third["build"]["messages"][-1]["text"] == "A new detail"


def test_pending_render_is_recoverable_without_stream_or_geometry_change(tmp_path, monkeypatch):
    async def run():
        session = Session(Build(), Store(tmp_path))
        monkeypatch.setattr(app_module, "session_for", lambda _: session)
        first = await app_module.get_state(session.build.id)
        import json

        token = json.loads(first.body)["token"]
        waiting = asyncio.create_task(session.render(timeout=2))
        await asyncio.sleep(0)
        state = json.loads((await app_module.get_state(session.build.id, token)).body)
        assert state["build"] is None
        assert len(state["renders"]) == 1
        render = state["renders"][0]
        assert render["revision"] == session.build.revision
        assert session.deliver_render(render["request"], b"pixels", 0, render["revision"])
        assert await waiting == b"pixels"
        assert json.loads((await app_module.get_state(session.build.id, token)).body)["renders"] == []

    asyncio.run(run())


def test_finished_streams_release_connections_including_old_viewer_tabs(tmp_path, monkeypatch):
    session = Session(Build(status="done"), Store(tmp_path))
    monkeypatch.setattr(app_module, "session_for", lambda _: session)
    response = TestClient(app_module.app).get(f"/api/builds/{session.build.id}/events")
    assert response.status_code == 204
    assert not session.subscribers
