import json
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from boringcontext.instructions import MCP_SERVER_INFO, MCP_TOOLS, MEMORY_INSTRUCTIONS
from boringcontext.store import MemoryApi, create_memory_api

NO_STORE = {
    "Cache-Control": "private, no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
}


def _json(body: Any, status: int = 200, headers: dict | None = None) -> JSONResponse:
    merged = {**NO_STORE, **(headers or {})}
    return JSONResponse(body, status_code=status, headers=merged)


def _error(code: str, message: str, status: int) -> JSONResponse:
    return _json({"error": {"code": code, "message": message}}, status)


def _owned(body: Any, user_id: str, status: int = 200) -> JSONResponse:
    return _json(body, status, {"X-V1-User-Id": user_id})


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


def _fields(body: dict) -> dict:
    return {
        "project": str(body.get("project") or ""),
        "category": str(body.get("category") or ""),
        "title": str(body.get("title") or ""),
        "content": str(body.get("content") or ""),
    }


def _status_for(code: str) -> int:
    if code == "NOT_FOUND":
        return 404
    if code == "FORBIDDEN":
        return 403
    if code.startswith("INVALID_") or code in {"PROJECT_CHANGE_REQUIRES_FLAG", "LESSON_CATEGORY_REQUIRES_TOOL"}:
        return 400
    return 500


class AppState:
    def __init__(self, store: Any, spaces: Any, embedding: Any, formulator: Any, sessions: dict[str, str]) -> None:
        self.store = store
        self.spaces = spaces
        self.embedding = embedding
        self.formulator = formulator
        self.sessions = sessions

    def api_for(self, *, with_brain: bool) -> MemoryApi:
        if not with_brain:
            return create_memory_api(self.store)

        class Brain:
            pass

        brain = Brain()
        brain.spaces = self.spaces
        brain.embedding = self.embedding
        brain.formulator = self.formulator
        return create_memory_api(self.store, brain)

    def user_id(self, request: Request) -> str | None:
        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            return None
        return self.sessions.get(header[7:].strip())


def create_app(
    store: Any,
    *,
    spaces: Any = None,
    embedding: Any = None,
    formulator: Any = None,
    sessions: dict[str, str] | None = None,
) -> FastAPI:
    app = FastAPI()
    state = AppState(store, spaces, embedding, formulator, sessions or {})
    app.state.memory = state

    def current(request: Request) -> str | None:
        return request.app.state.memory.user_id(request)

    @app.get("/api/health")
    async def health() -> JSONResponse:
        return _json(
            {
                "ok": True,
                "mcp": "1.2.0",
                "brain": True,
                "promptTransports": True,
            }
        )

    @app.get("/api/memories")
    async def list_memories(request: Request) -> JSONResponse:
        user_id = current(request)
        if not user_id:
            return _error("UNAUTHENTICATED", "Inte inloggad.", 401)
        space_id = (request.query_params.get("space_id") or "").strip()
        if not space_id:
            return _error("INVALID_SPACE", "space_id krävs.", 400)
        offset_raw = request.query_params.get("offset")
        offset = 0 if offset_raw is None or offset_raw == "" else _js_number(offset_raw)
        result = await state.api_for(with_brain=True).search_in_space(
            user_id,
            space_id,
            {
                "project": request.query_params.get("project"),
                "category": request.query_params.get("category"),
                "query": request.query_params.get("query"),
                "offset": offset,
            },
        )
        if "error" in result:
            status = 403 if result["error"]["code"] == "FORBIDDEN" else 400
            return _error(result["error"]["code"], result["error"]["message"], status)
        return _owned(result["data"], user_id)

    @app.post("/api/memories")
    async def create_memory(request: Request) -> JSONResponse:
        user_id = current(request)
        if not user_id:
            return _error("UNAUTHENTICATED", "Inte inloggad.", 401)
        try:
            body = await request.json()
        except Exception:
            return _error("INVALID_BODY", "Ogiltig JSON.", 400)
        if not isinstance(body, dict):
            return _error("INVALID_BODY", "Ogiltig JSON.", 400)
        space_id = str(body.get("space_id") or "").strip()
        if not space_id:
            return _error("INVALID_SPACE", "space_id krävs.", 400)
        result = await state.api_for(with_brain=True).save_dashboard_memory(user_id, _fields(body), space_id)
        if "error" in result:
            code = result["error"]["code"]
            status = 403 if code == "FORBIDDEN" else 400 if code.startswith("INVALID_") else 500
            return _error(code, result["error"]["message"], status)
        return _owned(result["data"], user_id, 201)

    @app.patch("/api/memories/{memory_id}")
    async def patch_memory(memory_id: str, request: Request) -> JSONResponse:
        user_id = current(request)
        if not user_id:
            return _error("UNAUTHENTICATED", "Inte inloggad.", 401)
        try:
            body = await request.json()
        except Exception:
            return _error("INVALID_BODY", "Ogiltig JSON.", 400)
        result = await state.api_for(with_brain=True).update_memory(
            user_id,
            {**_fields(body), "id": memory_id, "allow_project_change": body.get("allow_project_change") is True},
        )
        if "error" in result:
            return _error(result["error"]["code"], result["error"]["message"], _status_for(result["error"]["code"]))
        return _owned(result["data"], user_id)

    @app.delete("/api/memories/{memory_id}")
    async def remove_memory(memory_id: str, request: Request) -> JSONResponse:
        user_id = current(request)
        if not user_id:
            return _error("UNAUTHENTICATED", "Inte inloggad.", 401)
        result = await state.api_for(with_brain=True).delete_memory(user_id, memory_id)
        if "error" in result:
            return _error(result["error"]["code"], result["error"]["message"], _status_for(result["error"]["code"]))
        return _owned(result["data"], user_id)

    @app.get("/api/memories/{memory_id}/versions")
    async def memory_versions(memory_id: str, request: Request) -> JSONResponse:
        user_id = current(request)
        if not user_id:
            return _error("UNAUTHENTICATED", "Inte inloggad.", 401)
        result = await state.api_for(with_brain=True).list_versions(user_id, memory_id)
        if "error" in result:
            return _error(result["error"]["code"], result["error"]["message"], _status_for(result["error"]["code"]))
        return _owned(result["data"], user_id)

    @app.post("/api/mcp/get_context")
    async def http_get_context(request: Request) -> JSONResponse:
        return await _http_tool(request, "get_context")

    @app.post("/api/mcp/save_memory")
    async def http_save_memory(request: Request) -> JSONResponse:
        return await _http_tool(request, "save_memory")

    @app.post("/api/mcp/update_memory")
    async def http_update_memory(request: Request) -> JSONResponse:
        return await _http_tool(request, "update_memory")

    @app.post("/api/mcp/lesson_memory")
    async def http_lesson_memory(request: Request) -> JSONResponse:
        return await _http_tool(request, "lesson_memory")

    @app.post("/api/mcp/search_memory")
    async def http_search_memory(request: Request) -> JSONResponse:
        return await _http_tool(request, "search_memory")

    async def _http_tool(request: Request, name: str) -> JSONResponse:
        user_id = current(request)
        if not user_id:
            return _error("UNAUTHENTICATED", "Inte inloggad.", 401)
        if name == "search_memory":
            try:
                text = await request.body()
                body = json.loads(text) if text else {}
            except Exception:
                return _error("INVALID_BODY", "Ogiltig JSON.", 400)
        else:
            try:
                body = await request.json()
            except Exception:
                return _error("INVALID_BODY", "Ogiltig JSON.", 400)
        if not isinstance(body, dict):
            return _error("INVALID_BODY", "Ogiltig JSON.", 400)
        # HTTP save_memory is the four-field write. The MCP tool is the brief.
        api = state.api_for(with_brain=name == "get_context")
        if name == "get_context":
            api = state.api_for(with_brain=True)
            result = await api.get_context(
                user_id,
                {
                    "prompt": body["prompt"] if isinstance(body.get("prompt"), str) else "",
                    **({"project": body["project"]} if isinstance(body.get("project"), str) else {}),
                },
            )
        elif name == "save_memory":
            result = await api.save_memory(user_id, _fields(body))
        elif name == "update_memory":
            result = await api.update_memory(
                user_id,
                {
                    **_fields(body),
                    "id": str(body.get("id") or ""),
                    "allow_project_change": body.get("allow_project_change") is True,
                },
            )
        elif name == "lesson_memory":
            result = await api.save_lesson(
                user_id,
                {
                    "project": str(body.get("project") or ""),
                    "title": str(body.get("title") or ""),
                    "content": str(body.get("content") or ""),
                },
            )
        else:
            result = await api.search_memory(
                user_id,
                {
                    "project": None if body.get("project") is None else str(body.get("project")),
                    "category": None if body.get("category") is None else str(body.get("category")),
                    "query": None if body.get("query") is None else str(body.get("query")),
                    "offset": 0 if body.get("offset") is None else _js_number(body.get("offset")),
                },
            )
        if "error" in result:
            code = result["error"]["code"]
            if name == "search_memory":
                status = 400
            elif name == "get_context":
                status = 400 if code.startswith("INVALID_") else 500
            else:
                status = _status_for(code)
            return _error(code, result["error"]["message"], status)
        return _json(result["data"])

    @app.post("/api/mcp")
    async def mcp(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:
            return _error("INVALID_BODY", "Ogiltig JSON.", 400)
        if not isinstance(body, dict):
            return _error("INVALID_BODY", "Ogiltig JSON.", 400)
        method = body.get("method")
        request_id = body.get("id")
        if isinstance(method, str) and method.startswith("notifications/"):
            return JSONResponse(None, status_code=202)
        if method == "initialize":
            return _json(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "protocolVersion": "2025-03-26",
                        "capabilities": {"tools": {}},
                        "serverInfo": MCP_SERVER_INFO,
                        "instructions": MEMORY_INSTRUCTIONS,
                    },
                }
            )
        if method == "tools/list":
            return _json({"jsonrpc": "2.0", "id": request_id, "result": {"tools": MCP_TOOLS}})
        if method == "tools/call":
            user_id = current(request)
            if not user_id:
                return _error("UNAUTHENTICATED", "Inte inloggad.", 401)
            params = body.get("params") or {}
            name = params.get("name")
            arguments = params.get("arguments") or {}
            if name not in {"get_context", "save_memory"}:
                return _json(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "result": {
                            "isError": True,
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps(
                                        {"error": {"code": "UNKNOWN_TOOL", "message": "Okänt verktyg."}},
                                        ensure_ascii=False,
                                    ),
                                }
                            ],
                        },
                    }
                )
            api = state.api_for(with_brain=True)
            if name == "get_context":
                context = {"prompt": arguments["prompt"] if isinstance(arguments.get("prompt"), str) else ""}
                if isinstance(arguments.get("project"), str):
                    context["project"] = arguments["project"]
                result = await api.get_context(user_id, context)
            else:
                result = await api.save_brief(user_id, arguments if isinstance(arguments, dict) else {})
            return _json({"jsonrpc": "2.0", "id": request_id, "result": _tool_result(result)})
        return _json(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": "Method not found"},
            }
        )

    return app


def _tool_result(result: dict) -> dict:
    if "error" in result and result["error"]:
        return {
            "isError": True,
            "content": [{"type": "text", "text": json.dumps({"error": result["error"]}, ensure_ascii=False)}],
        }
    if "data" in result:
        return {"content": [{"type": "text", "text": json.dumps(result["data"], ensure_ascii=False)}]}
    return {
        "isError": True,
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {"error": {"code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}},
                    ensure_ascii=False,
                ),
            }
        ],
    }
