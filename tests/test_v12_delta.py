import json

import pytest

from boringcontext.brain import choose_shared_space, shared_save_plan, text_confirms_team_save
from boringcontext.clients import formulator_request
from boringcontext.memory_store import InMemoryStore
from boringcontext.runtime import run_brain_call
from boringcontext.store import DELETION_RETENTION_DAYS, create_memory_api, keep_recent_deletions
from boringcontext.validate import validate_memory_input

USER_A = "11111111-1111-4111-8111-111111111111"
PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-000000000010"
SHARED = "aaaaaaaa-aaaa-4aaa-8aaa-000000000011"
ALPHA = "aaaaaaaa-aaaa-4aaa-8aaa-000000000021"
BETA = "aaaaaaaa-aaaa-4aaa-8aaa-000000000022"


class Spaces:
    def __init__(self, teams):
        self.teams = teams

    async def readable_space_ids(self, _user_id):
        return [PERSONAL, *[team["id"] for team in self.teams]]

    async def list_spaces(self, _user_id):
        return [{"id": PERSONAL, "kind": "personal"}, *self.teams]

    async def space_for(self, _user_id, kind):
        if kind == "personal":
            return PERSONAL
        return self.teams[0]["id"] if len(self.teams) == 1 else None

    async def is_member(self, _user_id, _space_id):
        return True


class Brain:
    def __init__(self, spaces):
        self.spaces = spaces
        self.embedding = None
        self.formulator = self

    async def formulate(self, _payload):
        return [{
            "space": "shared",
            "project": "Boring Context",
            "category": "fact",
            "title": "Team fact",
            "content": "Stored from the draft.",
        }]


@pytest.mark.asyncio
async def test_one_team_is_shared_only_when_the_text_asks():
    memory = create_memory_api(InMemoryStore(), Brain(Spaces([{"id": SHARED, "kind": "shared", "name": "Boring"}])))
    personal = await memory.save_brief(USER_A, {"brief": "Remember the API path."})
    swedish = await memory.save_brief(USER_A, {"brief": "Spara i team att vi lanserar open source."})
    asked = await memory.save_brief(USER_A, {"brief": "Yes, save this in the shared space."})
    assert personal["data"]["items"][0]["space_id"] == PERSONAL
    assert swedish["data"]["items"][0]["space_id"] == SHARED
    assert asked["data"]["items"][0]["space_id"] == SHARED
    for brief in (
        "Detta är gemensam för teamet. Lanseringen står fast.",
        "Lägg minnet i det gemensamma utrymmet.",
        "Spara detta i det gemensamma.",
    ):
        landed = await memory.save_brief(USER_A, {"brief": brief})
        assert landed["data"]["items"][0]["space"] == "shared"
        assert landed["data"]["items"][0]["space_id"] == SHARED


@pytest.mark.asyncio
async def test_shared_request_without_a_team_stays_personal():
    memory = create_memory_api(InMemoryStore(), Brain(Spaces([])))
    saved = await memory.save_brief(USER_A, {"brief": "Detta är gemensam för teamet."})
    assert saved["data"]["items"][0]["space"] == "personal"
    assert saved["data"]["items"][0]["space_id"] == PERSONAL
    meeting = await memory.save_brief(USER_A, {"brief": "Det gemensamma mötet var bra."})
    assert meeting["data"]["items"][0]["space_id"] == PERSONAL


@pytest.mark.asyncio
async def test_several_teams_need_a_name_next_to_the_save():
    memory = create_memory_api(
        InMemoryStore(),
        Brain(Spaces([
            {"id": ALPHA, "kind": "shared", "name": "Alpha"},
            {"id": BETA, "kind": "shared", "name": "Beta"},
        ])),
    )
    unnamed = await memory.save_brief(USER_A, {"brief": "Ja, spara i teamet."})
    asked = await memory.save_brief(USER_A, {"brief": "Detta är gemensam för teamet."})
    named = await memory.save_brief(USER_A, {"brief": "Ja, spara i teamet Beta."})
    assert unnamed["error"]["code"] == "TEAM_CHOICE"
    assert asked["error"]["code"] == "TEAM_CHOICE"
    assert "Alpha" in unnamed["error"]["message"]
    assert "Beta" in unnamed["error"]["message"]
    assert "items" not in unnamed
    assert named["data"]["items"][0]["space_id"] == BETA
    yes = await memory.save_brief(USER_A, {"brief": "ja"})
    assert yes["data"]["items"][0]["space_id"] == PERSONAL
    assert choose_shared_space("ja", [
        {"id": ALPHA, "kind": "shared", "name": "Alpha"},
        {"id": BETA, "kind": "shared", "name": "Beta"},
    ]) is None
    reply = await memory.save_brief(USER_A, {"brief": "Beta"})
    assert reply["data"]["items"][0]["space_id"] == BETA
    assert text_confirms_team_save("Spara detta gemensamt.") is True
    assert text_confirms_team_save("Detta är gemensam för teamet.") is True
    assert text_confirms_team_save("Lägg minnet i det gemensamma utrymmet.") is True
    assert text_confirms_team_save("Det gemensamma mötet var bra.") is False
    assert choose_shared_space("Ja, spara i teamet Alpha.", [
        {"id": ALPHA, "kind": "shared", "name": "Alpha"},
        {"id": BETA, "kind": "shared", "name": "Beta"},
    ]) == ALPHA
    assert choose_shared_space("Spara i teamet.", [
        {"id": ALPHA, "kind": "shared", "name": "Alpha"},
        {"id": BETA, "kind": "shared", "name": "Beta"},
    ]) is None


def test_mentioning_the_team_does_not_share():
    teams = [{"id": SHARED, "kind": "shared", "name": "Boring"}]
    assert shared_save_plan("Spara att teamet valde silver.", teams) == {"mode": "personal"}
    assert shared_save_plan("Teamet sa ja till förslaget.", teams) == {"mode": "personal"}
    assert shared_save_plan("Spara det här i det gemensamma utrymmet", teams) == {"mode": "shared", "id": SHARED}
    assert shared_save_plan("share this with the team", teams) == {"mode": "shared", "id": SHARED}
    several = [
        {"id": ALPHA, "kind": "shared", "name": "Alpha"},
        {"id": BETA, "kind": "shared", "name": "Beta"},
    ]
    assert shared_save_plan("ja", several) == {"mode": "personal"}
    assert shared_save_plan("Beta", several) == {"mode": "shared", "id": BETA}


@pytest.mark.asyncio
async def test_a_mixed_brief_keeps_a_personal_draft():
    class Mixed:
        def __init__(self, drafts):
            self.drafts = drafts
            self.spaces = Spaces([{"id": SHARED, "kind": "shared", "name": "Boring"}])
            self.embedding = None
            self.formulator = self

        async def formulate(self, _payload):
            return self.drafts

    shared_brief = "Spara det här i det gemensamma utrymmet"
    memory = create_memory_api(
        InMemoryStore(),
        Mixed([
            {"space": "personal", "project": "Boring Context", "category": "fact", "title": "Private note", "content": "Stays with the person."},
            {"project": "Boring Context", "category": "fact", "title": "Unspecified note", "content": "Follows the brief."},
            {"space": "shared", "project": "Boring Context", "category": "fact", "title": "Shared note", "content": "Asked to be shared."},
        ]),
    )
    saved = await memory.save_brief(USER_A, {"brief": shared_brief})
    assert [(item["title"], item["space"], item["space_id"]) for item in saved["data"]["items"]] == [
        ("Private note", "personal", PERSONAL),
        ("Unspecified note", "shared", SHARED),
        ("Shared note", "shared", SHARED),
    ]
    personal = create_memory_api(
        InMemoryStore(),
        Mixed([
            {"project": "Boring Context", "category": "fact", "title": "No choice", "content": "Follows a personal brief."},
        ]),
    )
    stayed = await personal.save_brief(USER_A, {"brief": "Remember the API path."})
    assert stayed["data"]["items"][0]["space"] == "personal"
    assert stayed["data"]["items"][0]["space_id"] == PERSONAL


@pytest.mark.asyncio
async def test_team_lookup_failure_returns_an_error():
    class Broken(Spaces):
        async def list_spaces(self, _user_id):
            raise RuntimeError("space lookup failed")

    store = InMemoryStore()
    memory = create_memory_api(store, Brain(Broken([{"id": SHARED, "kind": "shared", "name": "Boring"}])))
    failed = await memory.save_brief(USER_A, {"brief": "Spara i team att vi lanserar open source."})
    assert failed["error"]["code"] == "SPACES_FAILED"
    assert "items" not in failed
    assert await store.list_by_user(USER_A) == []

    class Flaky(Spaces):
        def __init__(self, teams):
            super().__init__(teams)
            self.calls = 0

        async def list_spaces(self, user_id):
            self.calls += 1
            if self.calls > 1:
                raise RuntimeError("space lookup failed")
            return await super().list_spaces(user_id)

    second = InMemoryStore()
    again = await create_memory_api(second, Brain(Flaky([{"id": SHARED, "kind": "shared", "name": "Boring"}]))).save_brief(
        USER_A,
        {"brief": "Spara det här i det gemensamma utrymmet"},
    )
    assert again["error"]["code"] == "SPACES_FAILED"
    assert await second.list_by_user(USER_A) == []


def test_empty_project_is_allowed_and_titles_stay_unique():
    parsed = validate_memory_input({"project": "", "category": "fact", "title": "Möte", "content": "Agenda."})
    assert parsed["data"]["project"] == ""
    empty = validate_memory_input({"project": "", "category": "nope", "title": "", "content": ""})
    assert empty["error"]["code"] == "INVALID_TITLE"


@pytest.mark.asyncio
async def test_same_title_in_a_project_is_rejected_and_project_changes_are_versions():
    store = InMemoryStore()
    memory = create_memory_api(store, Brain(Spaces([{"id": SHARED, "kind": "shared", "name": "Boring"}])))
    saved = await memory.save_dashboard_memory(
        USER_A,
        {"project": "Projekt A", "category": "fact", "title": "Stack", "content": "TypeScript."},
        SHARED,
    )
    clash = await memory.save_dashboard_memory(
        USER_A,
        {"project": "Projekt A", "category": "decision", "title": "Stack", "content": "Annat."},
        SHARED,
    )
    assert clash["error"]["code"] == "DUPLICATE_TITLE"
    moved = await memory.update_memory(USER_A, {
        "id": saved["data"]["id"],
        "project": "Infra",
        "category": "fact",
        "title": "Stack",
        "content": "TypeScript.",
        "allow_project_change": True,
    })
    assert "data" in moved
    history = await memory.list_versions(USER_A, saved["data"]["id"])
    assert history["data"][0]["project"] == "Projekt A"
    assert history["data"][0]["content_before"] == history["data"][0]["content_after"]


def test_delete_history_older_than_30_days_is_dropped():
    from datetime import datetime, timezone

    now = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
    assert DELETION_RETENTION_DAYS == 30
    recent = {"created_at": "2026-09-20T12:00:00.000Z", "content_before": "keep"}
    old = {"created_at": "2026-08-01T12:00:00.000Z", "content_before": "drop"}
    assert [row["content_before"] for row in keep_recent_deletions([recent, old], now)] == ["keep"]


def test_formulator_request_stays_offline_and_names_the_team_rule():
    body = formulator_request("claude-sonnet-5", {"source": "save_memory", "text": "brief", "existing": []})
    assert "temperature" not in body
    assert body["thinking"] == {"type": "disabled"}
    assert "one team" in body["system"]
    assert json.loads(body["messages"][0]["content"])["text"] == "brief"


@pytest.mark.asyncio
async def test_invoke_without_supabase_does_not_open_a_network():
    result = await run_brain_call("get_context", USER_A, {"prompt": "hej"}, "", {})
    assert result["data"]["items"] == []
    assert result["data"]["written"] == []


@pytest.mark.asyncio
async def test_invoke_four_fields_ignore_a_lesson_category_and_unknown_ops():
    saved = await run_brain_call(
        "save_memory",
        USER_A,
        {"project": "Projekt A", "category": "fact", "title": "Titel", "content": "Innehåll som räcker."},
        "",
        {},
    )
    assert saved["data"]["title"] == "Titel"
    assert saved["data"]["category"] == "fact"
    lesson = await run_brain_call(
        "save_lesson",
        USER_A,
        {"project": "Projekt A", "category": "fact", "title": "Regel", "content": "Svara kort nästa gång."},
        "",
        {},
    )
    assert lesson["data"]["category"] == "lesson"
    missing = await run_brain_call("update_memory", USER_A, {"id": "not-a-uuid"}, "", {})
    assert missing["error"]["code"] == "INVALID_ID"
    empty = await run_brain_call("search_memory", USER_A, {}, "", {})
    assert empty["data"] == []
    denied = await run_brain_call("save_dashboard", USER_A, {"space_id": PERSONAL, "project": "P", "category": "fact", "title": "T", "content": "C"}, "", {})
    assert denied["error"]["code"] == "FORBIDDEN"
    unknown = await run_brain_call("delete_everything", USER_A, {}, "", {})
    assert unknown["error"]["code"] == "INVALID_BODY"


@pytest.mark.asyncio
async def test_delete_list_names_who_removed_the_text():
    store = InMemoryStore()
    api = create_memory_api(store, Brain(Spaces([{"id": SHARED, "kind": "shared"}])))
    saved = await api.save_dashboard_memory(
        USER_A,
        {"project": "Team", "category": "decision", "title": "Verktyg", "content": "Vi valde verktyg A."},
        PERSONAL,
    )
    assert "data" in saved
    removed = await api.delete_memory("other-member", saved["data"]["id"])
    assert removed["data"]["success"] is True
    listed = await api.list_deletions(USER_A, PERSONAL)
    assert listed["data"][0]["event"] == "delete"
    assert listed["data"][0]["changed_by"] == "other-member"
    assert listed["data"][0]["content_before"] == "Vi valde verktyg A."

    class Closed:
        async def is_member(self, user_id, space_id):
            return user_id == USER_A and space_id == PERSONAL

    outsider = create_memory_api(store, type("Brain", (), {"spaces": Closed()})())
    blocked = await outsider.list_deletions("outsider", PERSONAL)
    assert blocked["error"]["code"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_context_items_omit_the_user_and_the_full_text():
    memory = create_memory_api(InMemoryStore())
    saved = await memory.save_memory(
        USER_A,
        {"project": "Projekt A", "category": "deadline", "title": "Lanseringsdatum", "content": "Vi lanserar 15 oktober 2026."},
    )
    result = await memory.get_context(USER_A, {"prompt": "När ska vi lansera?", "project": "Projekt A"})
    item = result["data"]["items"][0]
    assert item == {
        "id": saved["data"]["id"],
        "project": "Projekt A",
        "category": "deadline",
        "title": "Lanseringsdatum",
        "snippet": "Vi lanserar 15 oktober 2026.",
        "updated_at": saved["data"]["updated_at"],
        "source": "user_memory",
    }
    dumped = json.dumps(result["data"])
    assert "user_id" not in dumped
    assert "created_at" not in dumped
    assert '"content"' not in dumped
