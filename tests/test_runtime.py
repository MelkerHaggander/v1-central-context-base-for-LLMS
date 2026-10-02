import base64
import json

import httpx
from fastapi.testclient import TestClient

from boringcontext.memory_store import InMemoryStore
from boringcontext.postgrest import PostgrestClient, access_token
from boringcontext.runtime import PersonalSpaceStore, create_runtime_app, supabase_config
from boringcontext.supabase_store import SupabaseStore

URL = "https://example.supabase.co"
ANON = "sb_publishable_test"
USER = "11111111-1111-4111-8111-111111111111"
SPACE = "22222222-2222-4222-8222-222222222222"
ROW = {
    "id": "33333333-3333-4333-8333-333333333333",
    "project": "Projekt A",
    "category": "fact",
    "title": "API",
    "content": "Routes stay stable.",
    "created_at": "2026-10-02T12:00:00+00:00",
    "updated_at": "2026-10-02T12:00:00+00:00",
}


def _jwt(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJub25lIn0.{body}.sig"


def test_missing_env_keeps_an_empty_memory_store():
    app = create_runtime_app({})
    assert isinstance(app.state.memory.store, InMemoryStore)
    health = TestClient(app).get("/api/health")
    assert health.status_code == 200
    assert health.json()["mcp"] == "1.2.0"
    denied = TestClient(app).post(
        "/api/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_context", "arguments": {"prompt": "hello"}}},
    )
    assert denied.status_code == 401


def test_service_role_key_is_not_used():
    env = {
        "SUPABASE_URL": URL,
        "SUPABASE_ANON_KEY": _jwt({"role": "service_role"}),
        "SUPABASE_SERVICE_ROLE_KEY": _jwt({"role": "service_role"}),
    }
    assert supabase_config(env) is None
    assert isinstance(create_runtime_app(env).state.memory.store, InMemoryStore)


def test_publishable_key_selects_supabase():
    app = create_runtime_app({"SUPABASE_URL": URL + "/", "SUPABASE_ANON_KEY": ANON})
    assert isinstance(app.state.memory.store, PersonalSpaceStore)
    assert isinstance(app.state.memory.store.inner, SupabaseStore)


def test_postgrest_sends_the_user_jwt_and_keeps_the_anon_key():
    import asyncio

    user_jwt = _jwt({"role": "authenticated", "sub": USER})
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["apikey"] = request.headers["apikey"]
        captured["authorization"] = request.headers["authorization"]
        captured["params"] = str(request.url)
        return httpx.Response(201, json=[{**ROW, "space_id": SPACE}])

    async def run():
        client = PostgrestClient(URL, ANON, transport=httpx.MockTransport(handler))
        marker = access_token.set(user_jwt)
        try:
            return await client.table("memories").insert({"project": "Projekt A", "space_id": SPACE}).select("id").single()
        finally:
            access_token.reset(marker)

    result = asyncio.run(run())
    assert result["error"] is None
    assert result["data"]["id"] == ROW["id"]
    assert captured["apikey"] == ANON
    assert captured["authorization"] == f"Bearer {user_jwt}"
    assert "service_role" not in captured["authorization"]


def test_logged_in_call_saves_and_lists_with_lexical_fallback():
    user_jwt = _jwt({"role": "authenticated", "sub": USER})
    saved = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/v1/user":
            assert request.headers["authorization"] == f"Bearer {user_jwt}"
            assert request.headers["apikey"] == ANON
            return httpx.Response(200, json={"id": USER})
        if request.url.path.endswith("/space_members"):
            return httpx.Response(200, json=[{"space_id": SPACE, "user_id": USER}])
        if request.url.path.endswith("/spaces"):
            return httpx.Response(200, json=[{"id": SPACE, "kind": "personal"}])
        if request.url.path.endswith("/memories") and request.method == "POST":
            body = json.loads(request.content)
            assert body["space_id"] == SPACE
            assert "user_id" not in body
            assert request.headers["authorization"] == f"Bearer {user_jwt}"
            saved.append(body)
            return httpx.Response(201, json=[{**ROW, **body}])
        if request.url.path.endswith("/memories") and request.method == "GET":
            return httpx.Response(200, json=[{**ROW, "space_id": SPACE, "source": None}])
        return httpx.Response(404, json={"code": "404", "message": request.url.path})

    app = create_runtime_app(
        {"SUPABASE_URL": URL, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": ANON},
        transport=httpx.MockTransport(handler),
    )
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {user_jwt}"}
    created = client.post(
        "/api/mcp/save_memory",
        headers=headers,
        json={"project": "Projekt A", "category": "fact", "title": "API", "content": "Routes stay stable."},
    )
    assert created.status_code == 200
    assert created.json()["title"] == "API"
    assert saved[0]["space_id"] == SPACE
    context = client.post(
        "/api/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "get_context", "arguments": {"prompt": "API routes"}},
        },
    )
    assert context.status_code == 200
    body = json.loads(context.json()["result"]["content"][0]["text"])
    assert body["items"][0]["title"] == "API"
    assert body["written"] == []
    names = [
        tool["name"]
        for tool in client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]
    ]
    assert names == ["get_context", "save_memory"]
