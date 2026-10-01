import pytest

from boringcontext.store import save_dashboard_memory
from boringcontext.supabase_store import SupabaseStore, vector_literal

USER = "user-a"
SPACE = "11111111-1111-4111-8111-111111111111"
NOW = "2026-09-29T10:25:00Z"


class Query:
    def __init__(self, client, table: str):
        self.client = client
        self.table = table
        self.op = "select"
        self.payload = None
        self.filters = []

    def insert(self, fields):
        self.op = "insert"
        self.payload = fields
        return self

    def update(self, fields):
        self.op = "update"
        self.payload = fields
        return self

    def select(self, _columns=None):
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column, value):
        self.filters.append(("in", column, value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def _matches(self, row):
        for op, column, value in self.filters:
            if op == "in":
                if row.get(column) not in value:
                    return False
            elif row.get(column) != value:
                return False
        return True

    def _run(self, mode: str):
        if self.table == "memory_versions":
            return self._versions(mode)
        return self._memories(mode)

    def _versions(self, mode: str):
        if self.op == "insert":
            fields = self.payload or {}
            self.client.versions.append({
                "memory_id": str(fields["memory_id"]),
                "space_id": fields.get("space_id"),
                "changed_by": str(fields["changed_by"]),
                "event": str(fields["event"]),
                "project": str(fields["project"]),
                "category": str(fields["category"]),
                "title_before": str(fields["title_before"]),
                "title_after": str(fields["title_after"]),
                "content_before": str(fields["content_before"]),
                "content_after": str(fields["content_after"]),
                "source": fields.get("source"),
                "version_number": int(fields["version_number"]),
            })
            return {"data": None, "error": None}
        rows = [row for row in self.client.versions if self._matches(row)]
        if mode == "many":
            return {"data": rows, "error": None}
        return {"data": rows[0] if rows else None, "error": None}

    def _memories(self, mode: str):
        if self.op == "insert":
            fields = self.payload or {}
            row = {
                "id": f"mem-{self.client.next}",
                "user_id": str(fields["user_id"]),
                "space_id": str(fields["space_id"]),
                "project": str(fields["project"]),
                "category": str(fields["category"]),
                "title": str(fields["title"]),
                "content": str(fields["content"]),
                "source": fields.get("source"),
                "embedding": None,
                "created_at": NOW,
                "updated_at": NOW,
            }
            self.client.next += 1
            self.client.memories.append(row)
            return {"data": row, "error": None}
        rows = [row for row in self.client.memories if self._matches(row)]
        if self.op == "update":
            fields = self.payload or {}
            if "embedding" in fields and isinstance(fields["embedding"], list):
                return {"data": None, "error": {"message": "cannot cast jsonb to vector"}}
            if not rows:
                return {"data": [] if mode == "many" else None, "error": None}
            for row in rows:
                if isinstance(fields.get("content"), str):
                    row["content"] = fields["content"]
                if isinstance(fields.get("embedding"), str):
                    row["embedding"] = fields["embedding"]
                row["updated_at"] = NOW
            if mode == "many":
                return {"data": [{"id": row["id"]} for row in rows], "error": None}
            return {"data": rows[0], "error": None}
        if mode == "many":
            return {"data": rows, "error": None}
        if mode == "maybe" and len(rows) > 1:
            return {"data": None, "error": {"message": "multiple rows"}}
        return {"data": rows[0] if rows else None, "error": None}

    async def maybe_single(self):
        return self._run("maybe")

    async def single(self):
        return self._run("single")

    def __await__(self):
        async def _finish():
            return self._run("many")

        return _finish().__await__()


class Client:
    def __init__(self):
        self.memories = []
        self.versions = []
        self.next = 1

    def table(self, name: str):
        if name not in {"memories", "memory_versions"}:
            raise RuntimeError(f"unexpected table {name}")
        return Query(self, name)


class Spaces:
    async def readable_space_ids(self):
        return [SPACE]

    async def space_for(self, *_args):
        return SPACE

    async def is_member(self, *_args):
        return True


class Embedding:
    dimensions = 3

    async def embed(self, _text):
        return [1, 0, 0]


class Brain:
    spaces = Spaces()
    embedding = Embedding()
    formulator = None


def test_vector_literal_is_pgvector_text():
    assert vector_literal([1, 0, 0.5]) == "[1,0,0.5]"


@pytest.mark.asyncio
async def test_dashboard_save_stores_embedding_text_and_history():
    client = Client()
    store = SupabaseStore(client)
    created = await save_dashboard_memory(
        USER,
        {"project": "Projekt A", "category": "fact", "title": "Alfredo v1.2 personal", "content": "Dashboard personal works"},
        SPACE,
        store,
        Brain(),
    )
    updated = await save_dashboard_memory(
        USER,
        {"project": "Projekt A", "category": "fact", "title": "Alfredo v1.2 personal", "content": "Dashboard personal updated"},
        SPACE,
        store,
        Brain(),
    )
    assert updated["data"]["id"] == created["data"]["id"]
    live = [row for row in client.memories if row["title"] == "Alfredo v1.2 personal"]
    assert len(live) == 1
    assert live[0]["content"] == "Dashboard personal updated"
    assert live[0]["embedding"] == "[1,0,0]"
    history = [row for row in client.versions if row["memory_id"] == created["data"]["id"]]
    assert len(history) == 1
    assert history[0]["content_before"] == "Dashboard personal works"
    assert history[0]["content_after"] == "Dashboard personal updated"
    assert history[0]["event"] == "update"
