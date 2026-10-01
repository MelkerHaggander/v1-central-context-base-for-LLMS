import json

from fastapi.testclient import TestClient

from boringcontext.api import create_app
from boringcontext.instructions import MCP_TOOLS
from boringcontext.memory_store import InMemoryStore
from tests.test_memory import PERSONAL, USER_A, Embed, Formulator

TOKEN = "session-token"


class _Spaces:
    async def readable_space_ids(self, _user_id):
        return [PERSONAL]

    async def space_for(self, _user_id, kind):
        return PERSONAL if kind == "personal" else None

    async def is_member(self, _user_id, space_id):
        return space_id == PERSONAL


def _client():
    app = create_app(
        store=InMemoryStore(),
        spaces=_Spaces(),
        embedding=Embed(lambda _text: [1, 0, 0]),
        formulator=Formulator(lambda _payload: _drafts()),
        sessions={TOKEN: USER_A},
    )
    return TestClient(app)


async def _drafts():
    return [{
        "space": "personal",
        "project": "Boring Context",
        "category": "fact",
        "title": "API",
        "content": "Routes stay stable.",
    }]


def test_mcp_lists_only_two_tools_and_requires_auth_to_call():
    client = _client()
    listed = client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert listed.status_code == 200
    names = [tool["name"] for tool in listed.json()["result"]["tools"]]
    assert names == ["get_context", "save_memory"]
    assert [tool["name"] for tool in MCP_TOOLS] == names
    get_context = listed.json()["result"]["tools"][0]
    assert get_context["annotations"]["readOnlyHint"] is False
    assert "keywords" not in get_context["inputSchema"]["properties"]
    assert "delete_memory" not in names
    denied = client.post(
        "/api/mcp",
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "get_context", "arguments": {"prompt": "hello"}}},
    )
    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "UNAUTHENTICATED"
    health = client.get("/api/health")
    assert health.json()["mcp"] == "1.2.0"
    assert health.json()["brain"] is True
    init = client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "initialize"})
    assert "get_context" in init.json()["result"]["instructions"]
    assert "save_memory" in init.json()["result"]["instructions"]
    assert init.json()["result"]["serverInfo"]["version"] == "1.2.0"


def test_mcp_save_updates_same_subject_and_http_memory_roundtrip():
    client = _client()
    headers = {"Authorization": f"Bearer {TOKEN}"}
    first = client.post(
        "/api/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "save_memory", "arguments": {"brief": "Remember the API path."}}},
    )
    assert first.status_code == 200
    payload = json.loads(first.json()["result"]["content"][0]["text"])
    assert payload["items"][0]["space"] == "personal"
    assert "content" not in payload["items"][0]
    created = client.post(
        "/api/memories",
        headers=headers,
        json={"space_id": PERSONAL, "project": "Projekt A", "category": "decision", "title": "Stack", "content": "Första texten."},
    )
    assert created.status_code == 201
    assert created.headers["x-v1-user-id"] == USER_A
    memory_id = created.json()["id"]
    patched = client.patch(
        f"/api/memories/{memory_id}",
        headers=headers,
        json={"project": "Projekt A", "category": "decision", "title": "Stack", "content": "Andra texten."},
    )
    assert patched.status_code == 200
    assert patched.json()["content"] == "Andra texten."
    versions = client.get(f"/api/memories/{memory_id}/versions", headers=headers)
    assert versions.json()[0]["event"] == "update"
    assert versions.json()[0]["content_before"] == "Första texten."
    removed = client.delete(f"/api/memories/{memory_id}", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["success"] is True
    after = client.get(f"/api/memories/{memory_id}/versions", headers=headers)
    assert after.json()[0]["event"] == "delete"
    listed = client.get("/api/memories", headers=headers, params={"space_id": PERSONAL, "query": "texten"})
    assert listed.json() == []
    four = client.post(
        "/api/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {"name": "save_memory", "arguments": {"project": "Projekt A", "category": "fact", "title": "API", "content": "Routes stay stable."}},
        },
    )
    assert json.loads(four.json()["result"]["content"][0]["text"])["error"]["code"] == "INVALID_CONTENT"
    unknown = client.post(
        "/api/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "delete_memory", "arguments": {}}},
    )
    assert unknown.json()["result"]["isError"] is True
