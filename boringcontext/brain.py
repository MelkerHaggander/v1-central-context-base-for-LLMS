import math
import re
import unicodedata
from typing import Any

from boringcontext.validate import CATEGORIES, validate_memory_input

# Direct hits must clear 0.35. A neighbor of a direct hit must clear 0.55.
# Weaker vectors stay out so the pack is not padded with loose matches.
DIRECT_SIMILARITY = 0.35
NEIGHBOR_SIMILARITY = 0.55
IDENTITY_LIMIT = 50
NEAREST_LIMIT = 32

_SHARED_PHRASE = re.compile(
    r"\bin the shared(?:\s+space)?\b"
    r"|\b(?:to|with) the team\b"
    r"|\bshare (?:this|it|that|these) with\b",
    re.IGNORECASE,
)
# A destination, not a passing mention. "Det gemensamma mötet" stays personal.
_SHARED_DESTINATION = re.compile(
    r"\bgemensam(?:t|ma)?\s+för\s+teamet\b"
    r"|\b(?:i|till|åt)\s+(?:det\s+)?gemensamma(?:\s+utrymmet)?\b"
    r"|\bdet\s+gemensamma\s+utrymmet\b"
    r"|\bgemensamma\s+utrymmet\b",
    re.IGNORECASE,
)
# The verb has to aim at the shared place. "Spara att teamet valde" only
# mentions the team, and "ja" is not a choice of the first team.
_SHARE_REQUEST = re.compile(
    r"\b(?:spara|save|store|lägg|lagra)\b(?:\s+\S+){0,8}\s+"
    r"(?:i|till|åt|på|in|to|with|for)\s+(?:ett\s+|det\s+|the\s+)?team(?:et|en)?\b"
    r"|\b(?:spara|save|store|lägg|lagra)\b(?:\s+\S+){0,8}\s+gemensamt\b",
    re.IGNORECASE,
)
_YES_REPLY = re.compile(r"^(?:ja|japp|yes)$", re.IGNORECASE)


def project_key(project: str) -> str:
    folded = unicodedata.normalize("NFKC", project).lower()
    return re.sub(r"[\s-]+", "", folded)


def embedding_text(title: str, content: str) -> str:
    return f"{title}\n{content}"


def _is_word_char(char: str) -> bool:
    return char.isalnum()


def text_confirms_team_save(text: str) -> bool:
    normalized = unicodedata.normalize("NFKC", text)
    if _SHARED_DESTINATION.search(normalized):
        return True
    if _SHARED_PHRASE.search(normalized):
        return True
    return _SHARE_REQUEST.search(normalized) is not None


def text_requests_shared(text: str) -> bool:
    return text_confirms_team_save(text)


def _mentioned_name_length(text: str, name: str | None) -> int:
    needle = (name or "").strip().casefold()
    if len(needle) < 2:
        return 0
    hay = unicodedata.normalize("NFKC", text).casefold()
    start = 0
    while start <= len(hay):
        index = hay.find(needle, start)
        if index < 0:
            return 0
        before = hay[index - 1] if index else " "
        after_index = index + len(needle)
        after = hay[after_index] if after_index < len(hay) else " "
        if not _is_word_char(before) and not _is_word_char(after):
            return len(needle)
        start = after_index
    return 0


def choose_shared_space(text: str, spaces: list[dict]) -> str | None:
    if not text_confirms_team_save(text):
        return None
    teams = [space for space in spaces if space.get("kind") == "shared" and str(space.get("id") or "").strip()]
    if len(teams) == 1:
        return teams[0].get("id")
    if len(teams) < 2:
        return None
    ranked = [
        {"id": team["id"], "length": _mentioned_name_length(text, team.get("name"))}
        for team in teams
    ]
    ranked = [team for team in ranked if team["length"] > 0]
    ranked.sort(key=lambda team: team["length"], reverse=True)
    if not ranked:
        return None
    best = ranked[0]
    same = [team for team in ranked if team["length"] == best["length"]]
    return best["id"] if len(same) == 1 else None


def _shared_teams(spaces: list[dict]) -> list[dict]:
    return [space for space in spaces if space.get("kind") == "shared" and str(space.get("id") or "").strip()]


def _reply_line(text: str) -> str:
    for line in unicodedata.normalize("NFKC", text).splitlines():
        stripped = line.strip()
        if stripped:
            return stripped.casefold().rstrip(".!?").strip()
    return ""


def _reply_chooses_team(text: str, teams: list[dict]) -> str | None:
    """A reply that is one team name chooses that team. "ja" does not."""
    folded = _reply_line(text)
    if not folded or _YES_REPLY.match(folded):
        return None
    matches: list[str] = []
    for team in teams:
        name = str(team.get("name") or "").strip()
        if len(name) < 2:
            continue
        key = name.casefold()
        aliases = {key, f"teamet {key}", f"team {key}", f"i {key}", f"i teamet {key}"}
        if folded in aliases:
            team_id = str(team.get("id") or "")
            if team_id and team_id not in matches:
                matches.append(team_id)
    return matches[0] if len(matches) == 1 else None


def team_choice_message(spaces: list[dict]) -> str:
    names: list[str] = []
    for team in _shared_teams(spaces):
        name = str(team.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
    if not names:
        return "Vilket team ska minnet sparas i?"
    return "Vilket team ska minnet sparas i? " + ", ".join(names) + "."


def shared_save_plan(text: str, spaces: list[dict]) -> dict:
    """Where a brief that may ask for the shared space should land.

    A clear request and one shared space: that space. Several teams and no
    single named team: ask, and list the names. A reply that is one of those
    names chooses it. Mentioning the team, or answering ja, does not.
    No shared space: personal, the contract default.
    """
    teams = _shared_teams(spaces)
    if text_requests_shared(text) and teams:
        if len(teams) == 1:
            return {"mode": "shared", "id": teams[0]["id"]}
        chosen = choose_shared_space(text, spaces)
        if chosen:
            return {"mode": "shared", "id": chosen}
        return {"mode": "ask"}
    named = _reply_chooses_team(text, teams)
    if named:
        return {"mode": "shared", "id": named}
    return {"mode": "personal"}


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        return 0.0
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for a, b in zip(left, right):
        dot += a * b
        left_norm += a * a
        right_norm += b * b
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (math.sqrt(left_norm) * math.sqrt(right_norm))


def canonical_project(requested: str, existing: list[str]) -> str:
    trimmed = requested.strip()
    key = project_key(trimmed)
    for name in existing:
        if project_key(name) == key:
            return name
    return trimmed


def _duplicate_key(row: dict) -> str:
    return "\u0000".join(
        [
            unicodedata.normalize("NFKC", row["project"]).lower(),
            unicodedata.normalize("NFKC", row["title"]).lower(),
            row["category"],
        ]
    )


async def _maybe(value: Any) -> Any:
    if hasattr(value, "__await__"):
        return await value
    return value


async def apply_vector_ranking(
    *,
    user_id: str,
    prompt: str,
    space_ids: list[str],
    store: Any,
    embedding: Any,
    ranked: list[dict],
) -> list[dict]:
    query = await _maybe(embedding.embed(prompt))
    list_nearest = getattr(store, "list_nearest", None)
    if list_nearest is None:
        raise RuntimeError("nearest neighbor query is unavailable")
    nearest = await _maybe(list_nearest(user_id, query, space_ids, NEAREST_LIMIT))
    direct = [hit for hit in nearest if hit["similarity"] >= DIRECT_SIMILARITY]
    included = {candidate["row"]["id"]: candidate for candidate in ranked}

    def consider(hit: dict, score: float) -> None:
        if hit["row"]["id"] in included:
            return
        included[hit["row"]["id"]] = {
            "row": hit["row"],
            "key": _duplicate_key(hit["row"]),
            "lexical_score": 0,
            "score": score,
        }

    for hit in direct:
        consider(hit, hit["similarity"] * 100)

    list_neighbors = getattr(store, "list_neighbors", None)
    if direct and list_neighbors is not None:
        neighbors = await _maybe(
            list_neighbors(
                user_id,
                [hit["row"]["id"] for hit in direct],
                space_ids,
                NEIGHBOR_SIMILARITY,
                NEAREST_LIMIT,
            )
        )
        for hit in neighbors:
            if hit["similarity"] < NEIGHBOR_SIMILARITY:
                continue
            consider(hit, hit["similarity"] * 40)

    return sorted(included.values(), key=rank_sort_key)


def rank_sort_key(candidate: dict) -> tuple:
    return (
        -candidate["score"],
        _invert_timestamp(candidate["row"]["updated_at"]),
        candidate["row"]["id"],
    )


def _invert_timestamp(value: str) -> str:
    # ISO-8601 UTC strings sort chronologically. Invert digits so newer rows come first.
    return "".join(chr(ord("9") - ord(ch) + ord("0")) if ch.isdigit() else ch for ch in value)


async def recent_identities(user_id: str, space_ids: list[str], store: Any) -> list[dict]:
    list_identities = getattr(store, "list_identities", None)
    if list_identities is not None:
        return await _maybe(list_identities(user_id, space_ids, IDENTITY_LIMIT))
    list_by_spaces = getattr(store, "list_by_spaces", None)
    if list_by_spaces is not None:
        rows = await _maybe(list_by_spaces(user_id, space_ids))
    else:
        rows = await _maybe(store.list_by_user(user_id))
    rows = sorted(rows, key=lambda row: row["updated_at"], reverse=True)
    return [
        {
            "project": row["project"],
            "category": row["category"],
            "title": row["title"],
            "updated_at": row["updated_at"],
        }
        for row in rows[:IDENTITY_LIMIT]
    ]


def _draft_space(draft: dict, allow_shared: bool) -> str | None:
    # The draft's own space is read first. A brief that asks for shared does
    # not rewrite a draft the formulator marked personal. No choice follows the brief.
    space = draft.get("space")
    if space == "personal":
        return "personal"
    if space == "shared":
        return "shared" if allow_shared else "personal"
    if space is None:
        return "shared" if allow_shared else "personal"
    return None


class SpaceLookupError(Exception):
    """The team list could not be read. Callers return an error, not personal."""


async def load_listed_spaces(spaces: Any, user_id: str) -> list[dict]:
    list_spaces = getattr(spaces, "list_spaces", None) if spaces is not None else None
    if list_spaces is None:
        return []
    try:
        listed = await _maybe(list_spaces(user_id))
    except Exception as error:
        raise SpaceLookupError("Utrymmena kunde inte hämtas.") from error
    if listed is None:
        return []
    if not isinstance(listed, list):
        raise SpaceLookupError("Utrymmena kunde inte hämtas.")
    return listed


async def _known_projects(user_id: str, space_ids: list[str], store: Any) -> list[str]:
    list_by_spaces = getattr(store, "list_by_spaces", None)
    if list_by_spaces is not None:
        rows = await _maybe(list_by_spaces(user_id, space_ids))
    else:
        rows = await _maybe(store.list_by_user(user_id))
    seen: list[str] = []
    for row in rows:
        if row["project"] not in seen:
            seen.append(row["project"])
    return seen


async def _remember_embedding(store: Any, embedding: Any, row: dict, changed: bool) -> None:
    set_embedding = getattr(store, "set_embedding", None)
    if embedding is None or set_embedding is None:
        return
    has_embedding = getattr(store, "has_embedding", None)
    if not changed and has_embedding is not None and await _maybe(has_embedding(row["id"])):
        return
    try:
        vector = await _maybe(embedding.embed(embedding_text(row["title"], row["content"])))
        await _maybe(set_embedding(row["id"], vector))
    except Exception:
        # The row is already saved. A later write can fill the vector.
        return


async def persist_drafts(
    *,
    user_id: str,
    drafts: list[dict],
    text: str,
    project: str | None,
    store: Any,
    brain: Any,
    limit: int,
) -> list[dict]:
    spaces = getattr(brain, "spaces", None)
    upsert = getattr(store, "upsert_subject", None)
    if spaces is None or upsert is None:
        return []
    listed = await load_listed_spaces(spaces, user_id)
    plan = shared_save_plan(text, listed)
    if plan["mode"] == "ask":
        return []
    shared_id = plan.get("id")
    allow_shared = plan["mode"] == "shared"
    try:
        space_ids = await _maybe(spaces.readable_space_ids(user_id))
    except Exception:
        space_ids = []
    projects = await _known_projects(user_id, space_ids, store)
    written: list[dict] = []

    for draft in drafts:
        if len(written) >= limit:
            break
        space = _draft_space(draft, allow_shared)
        if space is None:
            continue
        requested = (project or "").strip() or draft.get("project") or ""
        chosen = canonical_project(str(requested), projects)
        parsed = validate_memory_input(
            {
                "project": chosen,
                "category": draft.get("category") or "",
                "title": draft.get("title") or "",
                "content": draft.get("content") or "",
            }
        )
        if "error" in parsed:
            continue
        if parsed["data"]["category"] not in CATEGORIES:
            continue
        try:
            space_id = shared_id if space == "shared" else await _maybe(spaces.space_for(user_id, space))
        except Exception:
            space_id = None
        if not space_id:
            continue
        saved = await _maybe(
            upsert(
                user_id,
                {
                    "space_id": space_id,
                    "project": parsed["data"]["project"],
                    "category": parsed["data"]["category"],
                    "title": parsed["data"]["title"],
                    "content": parsed["data"]["content"],
                    "source": "brain",
                },
            )
        )
        if saved["kind"] == "failed":
            continue
        if saved["row"]["project"] not in projects:
            projects.append(saved["row"]["project"])
        await _remember_embedding(store, getattr(brain, "embedding", None), saved["row"], saved["kind"] != "unchanged")
        written.append(
            {
                "id": saved["row"]["id"],
                "project": saved["row"]["project"],
                "category": saved["row"]["category"],
                "title": saved["row"]["title"],
                "space": space,
                "space_id": space_id,
            }
        )
    return written


async def attach_embedding(store: Any, embedding: Any, row: dict) -> None:
    await _remember_embedding(store, embedding, row, True)
