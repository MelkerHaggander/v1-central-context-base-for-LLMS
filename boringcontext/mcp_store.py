"""Memory reads and writes keyed by the opaque MCP access token.

The Supabase user JWT is not required, so a chat can keep calling get_context
and save_memory after that JWT has expired. The SQL functions check p_access.
"""

from __future__ import annotations

from typing import Any

from boringcontext.clock import to_iso
from boringcontext.postgrest import PostgrestClient, access_token
from boringcontext.supabase_store import vector_literal


def _memory(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    if not all(isinstance(row.get(key), str) and row.get(key) for key in ("id", "project", "category", "title", "content")):
        return None
    try:
        created_at = to_iso(row["created_at"])
        updated_at = to_iso(row["updated_at"])
    except Exception:
        return None
    memory = {
        "id": row["id"],
        "project": row["project"],
        "category": row["category"],
        "title": row["title"],
        "content": row["content"],
        "created_at": created_at,
        "updated_at": updated_at,
    }
    if "source" in row:
        memory["source"] = row["source"] if row["source"] in ("dashboard", "brain") else None
    return memory


class McpRpcStore:
    def __init__(self, client: PostgrestClient, mcp_access: str) -> None:
        self.client = client
        self.mcp_access = mcp_access

    async def _rpc(self, fn: str, args: dict) -> dict:
        marker = access_token.set(None)
        try:
            return await self.client.rpc(fn, {"p_access": self.mcp_access, **args})
        finally:
            access_token.reset(marker)

    async def list_by_user(self, _user_id: str) -> list[dict]:
        result = await self._rpc("mcp_list_memories", {})
        if result["error"] or result["data"] is None:
            raise RuntimeError((result["error"] or {}).get("message") or "mcp_list_memories failed")
        return [row for row in (_memory(item) for item in result["data"]) if row]

    async def list_by_spaces(self, _user_id: str, space_ids: list[str]) -> list[dict]:
        result = await self._rpc("mcp_list_by_spaces", {"p_space_ids": space_ids})
        if result["error"] or result["data"] is None:
            raise RuntimeError((result["error"] or {}).get("message") or "mcp_list_by_spaces failed")
        return [row for row in (_memory(item) for item in result["data"]) if row]

    async def list_nearest(self, _user_id: str, embedding: list[float], space_ids: list[str], limit: int) -> list[dict]:
        result = await self._rpc(
            "mcp_list_nearest",
            {
                "p_query_embedding": vector_literal(embedding),
                "p_space_ids": space_ids,
                "p_match_count": limit,
            },
        )
        if result["error"] or result["data"] is None:
            raise RuntimeError((result["error"] or {}).get("message") or "mcp_list_nearest failed")
        hits = []
        for item in result["data"]:
            row = _memory(item)
            if row is None:
                continue
            hits.append({"row": row, "similarity": float(item.get("similarity") or 0)})
        return hits

    async def list_neighbors(
        self,
        _user_id: str,
        seed_ids: list[str],
        space_ids: list[str],
        min_similarity: float,
        limit: int,
    ) -> list[dict]:
        result = await self._rpc(
            "mcp_list_neighbors",
            {
                "p_seed_ids": seed_ids,
                "p_space_ids": space_ids,
                "p_min_similarity": min_similarity,
                "p_match_count": limit,
            },
        )
        if result["error"] or result["data"] is None:
            raise RuntimeError((result["error"] or {}).get("message") or "mcp_list_neighbors failed")
        hits = []
        for item in result["data"]:
            row = _memory(item)
            if row is None:
                continue
            hits.append({"row": row, "similarity": float(item.get("similarity") or 0)})
        return hits

    async def list_identities(self, _user_id: str, space_ids: list[str], limit: int) -> list[dict]:
        result = await self._rpc("mcp_list_identities", {"p_space_ids": space_ids, "p_limit": limit})
        if result["error"] or result["data"] is None:
            raise RuntimeError((result["error"] or {}).get("message") or "mcp_list_identities failed")
        identities = []
        for item in result["data"]:
            if not isinstance(item, dict):
                continue
            try:
                updated_at = to_iso(item["updated_at"])
            except Exception:
                continue
            if not all(isinstance(item.get(key), str) for key in ("project", "category", "title")):
                continue
            identities.append(
                {
                    "project": item["project"],
                    "category": item["category"],
                    "title": item["title"],
                    "updated_at": updated_at,
                }
            )
        return identities

    async def upsert_subject(self, _user_id: str, fields: dict) -> dict:
        result = await self._rpc(
            "mcp_upsert_subject",
            {
                "p_space_id": fields["space_id"],
                "p_project": fields["project"],
                "p_category": fields["category"],
                "p_title": fields["title"],
                "p_content": fields["content"],
                "p_source": fields["source"],
            },
        )
        if result["error"] or not isinstance(result["data"], dict):
            return {"kind": "failed", "code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}
        body = result["data"]
        row = _memory(body.get("row") or {})
        if body.get("kind") in ("created", "updated", "unchanged") and row:
            return {"kind": body["kind"], "row": row}
        if body.get("kind") == "duplicate_title":
            return {
                "kind": "failed",
                "code": "DUPLICATE_TITLE",
                "message": "A memory with that title already exists in this project.",
            }
        return {"kind": "failed", "code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}

    async def set_embedding(self, memory_id: str, embedding: list[float] | None) -> None:
        if not embedding:
            raise RuntimeError("embedding was not stored")
        result = await self._rpc(
            "mcp_set_embedding",
            {"p_id": memory_id, "p_embedding": vector_literal(embedding)},
        )
        if result["error"]:
            raise RuntimeError(result["error"].get("message") or "embedding was not stored")

    async def has_embedding(self, memory_id: str) -> bool:
        result = await self._rpc("mcp_has_embedding", {"p_id": memory_id})
        if result["error"]:
            raise RuntimeError(result["error"].get("message") or "mcp_has_embedding failed")
        return result["data"] is True

    async def list_versions(self, memory_id: str) -> list[dict]:
        result = await self._rpc("mcp_list_versions", {"p_id": memory_id})
        if result["error"] or result["data"] is None:
            raise RuntimeError((result["error"] or {}).get("message") or "mcp_list_versions failed")
        versions = []
        for item in result["data"]:
            if not isinstance(item, dict):
                continue
            try:
                created_at = to_iso(item["created_at"])
            except Exception:
                continue
            versions.append({**item, "created_at": created_at})
        return versions

    async def space_of(self, memory_id: str) -> str | None:
        result = await self._rpc("mcp_space_of", {"p_id": memory_id})
        if result["error"]:
            raise RuntimeError(result["error"].get("message") or "mcp_space_of failed")
        return result["data"] if isinstance(result["data"], str) else None
