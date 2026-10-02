"""Process entry for `python -m boringcontext` and the Vercel FastAPI app.

Supabase is used only when a project URL and an anon or publishable key are
set. Otherwise the process keeps an empty in-memory store, so the offline
tests never open a socket. The service-role key is ignored: memory policies
require `auth.uid()`, and that role would skip them.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any

import httpx
from fastapi import FastAPI, Request

from boringcontext.api import create_app
from boringcontext.clients import create_embedding_client, create_formulator_client
from boringcontext.mcp_store import McpRpcStore
from boringcontext.memory_store import InMemoryStore
from boringcontext.postgrest import PostgrestClient, access_token
from boringcontext.store import create_memory_api
from boringcontext.supabase_store import SupabaseStore

_URL_NAMES = ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
_KEY_NAMES = (
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
)


def _read(name: str, env: dict[str, str | None]) -> str:
    value = (env.get(name) or "").strip()
    if not value or value == "[REDACTED]":
        return ""
    return value


def _jwt_role(token: str) -> str | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + padding))
    except Exception:
        return None
    role = data.get("role")
    return role if isinstance(role, str) else None


def supabase_config(env: dict[str, str | None] | None = None) -> tuple[str, str] | None:
    source = env if env is not None else os.environ
    url = ""
    for name in _URL_NAMES:
        url = _read(name, source)
        if url:
            break
    key = ""
    for name in _KEY_NAMES:
        key = _read(name, source)
        if key:
            break
    if not url or not key:
        return None
    if not (key.startswith("eyJ") or key.startswith("sb_")):
        return None
    # A service-role JWT skips RLS. Refuse it and stay on the empty store.
    if _jwt_role(key) == "service_role":
        return None
    return url.rstrip("/"), key


class SupabaseSpaces:
    def __init__(self, client: PostgrestClient) -> None:
        self.client = client

    async def readable_space_ids(self, user_id: str) -> list[str]:
        result = await self.client.table("space_members").select("space_id").eq("user_id", user_id)
        if result["error"]:
            raise RuntimeError(result["error"].get("message") or "space lookup failed")
        return [row["space_id"] for row in result["data"] or [] if row.get("space_id")]

    async def list_spaces(self, user_id: str) -> list[dict]:
        ids = await self.readable_space_ids(user_id)
        if not ids:
            return []
        spaces = await self.client.table("spaces").select("id, kind, name").in_("id", ids)
        if spaces["error"]:
            spaces = await self.client.table("spaces").select("id, kind").in_("id", ids)
        if spaces["error"]:
            raise RuntimeError(spaces["error"].get("message") or "space lookup failed")
        listed = []
        for row in spaces["data"] or []:
            kind = row.get("kind")
            if kind not in ("personal", "shared") or not row.get("id"):
                continue
            item = {"id": row["id"], "kind": kind}
            name = row.get("name")
            if isinstance(name, str) and name.strip():
                item["name"] = name.strip()
            listed.append(item)
        return listed

    async def space_for(self, user_id: str, kind: str) -> str | None:
        spaces = await self.list_spaces(user_id)
        matches = [row for row in spaces if row["kind"] == kind]
        if kind == "shared" and len(matches) != 1:
            return None
        return matches[0]["id"] if matches else None

    async def is_member(self, user_id: str, space_id: str) -> bool:
        result = await (
            self.client.table("space_members")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("space_id", space_id)
            .maybe_single()
        )
        if result["error"]:
            raise RuntimeError(result["error"].get("message") or "space lookup failed")
        return bool(result["data"])


class PersonalSpaceStore:
    """Fill `space_id` on a plain insert so the member RLS check can pass.

    The four-field write does not name a space. v1.2 only accepts a row whose
    space the caller belongs to. Personal is the default. Shared still requires
    the text to ask for it, which the formulator path handles itself.
    """

    def __init__(self, inner: SupabaseStore, spaces: SupabaseSpaces) -> None:
        self.inner = inner
        self.spaces = spaces

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    async def insert(self, user_id: str, fields: dict) -> dict:
        payload = fields
        if not fields.get("space_id"):
            space_id = await self.spaces.space_for(user_id, "personal")
            if space_id:
                payload = {**fields, "space_id": space_id}
        return await self.inner.insert(user_id, payload)


class SessionResolver:
    def __init__(self, url: str, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.url = url
        self.api_key = api_key
        self._transport = transport

    def _headers(self, token: str | None = None) -> dict[str, str]:
        return {
            "apikey": self.api_key,
            "Authorization": f"Bearer {token or self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _request(self, method: str, path: str, *, token: str | None = None, body: dict | None = None) -> httpx.Response:
        async with httpx.AsyncClient(transport=self._transport, timeout=20.0) as http:
            return await http.request(
                method,
                f"{self.url}{path}",
                headers=self._headers(token),
                content=None if body is None else json.dumps(body),
            )

    async def user_id_for(self, jwt: str) -> str | None:
        response = await self._request("GET", "/auth/v1/user", token=jwt)
        if response.status_code != 200:
            return None
        try:
            body = response.json()
        except Exception:
            return None
        user_id = body.get("id") if isinstance(body, dict) else None
        return user_id if isinstance(user_id, str) and user_id else None

    async def mcp_session(self, bearer: str) -> dict | None:
        response = await self._request(
            "POST",
            "/rest/v1/rpc/oauth_get_session",
            body={"p_access": bearer},
        )
        if response.status_code >= 400:
            return None
        try:
            body = response.json()
        except Exception:
            return None
        if not isinstance(body, dict):
            return None
        user_id = body.get("user_id")
        supabase_access = body.get("supabase_access")
        supabase_refresh = body.get("supabase_refresh")
        if not all(isinstance(value, str) and value for value in (user_id, supabase_access, supabase_refresh)):
            return None
        return {
            "user_id": user_id,
            "supabase_access": supabase_access,
            "supabase_refresh": supabase_refresh,
        }

    async def refresh(self, refresh_token: str) -> tuple[str, str] | None:
        response = await self._request(
            "POST",
            "/auth/v1/token?grant_type=refresh_token",
            body={"refresh_token": refresh_token},
        )
        if response.status_code != 200:
            return None
        try:
            body = response.json()
        except Exception:
            return None
        access = body.get("access_token") if isinstance(body, dict) else None
        user = body.get("user") if isinstance(body, dict) else None
        user_id = user.get("id") if isinstance(user, dict) else None
        if isinstance(access, str) and access and isinstance(user_id, str) and user_id:
            return user_id, access
        return None

    async def resolve(self, bearer: str) -> tuple[str, str] | None:
        if bearer.count(".") == 2 and bearer.startswith("eyJ"):
            user_id = await self.user_id_for(bearer)
            if user_id:
                return user_id, bearer
        session = await self.mcp_session(bearer)
        if session is None:
            return None
        user_id = await self.user_id_for(session["supabase_access"])
        if user_id:
            return user_id, session["supabase_access"]
        refreshed = await self.refresh(session["supabase_refresh"])
        return refreshed


def create_runtime_app(
    env: dict[str, str | None] | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    config = supabase_config(env)
    if config is None:
        return create_app(store=InMemoryStore())

    url, key = config
    client = PostgrestClient(url, key, transport=transport)
    spaces = SupabaseSpaces(client)
    store = PersonalSpaceStore(SupabaseStore(client), spaces)
    app = create_app(
        store=store,
        spaces=spaces,
        embedding=create_embedding_client(env, transport),
        formulator=create_formulator_client(env, transport),
    )
    resolver = SessionResolver(url, key, transport=transport)

    @app.middleware("http")
    async def bind_user(request: Request, call_next):
        header = request.headers.get("authorization", "")
        bearer = header[7:].strip() if header.lower().startswith("bearer ") else ""
        token_to_use: str | None = None
        if bearer:
            resolved = await resolver.resolve(bearer)
            if resolved:
                request.state.bc_user_id = resolved[0]
                token_to_use = resolved[1]
        reset = access_token.set(token_to_use)
        try:
            return await call_next(request)
        finally:
            access_token.reset(reset)

    return app


def _jwt_bearer(bearer: str) -> bool:
    return bearer.count(".") == 2 and bearer.startswith("eyJ")


def _fields(body: dict) -> dict:
    return {
        "project": str(body.get("project") or ""),
        "category": str(body.get("category") or ""),
        "title": str(body.get("title") or ""),
        "content": str(body.get("content") or ""),
    }


def _js_number(value: Any) -> float:
    if isinstance(value, bool):
        return float("nan")
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return float("nan")
    return float("nan")


def _offset(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    return _js_number(value)


def _search(body: dict) -> dict:
    return {
        "project": None if body.get("project") is None else str(body.get("project")),
        "category": None if body.get("category") is None else str(body.get("category")),
        "query": None if body.get("query") is None else str(body.get("query")),
        "offset": _offset(body.get("offset")),
    }


async def dispatch_brain(api: Any, op: str, user_id: str, payload: dict) -> dict:
    """MCP and the dashboard share one dispatch so the thresholds cannot drift."""
    if op == "get_context":
        context = {"prompt": payload["prompt"] if isinstance(payload.get("prompt"), str) else ""}
        if isinstance(payload.get("project"), str):
            context["project"] = payload["project"]
        return await api.get_context(user_id, context)
    if op == "save_brief":
        return await api.save_brief(user_id, payload)
    if op == "save_memory":
        return await api.save_memory(user_id, _fields(payload))
    if op == "save_lesson":
        # The caller may send a category. lesson_memory always stores lesson.
        return await api.save_lesson(
            user_id,
            {
                "project": str(payload.get("project") or ""),
                "title": str(payload.get("title") or ""),
                "content": str(payload.get("content") or ""),
            },
        )
    if op == "update_memory":
        return await api.update_memory(
            user_id,
            {
                **_fields(payload),
                "id": str(payload.get("id") or ""),
                "allow_project_change": payload.get("allow_project_change") is True,
            },
        )
    if op == "search_memory":
        return await api.search_memory(user_id, _search(payload))
    if op == "save_dashboard":
        space_id = str(payload.get("space_id") or "").strip()
        if not space_id:
            return {"error": {"code": "INVALID_SPACE", "message": "space_id krävs."}}
        return await api.save_dashboard_memory(user_id, _fields(payload), space_id)
    if op == "delete_memory":
        return await api.delete_memory(user_id, str(payload.get("id") or ""))
    if op == "search_in_space":
        space_id = str(payload.get("space_id") or "").strip()
        if not space_id:
            return {"error": {"code": "INVALID_SPACE", "message": "space_id krävs."}}
        return await api.search_in_space(user_id, space_id, _search(payload))
    if op == "list_versions":
        return await api.list_versions(user_id, str(payload.get("id") or ""))
    if op == "list_deletions":
        space_id = str(payload.get("space_id") or "").strip()
        if not space_id:
            return {"error": {"code": "INVALID_SPACE", "message": "space_id krävs."}}
        return await api.list_deletions(user_id, space_id)
    return {"error": {"code": "INVALID_BODY", "message": "Okänd operation."}}


async def run_brain_call(
    op: str,
    user_id: str,
    payload: dict,
    bearer: str,
    env: dict[str, str | None] | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict:
    """Run one memory operation. Ranking and formulation stay in this package."""
    embedding = create_embedding_client(env, transport)
    formulator = create_formulator_client(env, transport)
    config = supabase_config(env)
    if config is None:
        api = create_memory_api(InMemoryStore(), type("Brain", (), {"spaces": None, "embedding": embedding, "formulator": formulator})())
        return await dispatch_brain(api, op, user_id, payload)

    url, key = config
    client = PostgrestClient(url, key, transport=transport)
    spaces = SupabaseSpaces(client)
    resolver = SessionResolver(url, key, transport=transport)
    space_token: str | None = None
    if _jwt_bearer(bearer):
        resolved_user = await resolver.user_id_for(bearer)
        if not resolved_user:
            return {"error": {"code": "UNAUTHENTICATED", "message": "Inte inloggad."}}
        user_id = resolved_user
        space_token = bearer
        store: Any = PersonalSpaceStore(SupabaseStore(client), spaces)
    else:
        session = await resolver.mcp_session(bearer) if bearer else None
        if session is None:
            return {"error": {"code": "UNAUTHENTICATED", "message": "Inte inloggad."}}
        user_id = session["user_id"]
        space_token = session["supabase_access"]
        if not await resolver.user_id_for(space_token):
            refreshed = await resolver.refresh(session["supabase_refresh"])
            if refreshed:
                space_token = refreshed[1]
        store = McpRpcStore(client, bearer)

    brain = type("Brain", (), {"spaces": spaces, "embedding": embedding, "formulator": formulator})()
    api = create_memory_api(store, brain)
    marker = access_token.set(space_token)
    try:
        return await dispatch_brain(api, op, user_id, payload)
    finally:
        access_token.reset(marker)
