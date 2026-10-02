# BoringContext

Private memory for a language model. The model calls two MCP tools. The server decides what to store, which project it belongs to, and whether it is personal or shared.

## Tools

`tools/list` is only `get_context` and `save_memory`.

- `get_context` takes the user's full message (`prompt`, optional `project`). It returns ranked snippets and may save durable notes. `written` says where each note landed. It does not return `user_id` or the full text.
- `save_memory` takes a `brief` when the work is finished. The same subject (space, project, category, title) updates that row and keeps the previous text in history. An identical text does not change `updated_at`.

There is no MCP delete. The dashboard deletes. HTTP routes for update, lesson, and search remain; they are not MCP tools.

A note is personal unless the text explicitly asks for shared. Direct vector hits use similarity `0.35`. A neighbor of a direct hit uses `0.55`. If the embedding is missing or the embed call fails, retrieval stays on the lexical ranking.

Fields, lengths, and error codes are in [docs/contracts.md](docs/contracts.md).

## Run the API

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m boringcontext
```

The process listens on `http://127.0.0.1:8000`. `POST /api/mcp` speaks JSON-RPC. `GET /api/health` reports `mcp: 1.2.0`.

When `SUPABASE_URL` and an anon or publishable key are set, the process uses that project and the caller's own access token, so row security still sees the logged-in user. Without those variables it keeps an empty in-memory store. The service-role key is not read. Formulation and embeddings stay off unless their own keys are set; search then stays on the lexical ranking. Do not commit `.env` files or keys.

```bash
pytest
```

The tests stay offline.

## Dashboard

The globe and the rest of the interface stay in `apps/api` and `apps/dashboard`. That UI is React and a client-side canvas. Rewriting it in Python would change how it looks and how it moves, so it is unchanged. `npm` scripts in those apps are the way to open it. The Python package is the memory brain and the HTTP API with the same JSON.
