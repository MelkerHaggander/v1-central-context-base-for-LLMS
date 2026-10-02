import json

import pytest

from boringcontext.brain import choose_shared_space, text_confirms_team_save
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
    named = await memory.save_brief(USER_A, {"brief": "Ja, spara i teamet Beta."})
    assert unnamed["data"]["items"][0]["space_id"] == PERSONAL
    assert named["data"]["items"][0]["space_id"] == BETA
    assert text_confirms_team_save("Spara detta gemensamt.") is True
    assert text_confirms_team_save("Det gemensamma mötet var bra.") is False
    assert choose_shared_space("Ja, spara i teamet Alpha.", [
        {"id": ALPHA, "kind": "shared", "name": "Alpha"},
        {"id": BETA, "kind": "shared", "name": "Beta"},
    ]) == ALPHA
    assert choose_shared_space("Spara i teamet.", [
        {"id": ALPHA, "kind": "shared", "name": "Alpha"},
        {"id": BETA, "kind": "shared", "name": "Beta"},
    ]) is None


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
