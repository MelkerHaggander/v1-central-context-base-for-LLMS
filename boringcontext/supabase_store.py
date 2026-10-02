from typing import Any

from boringcontext.clock import to_iso
from boringcontext.store import deletion_retention_cutoff

MEMORY_COLUMNS = "id, project, category, title, content, created_at, updated_at"
VERSION_COLUMNS = (
    "version_number, memory_id, space_id, changed_by, event, project, category, "
    "title_before, title_after, content_before, content_after, source, created_at"
)
MEMORY_WITH_META = f"{MEMORY_COLUMNS}, space_id, source, user_id"

# PostgREST rejects a JSON array cast onto vector(3072). The pgvector text
# literal is what the column accepts, including under the halfvec index.
def vector_literal(embedding: list[float]) -> str:
    parts = []
    for value in embedding:
        number = float(value)
        if number.is_integer():
            parts.append(str(int(number)))
        else:
            parts.append(format(number, "g"))
    return "[" + ",".join(parts) + "]"


def _embedding_present(value: Any) -> bool:
    if isinstance(value, list):
        return len(value) > 0
    return isinstance(value, str) and value.startswith("[") and value.endswith("]") and len(value) > 2


def _as_memory(row: dict) -> dict:
    return {
        "id": row["id"],
        "project": row["project"],
        "category": row["category"],
        "title": row["title"],
        "content": row["content"],
        "created_at": to_iso(row["created_at"]),
        "updated_at": to_iso(row["updated_at"]),
    }


def _as_listed(row: dict) -> dict:
    source = row.get("source") if row.get("source") in ("dashboard", "brain") else None
    listed = {**_as_memory(row), "source": source}
    created_by = row.get("user_id")
    if isinstance(created_by, str) and created_by:
        listed["created_by"] = created_by
    return listed


def _as_version(row: dict) -> dict:
    return {
        "version_number": row["version_number"],
        "memory_id": row["memory_id"],
        "space_id": row.get("space_id"),
        "changed_by": row["changed_by"],
        "event": row["event"],
        "project": row["project"],
        "category": row["category"],
        "title_before": row["title_before"],
        "title_after": row["title_after"],
        "content_before": row["content_before"],
        "content_after": row["content_after"],
        "source": row.get("source"),
        "created_at": to_iso(row["created_at"]),
    }


class SupabaseStore:
    def __init__(self, client: Any) -> None:
        self.client = client

    async def _next_version_number(self, memory_id: str) -> int:
        existing = await self.client.table("memory_versions").select("version_number").eq("memory_id", memory_id)
        if existing["error"]:
            return 1
        numbers = [row.get("version_number") or 0 for row in existing["data"] or []]
        return max([0, *numbers]) + 1

    async def _insert_version(self, before: dict, after: dict, changed_by: str, event: str) -> dict:
        version_number = await self._next_version_number(before["id"])
        inserted = await self.client.table("memory_versions").insert(
            {
                "memory_id": before["id"],
                "space_id": before.get("space_id"),
                "changed_by": changed_by,
                "event": event,
                "project": before["project"],
                "category": before["category"],
                "title_before": before["title"],
                "title_after": after["title"],
                "content_before": before["content"],
                "content_after": after["content"],
                "source": before.get("source"),
                "version_number": version_number,
            }
        )
        return {"error": inserted["error"]}

    async def insert(self, _user_id: str, fields: dict) -> dict:
        inserted = await self.client.table("memories").insert(fields).select(MEMORY_COLUMNS).single()
        if not inserted["error"] and inserted["data"]:
            return {"kind": "created", "row": _as_memory(inserted["data"])}
        code = (inserted["error"] or {}).get("code") if isinstance(inserted["error"], dict) else getattr(inserted["error"], "code", None)
        if code == "23505":
            return {"kind": "duplicate"}
        return {"kind": "failed", "code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}

    async def find_identical(self, _user_id: str, fields: dict) -> dict | None:
        existing = await (
            self.client.table("memories")
            .select(MEMORY_COLUMNS)
            .eq("project", fields["project"])
            .eq("category", fields["category"])
            .eq("title", fields["title"])
            .eq("content", fields["content"])
            .maybe_single()
        )
        return _as_memory(existing["data"]) if existing["data"] else None

    async def update(self, user_id: str, memory_id: str, fields: dict) -> dict:
        existing = await self.client.table("memories").select(MEMORY_WITH_META).eq("id", memory_id).maybe_single()
        if existing["error"]:
            return {"kind": "failed", "code": "UPDATE_FAILED", "message": "Kunde inte uppdatera minnet."}
        if not existing["data"]:
            return {"kind": "missing"}
        raw = existing["data"]
        current = _as_memory(raw)
        unchanged = (
            current["project"] == fields["project"]
            and current["category"] == fields["category"]
            and current["title"] == fields["title"]
            and current["content"] == fields["content"]
        )
        if unchanged:
            return {"kind": "updated", "row": current}
        space_id = raw.get("space_id")
        if space_id:
            clash = await (
                self.client.table("memories")
                .select("id")
                .eq("space_id", space_id)
                .eq("project", fields["project"])
                .eq("title", fields["title"])
                .neq("id", memory_id)
                .maybe_single()
            )
            if clash["error"]:
                return {"kind": "failed", "code": "UPDATE_FAILED", "message": "Kunde inte uppdatera minnet."}
            if clash["data"]:
                return {
                    "kind": "failed",
                    "code": "DUPLICATE_TITLE",
                    "message": "A memory with that title already exists in this project.",
                }
        versioned = await self._insert_version(
            raw,
            {"title": fields["title"], "content": fields["content"]},
            user_id,
            "update",
        )
        if versioned["error"]:
            return {"kind": "failed", "code": "UPDATE_FAILED", "message": "Kunde inte uppdatera minnet."}
        result = await self.client.table("memories").update(fields).eq("id", memory_id).select(MEMORY_COLUMNS).maybe_single()
        if result["error"]:
            return {"kind": "failed", "code": "UPDATE_FAILED", "message": "Kunde inte uppdatera minnet."}
        if not result["data"]:
            return {"kind": "missing"}
        return {"kind": "updated", "row": _as_memory(result["data"])}

    async def update_by_id(self, memory_id: str, fields: dict, changed_by: str) -> dict:
        return await self.update(changed_by, memory_id, fields)

    async def remove(self, user_id: str, memory_id: str) -> dict:
        existing = await self.client.table("memories").select(MEMORY_WITH_META).eq("id", memory_id).maybe_single()
        if not existing["error"] and existing["data"]:
            versioned = await self._insert_version(existing["data"], {"title": "", "content": ""}, user_id, "delete")
            if versioned["error"]:
                return {"kind": "failed", "code": "DELETE_FAILED", "message": "Kunde inte radera minnet."}
        result = await self.client.table("memories").delete().eq("id", memory_id).select("id").maybe_single()
        if result["error"]:
            return {"kind": "failed", "code": "DELETE_FAILED", "message": "Kunde inte radera minnet."}
        if not result["data"]:
            return {"kind": "missing"}
        return {"kind": "deleted"}

    async def remove_by_id(self, memory_id: str, changed_by: str) -> dict:
        return await self.remove(changed_by, memory_id)

    async def list_by_user(self, _user_id: str) -> list[dict]:
        result = await self.client.table("memories").select(MEMORY_COLUMNS)
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "select failed"))
        return [_as_memory(row) for row in result["data"] or []]

    async def list_by_spaces(self, _user_id: str, space_ids: list[str]) -> list[dict]:
        result = await self.client.table("memories").select(MEMORY_WITH_META).in_("space_id", space_ids)
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "select failed"))
        return [_as_listed(row) for row in result["data"] or []]

    async def list_nearest(self, _user_id: str, embedding: list[float], space_ids: list[str], limit: int) -> list[dict]:
        if not hasattr(self.client, "rpc"):
            raise RuntimeError("match_memories unavailable")
        result = await self.client.rpc(
            "match_memories",
            {"query_embedding": vector_literal(embedding), "space_ids": space_ids, "match_count": limit},
        )
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "rpc failed"))
        return [{"row": _as_memory(row), "similarity": float(row.get("similarity") or 0)} for row in result["data"] or []]

    async def list_neighbors(
        self,
        _user_id: str,
        seed_ids: list[str],
        space_ids: list[str],
        min_similarity: float,
        limit: int,
    ) -> list[dict]:
        if not hasattr(self.client, "rpc"):
            raise RuntimeError("match_memory_neighbors unavailable")
        result = await self.client.rpc(
            "match_memory_neighbors",
            {
                "seed_ids": seed_ids,
                "space_ids": space_ids,
                "min_similarity": min_similarity,
                "match_count": limit,
            },
        )
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "rpc failed"))
        return [{"row": _as_memory(row), "similarity": float(row.get("similarity") or 0)} for row in result["data"] or []]

    async def list_identities(self, _user_id: str, space_ids: list[str], limit: int) -> list[dict]:
        result = await (
            self.client.table("memories")
            .select("project, category, title, updated_at")
            .in_("space_id", space_ids)
            .order("updated_at", ascending=False)
            .limit(limit)
        )
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "select failed"))
        return [
            {
                "project": row["project"],
                "category": row["category"],
                "title": row["title"],
                "updated_at": to_iso(row["updated_at"]),
            }
            for row in result["data"] or []
        ]

    async def upsert_subject(self, user_id: str, fields: dict) -> dict:
        existing = await (
            self.client.table("memories")
            .select(MEMORY_WITH_META)
            .eq("space_id", fields["space_id"])
            .eq("project", fields["project"])
            .eq("category", fields["category"])
            .eq("title", fields["title"])
            .maybe_single()
        )
        if existing["error"]:
            return {"kind": "failed", "code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}
        if existing["data"]:
            current = _as_memory(existing["data"])
            if current["content"] == fields["content"]:
                return {"kind": "unchanged", "row": current}
            versioned = await self._insert_version(
                {
                    **current,
                    "space_id": existing["data"].get("space_id") or fields["space_id"],
                    "source": existing["data"].get("source"),
                },
                {"title": current["title"], "content": fields["content"]},
                user_id,
                "update",
            )
            if versioned["error"]:
                return {"kind": "failed", "code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}
            updated = await (
                self.client.table("memories")
                .update({"content": fields["content"]})
                .eq("id", current["id"])
                .select(MEMORY_COLUMNS)
                .maybe_single()
            )
            if updated["error"] or not updated["data"]:
                return {"kind": "failed", "code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}
            return {"kind": "updated", "row": _as_memory(updated["data"])}
        same_title = await (
            self.client.table("memories")
            .select("id")
            .eq("space_id", fields["space_id"])
            .eq("project", fields["project"])
            .eq("title", fields["title"])
            .maybe_single()
        )
        if same_title["error"]:
            return {"kind": "failed", "code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}
        if same_title["data"]:
            return {
                "kind": "failed",
                "code": "DUPLICATE_TITLE",
                "message": "A memory with that title already exists in this project.",
            }
        inserted = await (
            self.client.table("memories")
            .insert(
                {
                    "user_id": user_id,
                    "space_id": fields["space_id"],
                    "project": fields["project"],
                    "category": fields["category"],
                    "title": fields["title"],
                    "content": fields["content"],
                    "source": fields["source"],
                }
            )
            .select(MEMORY_COLUMNS)
            .single()
        )
        error = inserted["error"]
        code = error.get("code") if isinstance(error, dict) else None
        if code == "23505":
            return {
                "kind": "failed",
                "code": "DUPLICATE_TITLE",
                "message": "A memory with that title already exists in this project.",
            }
        if error or not inserted["data"]:
            return {"kind": "failed", "code": "SAVE_FAILED", "message": "Kunde inte spara minnet."}
        created = _as_memory(inserted["data"])
        created["source"] = fields["source"]
        created["created_by"] = user_id
        return {"kind": "created", "row": created}

    async def set_embedding(self, memory_id: str, embedding: list[float] | None) -> None:
        if not embedding:
            raise RuntimeError("embedding was not stored")
        result = await self.client.table("memories").update({"embedding": vector_literal(embedding)}).eq("id", memory_id).select("id")
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "embedding was not stored"))
        stored = result["data"]
        if not stored:
            raise RuntimeError("embedding was not stored")

    async def has_embedding(self, memory_id: str) -> bool:
        result = await self.client.table("memories").select("embedding").eq("id", memory_id).maybe_single()
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "select failed"))
        embedding = (result["data"] or {}).get("embedding") if result["data"] else None
        return _embedding_present(embedding)

    async def list_deletions(self, space_id: str) -> list[dict]:
        # The SQL cutoff only shrinks the transfer. keep_recent_deletions is the rule.
        result = await (
            self.client.table("memory_versions")
            .select(VERSION_COLUMNS)
            .eq("space_id", space_id)
            .eq("event", "delete")
            .gte("created_at", deletion_retention_cutoff())
            .order("created_at", ascending=False)
        )
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "select failed"))
        return [_as_version(row) for row in result["data"] or []]

    async def list_versions(self, memory_id: str) -> list[dict]:
        result = await (
            self.client.table("memory_versions")
            .select(VERSION_COLUMNS)
            .eq("memory_id", memory_id)
            .order("version_number", ascending=False)
        )
        if result["error"]:
            raise RuntimeError(result["error"].get("message", "select failed"))
        return [_as_version(row) for row in result["data"] or []]

    async def space_of(self, memory_id: str) -> str | None:
        result = await self.client.table("memories").select("space_id").eq("id", memory_id).maybe_single()
        if not result["error"] and result["data"]:
            return result["data"].get("space_id")
        history = await self.client.table("memory_versions").select("space_id, version_number").eq("memory_id", memory_id)
        if history["error"] or not history["data"]:
            return None
        latest = sorted(history["data"], key=lambda row: row.get("version_number") or 0, reverse=True)[0]
        return latest.get("space_id")
