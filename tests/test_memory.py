import re
from datetime import datetime, timedelta, timezone

import pytest

from boringcontext.brain import DIRECT_SIMILARITY, NEIGHBOR_SIMILARITY, cosine_similarity
from boringcontext.clock import to_iso
from boringcontext.memory_store import InMemoryStore, content_fingerprint
from boringcontext.store import (
    CONTEXT_ITEM_LIMIT,
    CONTEXT_JSON_LIMIT,
    CONTEXT_SNIPPET_LIMIT,
    PAGE_SIZE,
    clean_search_query,
    create_memory_api,
    extract_keywords,
)
from boringcontext.jsonutil import js_json
from boringcontext.validate import validate_memory_id, validate_memory_input, validate_search_input

USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-000000000010"
SHARED = "aaaaaaaa-aaaa-4aaa-8aaa-000000000011"
OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-000000000012"
DEADLINE = {
    "project": "Projekt A",
    "category": "deadline",
    "title": "Lanseringsdatum",
    "content": "Vi lanserar 15 oktober 2026.",
}
DECISION = {
    "project": "Projekt A",
    "category": "decision",
    "title": "Stack för V1",
    "content": "V1 kör TypeScript på Vercel och Supabase. Ingen Python-worker.",
}
FACT = {
    "project": "Projekt A",
    "category": "fact",
    "title": "Tre testkonton",
    "content": "Det finns tre förskapade konton. Ingen offentlig registrering.",
}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def ticking(start: str = "2026-09-10T12:00:00Z", step: float = 1):
    state = {"tick": datetime.fromisoformat(start.replace("Z", "+00:00"))}

    def now():
        current = state["tick"]
        state["tick"] = current + timedelta(seconds=step)
        return current

    return now


class Spaces:
    def __init__(self, user_id: str, readable: list[str] | None = None):
        self.user_id = user_id
        self.readable = readable or [PERSONAL, SHARED]

    async def readable_space_ids(self, user_id: str):
        return self.readable if user_id == self.user_id else []

    async def space_for(self, user_id: str, kind: str):
        if user_id != self.user_id:
            return None
        if kind == "shared":
            return SHARED if SHARED in self.readable else None
        return PERSONAL if PERSONAL in self.readable else None

    async def is_member(self, user_id: str, space_id: str):
        return user_id == self.user_id and space_id in self.readable

    async def list_spaces(self, user_id: str):
        if user_id != self.user_id:
            return []
        listed = []
        if PERSONAL in self.readable:
            listed.append({"id": PERSONAL, "kind": "personal"})
        if SHARED in self.readable:
            listed.append({"id": SHARED, "kind": "shared", "name": "Boring"})
        return listed


class Brain:
    def __init__(self, spaces=None, embedding=None, formulator=None):
        self.spaces = spaces
        self.embedding = embedding
        self.formulator = formulator


class Embed:
    def __init__(self, mapper):
        self.mapper = mapper
        self.dimensions = 3
        self.calls = []

    async def embed(self, text: str):
        self.calls.append(text)
        return self.mapper(text)


class Formulator:
    def __init__(self, fn):
        self.fn = fn

    async def formulate(self, payload):
        return await self.fn(payload)


class Override:
    def __init__(self, base, **methods):
        self._base = base
        self._methods = methods

    def __getattr__(self, name):
        if name in self._methods:
            return self._methods[name]
        return getattr(self._base, name)


def test_validation_order_and_trim():
    bad = validate_memory_input({"project": "Projekt A", "category": "nope", "title": "Lanseringsdatum", "content": "Vi lanserar 15 oktober 2026."})
    assert bad["error"]["code"] == "INVALID_CATEGORY"
    assert "data" not in bad
    ok = validate_memory_input({"project": "  Projekt A  ", "category": " deadline ", "title": "  Lanseringsdatum  ", "content": "  Vi lanserar 15 oktober 2026.  "})
    assert ok["data"]["title"] == "Lanseringsdatum"
    blank = validate_memory_input({"project": "Projekt A", "category": "deadline", "title": "   ", "content": "x"})
    assert blank["error"]["code"] == "INVALID_TITLE"
    empty = validate_memory_input({"project": "", "category": "nope", "title": "", "content": ""})
    assert empty["error"]["code"] == "INVALID_TITLE"
    assert validate_memory_input({"project": "Projekt A", "category": "nope", "title": "", "content": ""})["error"]["code"] == "INVALID_TITLE"
    assert validate_memory_input({"project": "Projekt A", "category": "nope", "title": "Lanseringsdatum", "content": ""})["error"]["code"] == "INVALID_CONTENT"
    assert validate_memory_id("not-an-id")["error"]["code"] == "INVALID_ID"
    assert validate_memory_id("00000000-0000-0000-0000-000000000000")["error"]["code"] == "INVALID_ID"
    assert validate_search_input({"offset": 1.5})["error"]["code"] == "INVALID_OFFSET"
    blank_query = validate_search_input({"query": "   "})
    assert "query" not in blank_query["data"]
    assert validate_memory_input({"project": "x" * 101, "category": "fact", "title": "t", "content": "c"})["error"]["code"] == "INVALID_PROJECT"


def test_to_iso_drops_milliseconds():
    assert to_iso("2026-09-10T12:00:00.123Z") == "2026-09-10T12:00:00Z"
    assert to_iso(datetime(2026, 9, 10, 12, 0, 0, 987000, tzinfo=timezone.utc)) == "2026-09-10T12:00:00Z"


def test_clean_search_query():
    assert clean_search_query("%oktober%") == "oktober"
    assert clean_search_query("foo%bar") == "foo bar"
    assert clean_search_query("a_b,c(d)e") == "a b c d e"


@pytest.mark.asyncio
async def test_save_search_update_and_isolation():
    memory = create_memory_api(InMemoryStore(now=ticking()))
    first = await memory.save_memory(USER_A, DEADLINE)
    assert UUID_RE.match(first["data"]["id"])
    assert first["data"]["created_at"].endswith("Z")
    assert "user_id" not in first["data"]
    second = await memory.save_memory(USER_A, {**DEADLINE, "title": "  Lanseringsdatum  ", "content": "  Vi lanserar 15 oktober 2026.  "})
    assert second["data"]["id"] == first["data"]["id"]
    assert second["data"]["updated_at"] == first["data"]["updated_at"]
    await memory.save_memory(USER_A, DECISION)
    found = await memory.search_memory(USER_A, {"query": "Oktober"})
    assert [row["title"] for row in found["data"]] == ["Lanseringsdatum"]
    assert (await memory.search_memory(USER_A, {"project": "Projekt a"}))["data"] == []
    assert (await memory.search_memory(USER_B, {}))["data"] == []
    missing = await memory.update_memory(USER_B, {"id": first["data"]["id"], **DEADLINE, "content": "Vi lanserar 22 oktober 2026."})
    unknown = await memory.update_memory(USER_B, {"id": "550e8400-e29b-41d4-a716-446655440000", **DEADLINE})
    assert missing["error"]["code"] == "NOT_FOUND"
    assert unknown["error"] == missing["error"]
    updated = await memory.update_memory(USER_A, {"id": first["data"]["id"], **DEADLINE, "content": "Vi lanserar 22 oktober 2026."})
    assert updated["data"]["id"] == first["data"]["id"]
    assert updated["data"]["created_at"] == first["data"]["created_at"]
    assert updated["data"]["updated_at"] > first["data"]["updated_at"]
    same = await memory.update_memory(USER_A, {"id": first["data"]["id"], **DEADLINE, "content": "Vi lanserar 22 oktober 2026."})
    assert same["data"]["updated_at"] == updated["data"]["updated_at"]
    rejected = await memory.update_memory(USER_A, {"id": first["data"]["id"], **DEADLINE, "content": "Vi lanserar 22 oktober 2026.", "project": "Projekt B"})
    assert rejected["error"]["code"] == "PROJECT_CHANGE_REQUIRES_FLAG"
    lesson = await memory.save_lesson(USER_A, {"project": "Projekt A", "title": "Rätta category till gemener", "content": "Ogiltig category ska rättas till gemener."})
    assert lesson["data"]["category"] == "lesson"
    blocked = await memory.update_memory(USER_A, {"id": (await memory.save_memory(USER_A, FACT))["data"]["id"], **FACT, "category": "lesson"})
    assert blocked["error"]["code"] == "LESSON_CATEGORY_REQUIRES_TOOL"
    deleted = await memory.delete_memory(USER_B, first["data"]["id"])
    assert deleted["error"]["code"] == "NOT_FOUND"
    assert (await memory.delete_memory(USER_A, "inte-uuid"))["error"]["code"] == "INVALID_ID"


@pytest.mark.asyncio
async def test_same_subject_upserts_content_and_page_size():
    memory = create_memory_api(InMemoryStore(now=ticking()))
    first = await memory.save_memory(USER_A, {"project": "Kaffekvarnen", "category": "goal", "title": "Användarmål", "content": "Målet är 1000 användare."})
    second = await memory.save_memory(USER_A, {"project": "Kaffekvarnen", "category": "goal", "title": "Användarmål", "content": "Målet är 2000 användare."})
    assert second["data"]["id"] == first["data"]["id"]
    assert second["data"]["updated_at"] > first["data"]["updated_at"]
    listed = await memory.search_memory(USER_A, {"project": "Kaffekvarnen"})
    assert len(listed["data"]) == 1
    assert listed["data"][0]["content"] == "Målet är 2000 användare."
    assert content_fingerprint(DEADLINE["content"]) != content_fingerprint("Vi lanserar 22 oktober 2026.")
    wide = create_memory_api(InMemoryStore(now=ticking()))
    for index in range(PAGE_SIZE + 1):
        assert "data" in await wide.save_memory(USER_A, {"project": "Projekt A", "category": "fact", "title": f"Rad {index}", "content": f"Innehåll {index}"})
    page = await wide.search_memory(USER_A, {})
    assert len(page["data"]) == PAGE_SIZE
    assert page["data"][0]["title"] == f"Rad {PAGE_SIZE}"
    rest = await wide.search_memory(USER_A, {"offset": 1})
    assert rest["data"][0]["title"] == f"Rad {PAGE_SIZE - 1}"


@pytest.mark.asyncio
async def test_specials_only_query_does_not_filter():
    memory = create_memory_api(InMemoryStore())
    await memory.save_memory(USER_A, DEADLINE)
    await memory.save_memory(USER_A, DECISION)
    found = await memory.search_memory(USER_A, {"query": "%_(), "})
    assert len(found["data"]) == 2


@pytest.mark.asyncio
async def test_store_failures_keep_error_codes():
    async def boom(*_args):
        raise RuntimeError("boom")

    search = create_memory_api(Override(InMemoryStore(), list_by_user=boom))
    assert (await search.search_memory(USER_A, {}))["error"]["code"] == "SEARCH_FAILED"
    assert (await search.get_context(USER_A, {"prompt": "raketmotor"}))["error"]["code"] == "SEARCH_FAILED"

    async def duplicate(*_args):
        return {"kind": "duplicate"}

    async def missing_identical(*_args):
        return None

    async def missing_update(*_args):
        return {"kind": "missing"}

    async def no_rows(*_args):
        return []

    failed = create_memory_api(Override(InMemoryStore(), insert=duplicate, find_identical=missing_identical, update=missing_update, list_by_user=no_rows))
    assert (await failed.save_memory(USER_A, DEADLINE))["error"]["code"] == "SAVE_FAILED"


def test_extract_keywords_drops_stop_words():
    assert extract_keywords("När ska vi lansera projektet?") == ["lansera", "projektet"]
    keywords = extract_keywords("Hur skall jag söka kort sedan, och vilken väg får mig rätt?")
    for stopword in ["hur", "skall", "kort", "sedan", "vilken", "får", "mig"]:
        assert stopword not in keywords


@pytest.mark.asyncio
async def test_lexical_ranking_stemming_and_snippet():
    memory = create_memory_api(InMemoryStore(now=ticking()))
    await memory.save_memory(USER_A, {"project": "Projekt A", "category": "fact", "title": "Raketmotor", "content": "Titelträffen ska vinna."})
    await memory.save_memory(USER_A, {"project": "Projekt A", "category": "fact", "title": "Nyare anteckning", "content": "Vi diskuterade en raketmotor."})
    await memory.save_memory(USER_A, {"project": "Projekt A", "category": "fact", "title": "Orelaterat", "content": "Det här handlar om något annat."})
    ranked = await memory.get_context(USER_A, {"prompt": "Berätta om vår raketmotor"})
    assert [item["title"] for item in ranked["data"]["items"]] == ["Raketmotor", "Nyare anteckning"]

    filtered = await memory.get_context(USER_A, {"prompt": "raketmotor", "project": "projekt a"})
    assert filtered["data"]["items"][0]["project"] == "Projekt A"
    assert "projects" not in filtered["data"]

    stemmed = create_memory_api(InMemoryStore())
    await stemmed.save_memory(USER_A, {"project": "MCP-TEST", "category": "deadline", "title": "Lanseringsdatum", "content": "Vi lanserar 15 oktober 2026."})
    hit = await stemmed.get_context(USER_A, {"prompt": "Vad är lanseringsdatumet?"})
    assert [item["title"] for item in hit["data"]["items"]] == ["Lanseringsdatum"]
    empty = await stemmed.get_context(USER_A, {"prompt": "Hur skall jag söka kort sedan?"})
    assert empty["data"]["items"] == []

    snippet_api = create_memory_api(InMemoryStore())
    await snippet_api.save_memory(USER_A, {"project": "MCP-TEST", "category": "fact", "title": "Drift", "content": f"{'prefixword ' * 40}Backup körs varje natt klockan 02."})
    window = await snippet_api.get_context(USER_A, {"prompt": "Hur fungerar backup?"})
    value = window["data"]["items"][0]["snippet"]
    assert "Backup körs varje natt" in value
    assert value.startswith("…")
    assert len(value) <= CONTEXT_SNIPPET_LIMIT

    escaped = await snippet_api.save_memory(USER_A, {"project": "MCP-TEST", "category": "fact", "title": "Backup HTML", "content": "<script>alert('x')</script> & backup körs varje natt."})
    marked = await snippet_api.get_context(USER_A, {"prompt": "backup html"})
    item = marked["data"]["items"][0]
    assert item["source"] == "user_memory"
    assert item["updated_at"] == escaped["data"]["updated_at"]
    assert "&lt;script>" in item["snippet"]
    assert "&amp; backup" in item["snippet"]
    assert "<script>" not in item["snippet"]

    leaf = create_memory_api(InMemoryStore())
    await leaf.save_memory(USER_A, {"project": "MCP-TEST", "category": "fact", "title": "Lagerblad", "content": "Lagerbladet är grönt."})
    await leaf.save_memory(USER_A, {"project": "MCP-TEST", "category": "fact", "title": "Lagerstyrning", "content": "Lagerstyrning körs automatiskt."})
    leaves = await leaf.get_context(USER_A, {"prompt": "lagerblad"})
    assert [item["title"] for item in leaves["data"]["items"]] == ["Lagerblad"]

    launch = create_memory_api(InMemoryStore())
    await launch.save_memory(USER_A, {"project": "MCP-TEST", "category": "deadline", "title": "Lansering", "content": "Lansering sker i oktober."})
    await launch.save_memory(USER_A, {"project": "MCP-TEST", "category": "deadline", "title": "Budgetdatum", "content": "Budgeten fastställs i oktober."})
    launched = await launch.get_context(USER_A, {"prompt": "launch date"})
    assert launched["data"]["keywords"] == ["launch"]
    assert [item["title"] for item in launched["data"]["items"]] == ["Lansering"]

    for prompt in ["", "   ", "a" * 8001]:
        assert (await launch.get_context(USER_A, {"prompt": prompt}))["error"]["code"] == "INVALID_PROMPT"
    assert (await launch.get_context(USER_B, {"prompt": "launch"}))["data"]["items"] == []


@pytest.mark.asyncio
async def test_category_intent_numbers_and_budget():
    memory = create_memory_api(InMemoryStore())
    await memory.save_memory(USER_A, {"project": "MCP-TEST", "category": "deadline", "title": "Lansering", "content": "Lansering sker 5 november."})
    await memory.save_memory(USER_A, {"project": "MCP-TEST", "category": "fact", "title": "Databas", "content": "PostgreSQL används."})
    for prompt in ["Vilka deadlines har jag framför mig?", "Vad är på gång?"]:
        result = await memory.get_context(USER_A, {"prompt": prompt})
        assert [item["category"] for item in result["data"]["items"]] == ["deadline"]
    assert extract_keywords("Vad händer 5 november?") == ["händer", "5", "november"]
    await memory.save_memory(USER_A, {"project": "MCP-TEST", "category": "deadline", "title": "Första leverans", "content": "Första leveransen sker 5 november."})
    await memory.save_memory(USER_A, {"project": "MCP-TEST", "category": "deadline", "title": "Andra leverans", "content": "Andra leveransen sker 12 november."})
    dated = await memory.get_context(USER_A, {"prompt": "När är leveransen 5 november?"})
    assert dated["data"]["items"][0]["title"] == "Första leverans"

    packed = create_memory_api(InMemoryStore(now=ticking()))
    for index in range(CONTEXT_ITEM_LIMIT + 2):
        await packed.save_memory(USER_A, {"project": "Projekt A", "category": "fact", "title": f"Gemensam träff {index}", "content": f"Gemensam {'lång text ' * 120}"})
    budget = await packed.get_context(USER_A, {"prompt": "gemensam"})
    assert budget["data"]["items"]
    assert all(len(item["snippet"]) <= CONTEXT_SNIPPET_LIMIT for item in budget["data"]["items"])
    legacy = {key: value for key, value in budget["data"].items() if key != "written"}
    assert len(js_json(legacy)) <= CONTEXT_JSON_LIMIT
    assert budget["data"]["omitted"] > 0
    assert sorted(budget["data"]["items"][0]) == ["category", "id", "project", "snippet", "source", "title", "updated_at"]


@pytest.mark.asyncio
async def test_vectors_thresholds_and_lexical_fallback():
    hit = [0.4, 0.916515138991168, 0]
    neighbor = [0.2, 0.9797958971132712, 0]
    weak = [0.2, -0.9797958971132712, 0]
    low = [0.34, -0.940374469585652, 0]
    prompt = [1, 0, 0]
    assert cosine_similarity(prompt, hit) >= DIRECT_SIMILARITY
    assert cosine_similarity(prompt, neighbor) < NEIGHBOR_SIMILARITY or cosine_similarity(prompt, neighbor) < DIRECT_SIMILARITY
    assert cosine_similarity(prompt, neighbor) < 0.35
    assert cosine_similarity(hit, neighbor) >= 0.55
    assert cosine_similarity(hit, weak) < 0.55
    assert DIRECT_SIMILARITY == 0.35
    assert NEIGHBOR_SIMILARITY == 0.55

    vectors = {"HITTOKEN": hit, "NEARTOKEN": neighbor, "WEAKTOKEN": weak, "LOWTOKEN": low}

    def mapper(text: str):
        for token, vector in vectors.items():
            if token in text:
                return vector
        if "PROMPT" in text:
            return prompt
        return [0, -1, 0]

    store = InMemoryStore()
    memory = create_memory_api(store, Brain(spaces=Spaces(USER_A), embedding=Embed(mapper), formulator=Formulator(lambda _payload: _empty())))
    saved = [
        ("HITTOKEN", "Direct hit"),
        ("NEARTOKEN", "Strong neighbor"),
        ("WEAKTOKEN", "Weak neighbor"),
        ("LOWTOKEN", "Below direct"),
    ]
    for index in range(6):
        saved.append((f"FILLER{index}", f"Filler {index}"))
    for token, title in saved:
        assert "data" in await memory.save_dashboard_memory(USER_A, {"project": "Vectors", "category": "fact", "title": title, "content": f"{token} privatebody"}, PERSONAL)
    result = await memory.get_context(USER_A, {"prompt": "PROMPT querywords"})
    titles = sorted(item["title"] for item in result["data"]["items"])
    assert titles == ["Direct hit", "Strong neighbor"]

    failing = InMemoryStore()

    class Flaky:
        dimensions = 3

        async def embed(self, _text):
            raise RuntimeError("embed down")

    lexical = create_memory_api(failing, Brain(spaces=Spaces(USER_A), embedding=Flaky(), formulator=Formulator(lambda _payload: _empty())))
    saved_row = await lexical.save_dashboard_memory(USER_A, {"project": "Boring Context", "category": "fact", "title": "Raketmotor", "content": "Hemlig konstruktion."}, PERSONAL)
    assert "data" in saved_row
    assert failing.snapshot()[0]["embedding"] is None
    fallback = await lexical.get_context(USER_A, {"prompt": "raketmotor"})
    assert fallback["data"]["items"][0]["title"] == "Raketmotor"


async def _empty():
    return []


@pytest.mark.asyncio
async def test_personal_shared_history_and_same_subject():
    drafts = [
        [{"space": "personal", "project": "Boring Context", "category": "decision", "title": "Ship Friday", "content": "Ship on Friday."}],
        [{"space": "personal", "project": "Boring Context", "category": "decision", "title": "Ship Friday", "content": "Ship on Monday."}],
        [{"space": "personal", "project": "Boring Context", "category": "decision", "title": "Ship Friday", "content": "Ship on Monday."}],
        [{"space": "personal", "project": "Boring Context", "category": "fact", "title": "Owner", "content": "Melker owns the brain."}],
    ]
    step = {"n": 0}

    async def formulate(_payload):
        index = step["n"]
        step["n"] += 1
        return drafts[index] if index < len(drafts) else []

    def embed(text: str):
        return [0, 1, 0] if "Monday" in text else [1, 0, 0]

    store = InMemoryStore()
    memory = create_memory_api(store, Brain(spaces=Spaces(USER_A), embedding=Embed(embed), formulator=Formulator(formulate)))
    first = await memory.get_context(USER_A, {"prompt": "Remember the ship decision."})
    second = await memory.get_context(USER_A, {"prompt": "The ship decision moved."})
    stamped = next(row for row in store.snapshot() if row["id"] == first["data"]["written"][0]["id"])
    third = await memory.get_context(USER_A, {"prompt": "The ship decision moved again."})
    fourth = await memory.get_context(USER_A, {"prompt": "A different subject."})
    assert second["data"]["written"][0]["id"] == first["data"]["written"][0]["id"]
    assert third["data"]["written"][0]["id"] == first["data"]["written"][0]["id"]
    assert fourth["data"]["written"][0]["id"] != first["data"]["written"][0]["id"]
    versions = await memory.list_versions(USER_A, first["data"]["written"][0]["id"])
    assert len(versions["data"]) == 1
    assert versions["data"][0]["event"] == "update"
    assert versions["data"][0]["changed_by"] == USER_A
    assert versions["data"][0]["content_before"] == "Ship on Friday."
    assert versions["data"][0]["content_after"] == "Ship on Monday."
    assert "embedding" not in versions["data"][0]
    row = next(item for item in store.snapshot() if item["id"] == first["data"]["written"][0]["id"])
    assert row["content"] == "Ship on Monday."
    assert row["updated_at"] == stamped["updated_at"]
    assert row["embedding"] == [0, 1, 0]
    assert row["source"] == "brain"
    assert sum(1 for item in store.snapshot() if item["title"] == "Ship Friday") == 1

    seen = []

    async def shared_formulator(payload):
        seen.append(payload["text"])
        assert "content" not in (payload["existing"][0] if payload["existing"] else {})
        assert "id" not in (payload["existing"][0] if payload["existing"] else {})
        return [{
            "space": "shared",
            "project": "Boring Context",
            "category": "fact",
            "title": "Shared fact" if "shared" in payload["text"] else "Personal fact",
            "content": "Stored from the draft.",
        }]

    shared_store = InMemoryStore()
    shared = create_memory_api(shared_store, Brain(spaces=Spaces(USER_A), embedding=Embed(lambda _text: [1, 0, 0]), formulator=Formulator(shared_formulator)))
    personal = await shared.save_brief(USER_A, {"brief": "Remember the API path."})
    shared_row = await shared.save_brief(USER_A, {"brief": "Please store this in the shared space."})
    assert personal["data"]["items"][0]["space"] == "personal"
    assert personal["data"]["items"][0]["space_id"] == PERSONAL
    assert shared_row["data"]["items"][0]["space"] == "shared"
    assert shared_row["data"]["items"][0]["space_id"] == SHARED

    four = await shared.save_brief(USER_A, {"project": "Boring Context", "category": "fact", "title": "API", "content": "Routes stay stable."})
    assert four["error"]["code"] == "INVALID_CONTENT"
    assert not any("raw prompt" in row["content"] for row in shared_store.snapshot())

    async def explode(_payload):
        raise RuntimeError("formulate down")

    quiet = create_memory_api(InMemoryStore(), Brain(spaces=Spaces(USER_A), embedding=Embed(lambda _text: [0, 1, 0]), formulator=Formulator(explode)))
    await quiet.save_dashboard_memory(USER_A, {"project": "Boring Context", "category": "fact", "title": "Raketmotor", "content": "Hemlig konstruktion."}, PERSONAL)
    kept = await quiet.get_context(USER_A, {"prompt": "Berätta om raketmotor"})
    assert kept["data"]["items"][0]["title"] == "Raketmotor"
    assert kept["data"]["written"] == []

    history = create_memory_api(InMemoryStore(), Brain(spaces=Spaces(USER_A)))
    created = await history.save_dashboard_memory(USER_A, {"project": "Projekt A", "category": "decision", "title": "Stack", "content": "Första texten."}, PERSONAL)
    await history.update_memory(USER_A, {"id": created["data"]["id"], "project": "Projekt A", "category": "decision", "title": "Stack", "content": "Andra texten."})
    removed = await history.delete_memory(USER_A, created["data"]["id"])
    assert removed["data"]["success"] is True
    listed = await history.search_in_space(USER_A, PERSONAL, {"query": "texten"})
    assert listed["data"] == []
    versions = await history.list_versions(USER_A, created["data"]["id"])
    assert [version["event"] for version in versions["data"]] == ["delete", "update"]
    assert versions["data"][0]["content_before"] == "Andra texten."
    assert versions["data"][0]["content_after"] == ""
    assert versions["data"][1]["content_before"] == "Första texten."
    assert versions["data"][1]["content_after"] == "Andra texten."
    assert "embedding" not in versions["data"][0]


@pytest.mark.asyncio
async def test_project_spelling_and_draft_limit():
    async def formulate(_payload):
        return [
            {"space": "personal", "project": "Boring Context", "category": "fact", "title": "API path", "content": "The API lives in apps/api."},
            {"space": "personal", "project": "Boringcontext", "category": "fact", "title": "Dashboard", "content": "The dashboard sends space_id."},
        ]

    store = InMemoryStore()
    memory = create_memory_api(store, Brain(spaces=Spaces(USER_A), embedding=Embed(lambda _text: [1, 0, 0]), formulator=Formulator(formulate)))
    result = await memory.save_brief(USER_A, {"brief": "Notes about Boring Context."})
    assert len(result["data"]["items"]) == 2
    assert [row["project"] for row in store.snapshot()] == ["Boring Context", "Boring Context"]

    drafts = [
        {"space": "nope", "project": "Boring Context", "category": "fact", "title": "Bad space", "content": "Skip me."},
        {"space": "personal", "project": "Boring Context", "category": "nope", "title": "Bad category", "content": "Skip me."},
    ]
    drafts.extend(
        {"space": "personal", "project": "Boring Context", "category": "fact", "title": f"Valid {index}", "content": f"Durable fact {index}."}
        for index in range(9)
    )

    async def many(_payload):
        return drafts

    limited = InMemoryStore()
    api = create_memory_api(limited, Brain(spaces=Spaces(USER_A), embedding=Embed(lambda _text: [1, 0, 0]), formulator=Formulator(many)))
    saved = await api.save_brief(USER_A, {"brief": "Nine facts and two invalid drafts."})
    assert len(saved["data"]["items"]) == 8
    assert len(limited.snapshot()) == 8
    assert all(row["title"] != "Bad space" for row in limited.snapshot())


@pytest.mark.asyncio
async def test_project_noise_vectors_and_hidden_spaces():
    memory = create_memory_api(InMemoryStore())
    await memory.save_memory(USER_A, {"project": "Kaffekvarnen", "category": "fact", "title": "Databas", "content": "Kaffekvarnen använder PostgreSQL."})
    await memory.save_memory(USER_A, {"project": "Kaffekvarnen", "category": "preference", "title": "Svarsspråk", "content": "Kaffekvarnen föredrar svenska svar."})
    await memory.save_memory(USER_A, {"project": "Kaffekvarnen", "category": "goal", "title": "Tillväxtmål", "content": "Kaffekvarnen ska nå 60 användare."})
    for prompt in ["Vilken databas använder Kaffekvarnen?", "Which database does Kaffekvarnen use?"]:
        result = await memory.get_context(USER_A, {"prompt": prompt})
        assert [item["title"] for item in result["data"]["items"]] == ["Databas"]
    broad = await memory.get_context(USER_A, {"prompt": "databas"})
    assert set(broad["data"]["projects"]) == {"Kaffekvarnen"}

    def mapper(text: str):
        if "ALPHA" in text or "qqqq" in text:
            return [1, 0, 0]
        if "BETA" in text:
            return [0.8, 0.6, 0]
        return [0, 1, 0]

    store = InMemoryStore()
    vectors = create_memory_api(store, Brain(spaces=Spaces(USER_A), embedding=Embed(mapper), formulator=Formulator(lambda _payload: _empty())))
    await vectors.save_dashboard_memory(USER_A, {"project": "Vectors", "category": "fact", "title": "Alpha note", "content": "ALPHA quartz crystal"}, PERSONAL)
    await vectors.save_dashboard_memory(USER_A, {"project": "Vectors", "category": "fact", "title": "Beta note", "content": "BETA marble stone"}, PERSONAL)
    together = await vectors.get_context(USER_A, {"prompt": "qqqq zebra"})
    assert sorted(item["title"] for item in together["data"]["items"]) == ["Alpha note", "Beta note"]

    private = InMemoryStore()
    hidden = create_memory_api(
        private,
        Brain(spaces=Spaces(USER_A, [PERSONAL]), embedding=Embed(lambda _text: [1, 0, 0]), formulator=Formulator(lambda _payload: _empty())),
    )
    await hidden.save_dashboard_memory(
        USER_A,
        {"project": "Vectors", "category": "fact", "title": "Mine", "content": "raketmotor i mitt utrymme"},
        PERSONAL,
    )
    await private.upsert_subject(
        USER_A,
        {"space_id": SHARED, "project": "Vectors", "category": "fact", "title": "Team secret", "content": "raketmotor i delat utrymme", "source": "dashboard"},
    )
    await private.upsert_subject(
        USER_B,
        {"space_id": OTHER, "project": "Vectors", "category": "fact", "title": "Stranger", "content": "raketmotor hos någon annan", "source": "dashboard"},
    )
    for title in ("Team secret", "Stranger"):
        await private.set_embedding(next(row["id"] for row in private.snapshot() if row["title"] == title), [1, 0, 0])
    visible = await hidden.get_context(USER_A, {"prompt": "raketmotor"})
    assert [item["title"] for item in visible["data"]["items"]] == ["Mine"]


@pytest.mark.asyncio
async def test_project_filter_rejects_another_name_and_keeps_hyphen_spelling():
    store = InMemoryStore()
    memory = create_memory_api(
        store,
        Brain(spaces=Spaces(USER_A), embedding=Embed(lambda _text: [1, 0, 0]), formulator=Formulator(lambda _payload: _empty())),
    )
    await memory.save_dashboard_memory(
        USER_A,
        {
            "project": "Testprojekt 2026-10-02",
            "category": "fact",
            "title": "Silvernot",
            "content": "SILVER-2026-10-02 ligger i testprojektet.",
        },
        PERSONAL,
    )
    other = await memory.get_context(
        USER_A,
        {"prompt": "Vad gäller SILVER-2026-10-02?", "project": "Annatprojekt 2026-10-02"},
    )
    assert other["data"]["items"] == []
    assert other["data"]["project"] == "Annatprojekt 2026-10-02"
    assert "projects" not in other["data"]
    assert all(item["project"] != "Testprojekt 2026-10-02" for item in other["data"]["items"])

    for typed in ("Testprojekt-2026-10-02", "Testprojekt  2026-10-02", "testprojekt 2026-10-02"):
        hit = await memory.get_context(USER_A, {"prompt": "Vad gäller SILVER-2026-10-02?", "project": typed})
        assert hit["data"]["project"] == "Testprojekt 2026-10-02"
        assert [item["project"] for item in hit["data"]["items"]] == ["Testprojekt 2026-10-02"]

    assert extract_keywords("SILVER-2026-10-02") == ["silver", "2026", "10", "02"]
