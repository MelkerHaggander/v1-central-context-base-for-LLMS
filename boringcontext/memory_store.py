import hashlib
import uuid
from datetime import datetime, timezone
from typing import Callable

from boringcontext.brain import cosine_similarity
from boringcontext.clock import to_iso


def content_fingerprint(content: str) -> str:
    return hashlib.md5(content.encode("utf-8")).hexdigest()


class InMemoryStore:
    def __init__(
        self,
        now: Callable[[], datetime] | None = None,
        new_id: Callable[[], str] | None = None,
    ) -> None:
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._new_id = new_id or (lambda: str(uuid.uuid4()))
        self._rows: list[dict] = []
        self._versions: list[dict] = []

    def _client(self, row: dict) -> dict:
        return {
            "id": row["id"],
            "project": row["project"],
            "category": row["category"],
            "title": row["title"],
            "content": row["content"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _same_key(self, row: dict, user_id: str, fields: dict) -> bool:
        return (
            row["user_id"] == user_id
            and row["project"] == fields["project"]
            and row["category"] == fields["category"]
            and row["title"] == fields["title"]
        )

    def _find(self, memory_id: str) -> dict | None:
        return next((row for row in self._rows if row["id"] == memory_id), None)

    def _write_version(self, row: dict, timestamp: str, changed_by: str, event: str, after: dict) -> None:
        previous = [version for version in self._versions if version["memory_id"] == row["id"]]
        self._versions.append(
            {
                "memory_id": row["id"],
                "version_number": len(previous) + 1,
                "space_id": row["space_id"],
                "changed_by": changed_by,
                "event": event,
                "project": row["project"],
                "category": row["category"],
                "title_before": row["title"],
                "title_after": after["title"],
                "content_before": row["content"],
                "content_after": after["content"],
                "source": row["source"],
                "created_at": timestamp,
            }
        )

    def _history(self, memory_id: str) -> list[dict]:
        history = [version for version in self._versions if version["memory_id"] == memory_id]
        history.sort(key=lambda version: version["version_number"], reverse=True)
        return history

    def _public_version(self, version: dict) -> dict:
        return {
            "version_number": version["version_number"],
            "memory_id": version["memory_id"],
            "space_id": version["space_id"],
            "changed_by": version["changed_by"],
            "event": version["event"],
            "project": version["project"],
            "category": version["category"],
            "title_before": version["title_before"],
            "title_after": version["title_after"],
            "content_before": version["content_before"],
            "content_after": version["content_after"],
            "source": version["source"],
            "created_at": version["created_at"],
        }

    async def insert(self, user_id: str, fields: dict) -> dict:
        if any(self._same_key(row, user_id, fields) for row in self._rows):
            return {"kind": "duplicate"}
        timestamp = to_iso(self._now())
        row = {
            "id": self._new_id(),
            "user_id": user_id,
            "space_id": None,
            "source": None,
            "embedding": None,
            "project": fields["project"],
            "category": fields["category"],
            "title": fields["title"],
            "content": fields["content"],
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        self._rows.append(row)
        return {"kind": "created", "row": self._client(row)}

    async def find_identical(self, user_id: str, fields: dict) -> dict | None:
        wanted = content_fingerprint(fields["content"])
        for row in self._rows:
            if self._same_key(row, user_id, fields) and content_fingerprint(row["content"]) == wanted:
                return self._client(row)
        return None

    def _apply_update(self, row: dict, fields: dict, changed_by: str) -> dict:
        unchanged = (
            row["project"] == fields["project"]
            and row["category"] == fields["category"]
            and row["title"] == fields["title"]
            and row["content"] == fields["content"]
        )
        if unchanged:
            return {"kind": "updated", "row": self._client(row)}
        timestamp = to_iso(self._now())
        text_changed = row["title"] != fields["title"] or row["content"] != fields["content"]
        # Every field change is a version. The row still holds the values before the change.
        self._write_version(
            row,
            timestamp,
            changed_by,
            "update",
            {"title": fields["title"], "content": fields["content"]},
        )
        row["project"] = fields["project"]
        row["category"] = fields["category"]
        row["title"] = fields["title"]
        row["content"] = fields["content"]
        row["updated_at"] = timestamp
        if text_changed:
            row["embedding"] = None
        return {"kind": "updated", "row": self._client(row)}

    async def update(self, user_id: str, memory_id: str, fields: dict) -> dict:
        row = next((candidate for candidate in self._rows if candidate["id"] == memory_id and candidate["user_id"] == user_id), None)
        if row is None:
            return {"kind": "missing"}
        if any(candidate["id"] != memory_id and self._same_key(candidate, user_id, fields) for candidate in self._rows):
            return {"kind": "failed", "code": "UPDATE_FAILED", "message": "Kunde inte uppdatera minnet."}
        return self._apply_update(row, fields, user_id)

    def _title_taken(self, space_id: str | None, project: str, title: str, except_id: str | None = None) -> bool:
        if not space_id:
            return False
        return any(
            candidate["space_id"] == space_id
            and candidate["project"] == project
            and candidate["title"] == title
            and candidate["id"] != except_id
            for candidate in self._rows
        )

    async def update_by_id(self, memory_id: str, fields: dict, changed_by: str) -> dict:
        row = self._find(memory_id)
        if row is None:
            return {"kind": "missing"}
        if self._title_taken(row["space_id"], fields["project"], fields["title"], memory_id):
            return {
                "kind": "failed",
                "code": "DUPLICATE_TITLE",
                "message": "A memory with that title already exists in this project.",
            }
        for candidate in self._rows:
            if candidate["id"] == memory_id:
                continue
            same_subject = (
                candidate["space_id"] == row["space_id"]
                and candidate["project"] == fields["project"]
                and candidate["category"] == fields["category"]
                and candidate["title"] == fields["title"]
            )
            same_owner = row["space_id"] is not None or candidate["user_id"] == row["user_id"]
            if same_subject and same_owner:
                return {"kind": "failed", "code": "UPDATE_FAILED", "message": "Kunde inte uppdatera minnet."}
        return self._apply_update(row, fields, changed_by)

    async def remove(self, user_id: str, memory_id: str) -> dict:
        index = next((i for i, row in enumerate(self._rows) if row["id"] == memory_id and row["user_id"] == user_id), -1)
        if index < 0:
            return {"kind": "missing"}
        removed = self._rows[index]
        self._write_version(removed, to_iso(self._now()), user_id, "delete", {"title": "", "content": ""})
        del self._rows[index]
        return {"kind": "deleted"}

    async def remove_by_id(self, memory_id: str, changed_by: str) -> dict:
        index = next((i for i, row in enumerate(self._rows) if row["id"] == memory_id), -1)
        if index < 0:
            return {"kind": "missing"}
        removed = self._rows[index]
        self._write_version(removed, to_iso(self._now()), changed_by, "delete", {"title": "", "content": ""})
        del self._rows[index]
        return {"kind": "deleted"}

    async def list_by_user(self, user_id: str) -> list[dict]:
        return [self._client(row) for row in self._rows if row["user_id"] == user_id]

    async def list_by_spaces(self, _user_id: str, space_ids: list[str]) -> list[dict]:
        allowed = set(space_ids)
        listed = []
        for row in self._rows:
            if row["space_id"] is not None and row["space_id"] in allowed:
                listed.append({**self._client(row), "source": row["source"], "created_by": row["user_id"]})
        return listed

    async def list_nearest(self, _user_id: str, embedding: list[float], space_ids: list[str], limit: int) -> list[dict]:
        allowed = set(space_ids)
        hits = []
        for row in self._rows:
            if not row["space_id"] or row["space_id"] not in allowed or not row["embedding"]:
                continue
            hits.append({"row": self._client(row), "similarity": cosine_similarity(embedding, row["embedding"])})
        hits.sort(key=lambda hit: hit["similarity"], reverse=True)
        return hits[:limit]

    async def list_neighbors(
        self,
        _user_id: str,
        seed_ids: list[str],
        space_ids: list[str],
        min_similarity: float,
        limit: int,
    ) -> list[dict]:
        allowed = set(space_ids)
        seeds = [row for row in self._rows if row["id"] in seed_ids and row["embedding"]]
        best: dict[str, dict] = {}
        for seed in seeds:
            for row in self._rows:
                if row["id"] == seed["id"] or not row["space_id"] or row["space_id"] not in allowed or not row["embedding"]:
                    continue
                similarity = cosine_similarity(seed["embedding"], row["embedding"])
                if similarity < min_similarity:
                    continue
                current = best.get(row["id"])
                if current is None or similarity > current["similarity"]:
                    best[row["id"]] = {"row": self._client(row), "similarity": similarity}
        hits = sorted(best.values(), key=lambda hit: hit["similarity"], reverse=True)
        return hits[:limit]

    async def list_identities(self, _user_id: str, space_ids: list[str], limit: int) -> list[dict]:
        allowed = set(space_ids)
        rows = [row for row in self._rows if row["space_id"] is not None and row["space_id"] in allowed]
        rows.sort(key=lambda row: row["updated_at"], reverse=True)
        return [
            {
                "project": row["project"],
                "category": row["category"],
                "title": row["title"],
                "updated_at": row["updated_at"],
            }
            for row in rows[:limit]
        ]

    def _subject_row(self, fields: dict) -> dict | None:
        for candidate in self._rows:
            if (
                candidate["space_id"] == fields["space_id"]
                and candidate["project"] == fields["project"]
                and candidate["category"] == fields["category"]
                and candidate["title"] == fields["title"]
            ):
                return candidate
        return None

    async def upsert_subject(self, user_id: str, fields: dict) -> dict:
        existing = self._subject_row(fields)
        if existing is not None:
            if existing["content"] == fields["content"]:
                return {"kind": "unchanged", "row": self._client(existing)}
            timestamp = to_iso(self._now())
            self._write_version(
                existing,
                timestamp,
                user_id,
                "update",
                {"title": existing["title"], "content": fields["content"]},
            )
            existing["content"] = fields["content"]
            existing["updated_at"] = timestamp
            existing["embedding"] = None
            return {"kind": "updated", "row": self._client(existing)}
        if self._title_taken(fields["space_id"], fields["project"], fields["title"]):
            return {
                "kind": "failed",
                "code": "DUPLICATE_TITLE",
                "message": "A memory with that title already exists in this project.",
            }
        timestamp = to_iso(self._now())
        row = {
            "id": self._new_id(),
            "user_id": user_id,
            "space_id": fields["space_id"],
            "source": fields["source"],
            "embedding": None,
            "project": fields["project"],
            "category": fields["category"],
            "title": fields["title"],
            "content": fields["content"],
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        self._rows.append(row)
        return {"kind": "created", "row": self._client(row)}

    async def set_embedding(self, memory_id: str, embedding: list[float] | None) -> None:
        row = self._find(memory_id)
        if row is None:
            return
        row["embedding"] = embedding

    async def has_embedding(self, memory_id: str) -> bool:
        row = self._find(memory_id)
        return bool(row and row["embedding"])

    async def list_versions(self, memory_id: str) -> list[dict] | None:
        history = self._history(memory_id)
        if self._find(memory_id) is None and not history:
            return None
        return [self._public_version(version) for version in history]

    async def space_of(self, memory_id: str) -> str | None:
        live = self._find(memory_id)
        if live is not None:
            return live["space_id"]
        history = self._history(memory_id)
        if not history:
            return None
        return history[0].get("space_id")

    def snapshot(self) -> list[dict]:
        return [
            {
                "id": row["id"],
                "user_id": row["user_id"],
                "space_id": row["space_id"],
                "source": row["source"],
                "project": row["project"],
                "category": row["category"],
                "title": row["title"],
                "content": row["content"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "embedding": list(row["embedding"]) if row["embedding"] else None,
            }
            for row in self._rows
        ]
