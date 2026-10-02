import math
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any

from boringcontext.brain import (
    apply_vector_ranking,
    attach_embedding,
    canonical_project,
    persist_drafts,
    project_key,
    rank_sort_key,
    recent_identities,
    shared_save_plan,
)
from boringcontext.jsonutil import js_json
from boringcontext.validate import fail, validate_memory_id, validate_memory_input, validate_search_input

PAGE_SIZE = 50
DELETION_RETENTION_DAYS = 30
CONTEXT_ITEM_LIMIT = 8
CONTEXT_SNIPPET_LIMIT = 280
CONTEXT_JSON_LIMIT = 3500
SAVED_ROW_LIMIT = 8


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def deletion_retention_cutoff(now: datetime | float | None = None) -> str:
    if isinstance(now, (int, float)):
        moment = datetime.fromtimestamp(now / 1000, tz=timezone.utc)
    elif isinstance(now, datetime):
        moment = _as_utc(now)
    else:
        moment = datetime.now(timezone.utc)
    cutoff = moment - timedelta(days=DELETION_RETENTION_DAYS)
    return cutoff.isoformat().replace("+00:00", "Z")


def keep_recent_deletions(rows: list[dict], now: datetime | float | None = None) -> list[dict]:
    if isinstance(now, (int, float)):
        moment = datetime.fromtimestamp(now / 1000, tz=timezone.utc)
    elif isinstance(now, datetime):
        moment = _as_utc(now)
    else:
        moment = datetime.now(timezone.utc)
    cutoff = moment - timedelta(days=DELETION_RETENTION_DAYS)
    kept = []
    for row in rows:
        raw = str(row.get("created_at") or "")
        try:
            at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if _as_utc(at) >= cutoff:
            kept.append(row)
    return kept

STOP_WORDS = {
    "ahead", "after", "about", "again", "also", "alla", "allt", "am", "and",
    "använda", "använder", "använt", "are", "as", "att", "av", "bara", "be",
    "before", "been", "being", "berätta", "brief", "bör", "but", "can", "could",
    "de", "den", "det", "detta", "did", "din", "dina", "dit", "do", "does", "du",
    "då", "där", "eller", "en", "er", "era", "ett", "for", "from", "fråga", "från",
    "framför", "för", "får", "had", "han", "har", "has", "have", "he", "hennes",
    "här", "hon", "how", "hur", "innan", "is", "it", "its", "inte", "jag", "kort",
    "kunde", "later", "me", "mer", "mest", "mig", "kan", "mine", "med", "men",
    "min", "mina", "mot", "många", "måste", "my", "mycket", "behöver", "någon",
    "något", "några", "nu", "och", "of", "också", "om", "on", "oss", "our", "på",
    "please", "redan", "sedan", "she", "short", "should", "sig", "sin", "sina",
    "sitt", "ska", "skall", "skulle", "som", "så", "tell", "than", "the", "their",
    "them", "then", "they", "this", "till", "to", "under", "upp", "us", "use",
    "used", "uses", "using", "ut", "utan", "vad", "var", "was", "we", "what",
    "when", "where", "which", "who", "why", "vi", "vid", "vilken", "vilka", "vill",
    "will", "with", "would", "vår", "våra", "vårt", "gång", "gör", "göra", "need",
    "needs", "you", "your", "är", "än", "över",
}

CATEGORY_CUES = {
    "fact": {"fact", "facts", "fakta", "faktum"},
    "decision": {"beslut", "beslutade", "beslutet", "bestämt", "bestämdes", "decide", "decided", "decision", "decisions", "valde"},
    "goal": {"goal", "goals", "mål", "målen", "målet", "målbild", "objective"},
    "deadline": {"kommande", "lansering", "date", "datum", "deadline", "deadlines", "due", "när", "tidsfrist", "tidsfrister", "when"},
    "preference": {"föredrar", "prefer", "preference", "preferences", "preferens", "preferenser"},
    "lesson": {"learned", "lesson", "lessons", "lärdom", "lärdomar", "lärt", "misstag"},
}
LEXICAL_CATEGORY_CUES = {"lansering"}
CATEGORY_CUE_WORDS = {
    cue
    for cues in CATEGORY_CUES.values()
    for cue in cues
    if cue not in LEXICAL_CATEGORY_CUES
}
SYNONYM_GROUPS = (
    ("databas", "database"),
    ("lanser", "lansera", "lansering", "launch"),
)
SWEDISH_SUFFIXES = (
    "heterna", "ornas", "ernas", "arnas", "elser", "heten", "anden", "andet",
    "ande", "ende", "orna", "erna", "arna", "ades", "ade", "ens", "ets", "ers",
    "ats", "ar", "er", "en", "et",
)


def _is_word_char(ch: str) -> bool:
    category = unicodedata.category(ch)
    return category.startswith("L") or category.startswith("N")


def _is_separator(ch: str) -> bool:
    if ch == "_":
        return True
    category = unicodedata.category(ch)
    return category.startswith("P") or category.startswith("S")


def normalized_tokens(text: str) -> list[str]:
    folded = unicodedata.normalize("NFKC", text).lower()
    cleaned = "".join(" " if _is_separator(ch) else ch for ch in folded)
    return [token for token in cleaned.split() if token]


def stem_swedish_token(token: str) -> str:
    for suffix in SWEDISH_SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 4:
            return token[: -len(suffix)]
    return token


def keyword_forms(keyword: str) -> set[str]:
    stem = stem_swedish_token(keyword)
    synonyms = next(
        (group for group in SYNONYM_GROUPS if any(stem_swedish_token(candidate) == stem for candidate in group)),
        None,
    )
    forms = {stem}
    if synonyms:
        forms.update(stem_swedish_token(candidate) for candidate in synonyms)
    return forms


def text_stems(text: str) -> list[str]:
    return [stem_swedish_token(token) for token in normalized_tokens(text)]


def form_matches_token(form: str, token: str) -> bool:
    return form == token or (len(form) >= 7 and token.startswith(form))


def keyword_matches(forms: set[str], tokens: list[str]) -> bool:
    return any(form_matches_token(form, token) for form in forms for token in tokens)


def extract_keywords(prompt: str) -> list[str]:
    if not isinstance(prompt, str):
        return []
    seen: list[str] = []
    for token in normalized_tokens(prompt):
        if token in seen:
            continue
        if (len(token) >= 3 or token.isdigit()) and token not in STOP_WORDS and token not in CATEGORY_CUE_WORDS:
            seen.append(token)
    return seen


def category_cues(prompt: str) -> set[str]:
    # Keep first-seen order. A Python set can reshuffle short Unicode tokens,
    # and the phrase check below depends on that order.
    ordered = list(dict.fromkeys(normalized_tokens(prompt)))
    tokens = set(ordered)
    cues = {category for category, words in CATEGORY_CUES.items() if tokens & words}
    normalized = " ".join(ordered)
    if "vad är på gång" in normalized or "what is coming up" in normalized:
        cues.add("deadline")
    return cues


def duplicate_key(row: dict) -> str:
    return "\u0000".join(
        [
            unicodedata.normalize("NFKC", row["project"]).lower(),
            unicodedata.normalize("NFKC", row["title"]).lower(),
            row["category"],
        ]
    )


def newest_by_identity(rows: list[dict]) -> tuple[list[dict], dict[str, int]]:
    newest: dict[str, dict] = {}
    counts: dict[str, int] = {}
    for row in rows:
        key = duplicate_key(row)
        current = newest.get(key)
        if current is None:
            newest[key] = row
            counts[key] = 0
            continue
        counts[key] = counts.get(key, 0) + 1
        if row["updated_at"] > current["updated_at"] or (
            row["updated_at"] == current["updated_at"] and row["id"] > current["id"]
        ):
            newest[key] = row
    return list(newest.values()), counts


def _word_matches(content: str) -> list[tuple[int, int, str]]:
    spans = []
    start = None
    for index, ch in enumerate(content):
        if _is_word_char(ch):
            if start is None:
                start = index
        elif start is not None:
            spans.append((start, index, content[start:index]))
            start = None
    if start is not None:
        spans.append((start, len(content), content[start:]))
    return spans


def content_match_spans(content: str, terms: list[set[str]]) -> list[dict]:
    spans = []
    for start, end, word in _word_matches(content):
        token = stem_swedish_token(word.lower())
        for term, forms in enumerate(terms):
            if any(form_matches_token(form, token) for form in forms):
                spans.append({"start": start, "end": end, "term": term})
    return spans


def best_match_span(spans: list[dict]) -> dict | None:
    best = None
    for span in spans:
        center = (span["start"] + span["end"]) / 2
        nearby = [
            candidate
            for candidate in spans
            if abs((candidate["start"] + candidate["end"]) / 2 - center) <= CONTEXT_SNIPPET_LIMIT / 2
        ]
        score = len({candidate["term"] for candidate in nearby}) * 10 + len(nearby)
        if best is None or score > best["score"]:
            best = {"span": span, "score": score}
    return None if best is None else best["span"]


def escape_user_text(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;")


def _is_nonspace(ch: str) -> bool:
    return bool(ch) and not ch.isspace()


def snap_to_word_boundaries(content: str, left: int, right: int, match: dict | None) -> tuple[int, int]:
    required_start = match["start"] if match else right
    required_end = match["end"] if match else 0
    while (
        left > 0
        and left < required_start
        and _is_nonspace(content[left - 1] if left - 1 < len(content) else "")
        and _is_nonspace(content[left] if left < len(content) else "")
    ):
        left += 1
    while left < required_start and left < len(content) and content[left].isspace():
        left += 1
    while (
        right < len(content)
        and right > required_end
        and _is_nonspace(content[right - 1] if right - 1 >= 0 else "")
        and _is_nonspace(content[right] if right < len(content) else "")
    ):
        right -= 1
    while right > required_end and right > 0 and content[right - 1].isspace():
        right -= 1
    return left, right


def escaped_window(content: str, match: dict | None) -> str:
    if not content:
        return ""

    def value(start: int, end: int) -> str:
        body = escape_user_text(content[start:end].strip())
        prefix = "…" if start > 0 else ""
        suffix = "…" if end < len(content) else ""
        return f"{prefix}{body}{suffix}"

    if match is None:
        left = 0
        right = 0
        while right < len(content) and len(value(0, right + 1)) <= CONTEXT_SNIPPET_LIMIT:
            right += 1
        snapped_left, snapped_right = snap_to_word_boundaries(content, 0, right, None)
        return value(snapped_left, snapped_right if snapped_right > 0 else right)

    left = match["start"]
    right = match["end"]
    while len(value(left, right)) > CONTEXT_SNIPPET_LIMIT and right > left:
        right -= 1
    left_blocked = left == 0
    right_blocked = right == len(content)
    expand_left = True
    while not left_blocked or not right_blocked:
        try_left = expand_left and not left_blocked
        next_left = max(0, left - 1) if try_left else left
        next_right = min(len(content), right + 1) if not try_left and not right_blocked else right
        if len(value(next_left, next_right)) <= CONTEXT_SNIPPET_LIMIT:
            left = next_left
            right = next_right
            if left == 0:
                left_blocked = True
            if right == len(content):
                right_blocked = True
        elif try_left:
            left_blocked = True
        else:
            right_blocked = True
        expand_left = not expand_left
    snapped_left, snapped_right = snap_to_word_boundaries(content, left, right, match)
    return value(snapped_left, snapped_right)


def snippet(content: str, terms: list[set[str]]) -> str:
    compact = re.sub(r"\s+", " ", content.strip())
    span = best_match_span(content_match_spans(compact, terms))
    return escaped_window(compact, span)


def context_item(row: dict, terms: list[set[str]]) -> dict:
    return {
        "id": row["id"],
        "project": row["project"],
        "category": row["category"],
        "title": row["title"],
        "snippet": snippet(row["content"], terms),
        "updated_at": row["updated_at"],
        "source": "user_memory",
    }


def context_result(
    keywords: list[str],
    project: str | None,
    projects: list[str] | None,
    items: list[dict],
    omitted_duplicate: int,
    omitted_capped: int,
) -> dict:
    result: dict = {"keywords": keywords}
    if project is not None:
        result["project"] = project
    if projects is not None:
        result["projects"] = projects
    result["items"] = items
    result["omitted"] = omitted_duplicate + omitted_capped
    result["omitted_duplicate"] = omitted_duplicate
    result["omitted_capped"] = omitted_capped
    return result


def output_keywords(
    keywords: list[str],
    project: str | None,
    projects: list[str] | None,
    omitted_duplicate: int,
    omitted_capped: int,
) -> list[str]:
    packed: list[str] = []
    for keyword in keywords:
        if len(packed) >= 32:
            break
        nxt = [*packed, keyword]
        if len(js_json(context_result(nxt, project, projects, [], omitted_duplicate, omitted_capped))) > 1000:
            break
        packed.append(keyword)
    return packed


def compact_projects(rows: list[dict]) -> list[str]:
    newest: dict[str, dict] = {}
    for row in rows:
        key = unicodedata.normalize("NFKC", row["project"]).lower()
        current = newest.get(key)
        if current is None or row["updated_at"] > current["updated_at"]:
            newest[key] = row
    ordered = sorted(newest.values(), key=lambda row: row["updated_at"], reverse=True)
    projects: list[str] = []
    for row in ordered:
        if len(projects) >= 8:
            break
        nxt = [*projects, row["project"]]
        if len(js_json(nxt)) > 500:
            break
        projects.append(row["project"])
    return projects


def clean_search_query(query: str) -> str:
    return re.sub(r"[%_,()]", " ", query).strip()


def js_round(value: float) -> int:
    if value >= 0:
        return math.floor(value + 0.5)
    return math.ceil(value - 0.5)


async def _maybe(value: Any) -> Any:
    if hasattr(value, "__await__"):
        return await value
    return value


class MemoryApi:
    def __init__(self, store: Any, brain: Any | None = None) -> None:
        self.store = store
        self.brain = brain

    async def save_memory(self, user_id: str, memory: dict) -> dict:
        return await save_memory(user_id, memory, self.store)

    async def search_memory(self, user_id: str, search: dict) -> dict:
        return await search_memory(user_id, search, self.store)

    async def search_in_space(self, user_id: str, space_id: str, search: dict) -> dict:
        spaces = getattr(self.brain, "spaces", None) if self.brain else None
        if spaces is None:
            return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.")
        return await search_in_space(user_id, space_id, search, self.store, spaces)

    async def get_context(self, user_id: str, context: dict) -> dict:
        return await get_context(user_id, context, self.store, self.brain)

    async def update_memory(self, user_id: str, memory: dict) -> dict:
        return await update_memory(user_id, memory, self.store, self.brain)

    async def delete_memory(self, user_id: str, memory_id: str) -> dict:
        spaces = getattr(self.brain, "spaces", None) if self.brain else None
        return await delete_memory(user_id, memory_id, self.store, spaces)

    async def save_lesson(self, user_id: str, memory: dict) -> dict:
        return await save_memory(user_id, {**memory, "category": "lesson"}, self.store)

    async def save_brief(self, user_id: str, brief: dict) -> dict:
        return await save_brief(user_id, brief, self.store, self.brain)

    async def save_dashboard_memory(self, user_id: str, memory: dict, space_id: str) -> dict:
        return await save_dashboard_memory(user_id, memory, space_id, self.store, self.brain)

    async def list_versions(self, user_id: str, memory_id: str) -> dict:
        spaces = getattr(self.brain, "spaces", None) if self.brain else None
        return await list_memory_versions(user_id, memory_id, self.store, spaces)

    async def list_deletions(self, user_id: str, space_id: str) -> dict:
        spaces = getattr(self.brain, "spaces", None) if self.brain else None
        return await list_deletions(user_id, space_id, self.store, spaces)


def create_memory_api(store: Any, brain: Any | None = None) -> MemoryApi:
    return MemoryApi(store, brain)


async def save_memory(user_id: str, memory: dict, store: Any) -> dict:
    parsed = validate_memory_input(memory)
    if "error" in parsed:
        return parsed
    inserted = await _maybe(store.insert(user_id, parsed["data"]))
    if inserted["kind"] == "created":
        return {"data": inserted["row"]}
    if inserted["kind"] == "duplicate":
        existing = await _maybe(store.find_identical(user_id, parsed["data"]))
        if existing:
            return {"data": existing}
        try:
            rows = await _maybe(store.list_by_user(user_id))
        except Exception:
            return fail("SAVE_FAILED", "Kunde inte spara minnet.")
        near = next(
            (
                row
                for row in rows
                if row["project"] == parsed["data"]["project"]
                and row["category"] == parsed["data"]["category"]
                and row["title"] == parsed["data"]["title"]
            ),
            None,
        )
        if near is not None:
            updated = await _maybe(store.update(user_id, near["id"], parsed["data"]))
            if updated["kind"] == "updated":
                return {"data": updated["row"]}
    return fail("SAVE_FAILED", "Kunde inte spara minnet.")


def _filter_rows(rows: list[dict], parsed: dict) -> list[dict]:
    data = parsed["data"]
    if data.get("project"):
        rows = [row for row in rows if row["project"] == data["project"]]
    if data.get("category"):
        rows = [row for row in rows if row["category"] == data["category"]]
    if data.get("query"):
        query = clean_search_query(data["query"])
        if query:
            needle = query.lower()
            rows = [row for row in rows if needle in row["title"].lower() or needle in row["content"].lower()]
    rows = sorted(rows, key=lambda row: row["updated_at"], reverse=True)
    offset = data["offset"]
    return rows[offset : offset + PAGE_SIZE]


async def search_memory(user_id: str, search: dict, store: Any) -> dict:
    parsed = validate_search_input(search)
    if "error" in parsed:
        return parsed
    try:
        rows = await _maybe(store.list_by_user(user_id))
    except Exception:
        return fail("SEARCH_FAILED", "Kunde inte söka minnen.")
    return {"data": _filter_rows(rows, parsed)}


async def load_context_rows(user_id: str, store: Any, brain: Any | None) -> tuple[list[dict], list[str] | None]:
    spaces = getattr(brain, "spaces", None) if brain else None
    list_by_spaces = getattr(store, "list_by_spaces", None)
    if spaces is not None and list_by_spaces is not None:
        try:
            space_ids = await _maybe(spaces.readable_space_ids(user_id))
            return await _maybe(list_by_spaces(user_id, space_ids)), space_ids
        except Exception:
            return await _maybe(store.list_by_user(user_id)), None
    return await _maybe(store.list_by_user(user_id)), None


async def get_context(user_id: str, context: dict | None, store: Any, brain: Any | None = None) -> dict:
    raw_prompt = context.get("prompt") if isinstance(context, dict) and isinstance(context.get("prompt"), str) else ""
    prompt = raw_prompt.strip()
    if len(prompt) < 1 or len(raw_prompt) > 8000:
        return fail("INVALID_PROMPT", "prompt måste vara 1–8 000 tecken.")
    try:
        rows, space_ids = await load_context_rows(user_id, store, brain)
    except Exception:
        return fail("SEARCH_FAILED", "Kunde inte söka minnen.")

    projects = compact_projects(rows) if context is not None and "project" not in context else None
    response_project = context.get("project") if context else None
    project_filter = None
    if context is not None and "project" in context:
        project_filter = project_key(str(context.get("project") or ""))
        spelled = next((row for row in rows if project_key(row["project"]) == project_filter), None)
        if spelled is not None:
            response_project = spelled["project"]
        rows = [row for row in rows if project_key(row["project"]) == project_filter]

    keywords = extract_keywords(prompt)
    cues = category_cues(prompt)
    terms = [keyword_forms(keyword) for keyword in keywords]
    unique_rows, duplicate_counts = newest_by_identity(rows)
    scored = []
    for row in unique_rows:
        title = text_stems(row["title"])
        content = text_stems(row["content"])
        project = text_stems(row["project"])
        title_hits = 0
        content_hits = 0
        project_hits = 0
        non_entity_matches = 0
        entity_terms = [keyword_matches(forms, project) for forms in terms]
        has_non_entity = any(not is_entity for is_entity in entity_terms)
        for index, forms in enumerate(terms):
            matched = False
            if keyword_matches(forms, title):
                title_hits += 1
                matched = True
            elif keyword_matches(forms, content):
                content_hits += 1
                matched = True
            elif entity_terms[index]:
                project_hits += 1
                matched = True
            if matched and not entity_terms[index]:
                non_entity_matches += 1
        matches = title_hits + content_hits + project_hits
        coverage = 0 if not terms else matches / len(terms)
        has_required = (not has_non_entity) or non_entity_matches > 0
        lexical_score = (
            title_hits * 60 + content_hits * 25 + project_hits * 5 + non_entity_matches * 10 + js_round(coverage * 12)
            if has_required
            else 0
        )
        category_boost = 8 if lexical_score > 0 and row["category"] in cues else 0
        scored.append(
            {
                "row": row,
                "key": duplicate_key(row),
                "lexical_score": lexical_score,
                "score": lexical_score + category_boost,
            }
        )
    has_lexical = any(candidate["lexical_score"] > 0 for candidate in scored)
    ranked = []
    for candidate in scored:
        score = candidate["score"] + (20 if not has_lexical and candidate["row"]["category"] in cues else 0)
        if score > 0:
            ranked.append({**candidate, "score": score})
    ranked.sort(key=rank_sort_key)

    embedding = getattr(brain, "embedding", None) if brain else None
    if embedding is not None and space_ids is not None and getattr(store, "list_nearest", None) is not None:
        try:
            ranked = await apply_vector_ranking(
                user_id=user_id,
                prompt=prompt,
                space_ids=space_ids,
                store=store,
                embedding=embedding,
                ranked=ranked,
            )
        except Exception:
            # Missing embedding column, or a failed embed call, keeps lexical ranking.
            pass

    if project_filter is not None:
        # Nearest neighbors are not limited to the requested project. Drop them
        # after ranking so a different name cannot ride in on a similar vector.
        ranked = [candidate for candidate in ranked if project_key(candidate["row"]["project"]) == project_filter]

    duplicate_omitted = sum(duplicate_counts.get(candidate["key"], 0) for candidate in ranked)
    packed_keywords = output_keywords(keywords, response_project, projects, duplicate_omitted, len(ranked))
    items: list[dict] = []
    for candidate in ranked:
        if len(items) >= CONTEXT_ITEM_LIMIT:
            break
        item = context_item(candidate["row"], terms)
        nxt = [*items, item]
        candidate_body = context_result(
            packed_keywords,
            response_project,
            projects,
            nxt,
            duplicate_omitted,
            len(ranked) - len(nxt),
        )
        if len(js_json(candidate_body)) <= CONTEXT_JSON_LIMIT:
            items.append(item)
    packed = context_result(
        packed_keywords,
        response_project,
        projects,
        items,
        duplicate_omitted,
        len(ranked) - len(items),
    )
    written = await _written_from_prompt(
        user_id,
        prompt,
        context.get("project") if context and "project" in context else None,
        space_ids,
        store,
        brain,
    )
    return {"data": {**packed, "written": written}}


async def _written_from_prompt(
    user_id: str,
    prompt: str,
    project: str | None,
    space_ids: list[str] | None,
    store: Any,
    brain: Any | None,
) -> list[dict]:
    formulator = getattr(brain, "formulator", None) if brain else None
    if formulator is None:
        return []
    try:
        existing = await recent_identities(user_id, space_ids or [], store)
        drafts = await _maybe(
            formulator.formulate(
                {"source": "get_context", "text": prompt, "project": project, "existing": existing}
            )
        )
        return await persist_drafts(
            user_id=user_id,
            drafts=drafts,
            text=prompt,
            project=project,
            store=store,
            brain=brain,
            limit=SAVED_ROW_LIMIT,
        )
    except Exception:
        return []


def _brief_error(brief: dict) -> dict | None:
    raw = brief.get("brief")
    text = raw.strip() if isinstance(raw, str) else ""
    if len(text) < 1 or len(text) > 10_000:
        return fail("INVALID_CONTENT", "brief måste vara 1–10 000 tecken.")
    return None


async def save_brief(user_id: str, brief: dict, store: Any, brain: Any | None = None) -> dict:
    invalid = _brief_error(brief)
    if invalid:
        return invalid
    formulator = getattr(brain, "formulator", None) if brain else None
    if formulator is None:
        return fail("FORMULATE_FAILED", "Kunde inte tolka minnet.")
    text = (brief.get("brief") or "").strip()
    spaces = getattr(brain, "spaces", None)
    try:
        space_ids = await _maybe(spaces.readable_space_ids(user_id)) if spaces is not None else []
    except Exception:
        space_ids = []
    prompt = brief.get("prompt") or ""
    joined = "\n".join(part for part in (text, prompt) if part)
    listed: list[dict] = []
    list_spaces = getattr(spaces, "list_spaces", None) if spaces is not None else None
    if list_spaces is not None:
        try:
            listed = await _maybe(list_spaces(user_id)) or []
        except Exception:
            listed = []
    if shared_save_plan(joined, listed)["mode"] == "ask":
        return fail("TEAM_CHOICE", "Vilket team ska minnet sparas i?")
    try:
        existing = await recent_identities(user_id, space_ids, store)
        payload = {
            "source": "save_memory",
            "text": text,
            "existing": existing,
        }
        if "project" in brief:
            payload["project"] = brief.get("project")
        if "prompt" in brief:
            payload["prompt"] = brief.get("prompt")
        drafts = await _maybe(formulator.formulate(payload))
    except Exception:
        return fail("FORMULATE_FAILED", "Kunde inte tolka minnet.")
    items = await persist_drafts(
        user_id=user_id,
        drafts=drafts,
        text=joined,
        project=brief.get("project"),
        store=store,
        brain=brain,
        limit=SAVED_ROW_LIMIT,
    )
    return {"data": {"items": items}}


async def save_dashboard_memory(user_id: str, memory: dict, space_id: str, store: Any, brain: Any | None = None) -> dict:
    spaces = getattr(brain, "spaces", None) if brain else None
    if spaces is None:
        return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.")
    try:
        member = await _maybe(spaces.is_member(user_id, space_id))
    except Exception:
        member = False
    if not member:
        return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.")
    if getattr(store, "upsert_subject", None) is None:
        return fail("SAVE_FAILED", "Kunde inte spara minnet.")
    parsed = validate_memory_input(memory)
    if "error" in parsed:
        return parsed
    try:
        list_by_spaces = getattr(store, "list_by_spaces", None)
        if list_by_spaces is not None:
            rows = await _maybe(list_by_spaces(user_id, [space_id]))
        else:
            rows = await _maybe(store.list_by_user(user_id))
        projects = [row["project"] for row in rows]
    except Exception:
        projects = []
    project = canonical_project(parsed["data"]["project"], projects)
    saved = await _maybe(
        store.upsert_subject(
            user_id,
            {
                "space_id": space_id,
                "project": project,
                "category": parsed["data"]["category"],
                "title": parsed["data"]["title"],
                "content": parsed["data"]["content"],
                "source": "dashboard",
            },
        )
    )
    if saved["kind"] == "failed":
        if saved.get("code") == "DUPLICATE_TITLE":
            return fail("DUPLICATE_TITLE", saved["message"])
        return fail("SAVE_FAILED", "Kunde inte spara minnet.")
    await attach_embedding(store, getattr(brain, "embedding", None), saved["row"])
    return {"data": saved["row"]}


async def search_in_space(user_id: str, space_id: str, search: dict, store: Any, spaces: Any) -> dict:
    try:
        member = await _maybe(spaces.is_member(user_id, space_id))
    except Exception:
        member = False
    if not member:
        return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.")
    if getattr(store, "list_by_spaces", None) is None:
        return fail("SEARCH_FAILED", "Kunde inte söka minnen.")
    parsed = validate_search_input(search)
    if "error" in parsed:
        return parsed
    try:
        rows = await _maybe(store.list_by_spaces(user_id, [space_id]))
    except Exception:
        return fail("SEARCH_FAILED", "Kunde inte söka minnen.")
    return {"data": _filter_rows(rows, parsed)}


async def list_memory_versions(user_id: str, memory_id: str, store: Any, spaces: Any | None = None) -> dict:
    checked = validate_memory_id(memory_id)
    if "error" in checked:
        return checked
    if getattr(store, "list_versions", None) is None or getattr(store, "space_of", None) is None:
        return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.")
    versions = await _maybe(store.list_versions(checked["data"]))
    live_space = await _maybe(store.space_of(checked["data"]))
    version_space = next((version["space_id"] for version in versions or [] if version.get("space_id")), None)
    space_id = live_space or version_space
    if not space_id or versions is None:
        return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.")
    if spaces is not None:
        member = await _maybe(spaces.is_member(user_id, space_id))
        if not member:
            return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.")
    return {
        "data": [
            {
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
            for version in versions
        ]
    }


async def list_deletions(user_id: str, space_id: str, store: Any, spaces: Any | None = None) -> dict:
    if getattr(store, "list_deletions", None) is None:
        return {"data": []}
    if spaces is not None:
        try:
            member = await _maybe(spaces.is_member(user_id, space_id))
        except Exception:
            member = False
        if not member:
            return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.")
    rows = await _maybe(store.list_deletions(space_id))
    return {"data": keep_recent_deletions(rows or [])}


async def _load_owned(user_id: str, memory_id: str, store: Any, spaces: Any | None) -> dict:
    if spaces is not None and getattr(store, "space_of", None) is not None and getattr(store, "list_by_spaces", None) is not None:
        space_id = await _maybe(store.space_of(memory_id))
        if space_id:
            member = await _maybe(spaces.is_member(user_id, space_id))
            if not member:
                return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.")
            rows = await _maybe(store.list_by_spaces(user_id, [space_id]))
            row = next((candidate for candidate in rows if candidate["id"] == memory_id), None)
            if row is None:
                return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.")
            return {"data": row}
    try:
        rows = await _maybe(store.list_by_user(user_id))
    except Exception:
        return fail("UPDATE_FAILED", "Kunde inte uppdatera minnet.")
    row = next((candidate for candidate in rows if candidate["id"] == memory_id), None)
    if row is None:
        return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.")
    return {"data": row}


async def update_memory(user_id: str, memory: dict, store: Any, brain: Any | None = None) -> dict:
    checked = validate_memory_id(str(memory.get("id") or ""))
    if "error" in checked:
        return checked
    parsed = validate_memory_input(memory)
    if "error" in parsed:
        return parsed
    spaces = getattr(brain, "spaces", None) if brain else None
    loaded = await _load_owned(user_id, checked["data"], store, spaces)
    if "error" in loaded:
        return loaded
    existing = loaded["data"]
    project = (
        existing["project"]
        if project_key(parsed["data"]["project"]) == project_key(existing["project"])
        else parsed["data"]["project"]
    )
    fields = {**parsed["data"], "project": project}
    if existing["project"] != fields["project"] and memory.get("allow_project_change") is not True:
        return fail("PROJECT_CHANGE_REQUIRES_FLAG", "Projektbyte kräver allow_project_change: true.")
    if fields["category"] == "lesson" and existing["category"] != "lesson":
        return fail(
            "LESSON_CATEGORY_REQUIRES_TOOL",
            "Ett vanligt minne kan inte ändras till lesson; använd lesson_memory.",
        )
    in_space = bool(spaces and getattr(store, "space_of", None) and await _maybe(store.space_of(checked["data"])))
    if in_space and getattr(store, "update_by_id", None) is not None:
        updated = await _maybe(store.update_by_id(checked["data"], fields, user_id))
    else:
        updated = await _maybe(store.update(user_id, checked["data"], fields))
    if updated["kind"] == "updated":
        text_changed = existing["title"] != fields["title"] or existing["content"] != fields["content"]
        has_embedding = getattr(store, "has_embedding", None)
        missing_vector = has_embedding is not None and not await _maybe(has_embedding(updated["row"]["id"]))
        if text_changed or missing_vector:
            await attach_embedding(store, getattr(brain, "embedding", None) if brain else None, updated["row"])
        return {"data": updated["row"]}
    if updated["kind"] == "missing":
        return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.")
    if updated["kind"] == "failed" and updated.get("code") == "DUPLICATE_TITLE":
        return fail("DUPLICATE_TITLE", updated["message"])
    return fail("UPDATE_FAILED", "Kunde inte uppdatera minnet.")


async def delete_memory(user_id: str, memory_id: str, store: Any, spaces: Any | None = None) -> dict:
    checked = validate_memory_id(memory_id)
    if "error" in checked:
        return checked
    if spaces is not None and getattr(store, "space_of", None) is not None and getattr(store, "remove_by_id", None) is not None:
        space_id = await _maybe(store.space_of(checked["data"]))
        if space_id:
            member = await _maybe(spaces.is_member(user_id, space_id))
            if not member:
                return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.")
            removed = await _maybe(store.remove_by_id(checked["data"], user_id))
            if removed["kind"] == "deleted":
                return {"data": {"success": True}}
            if removed["kind"] == "missing":
                return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.")
            return fail("DELETE_FAILED", "Kunde inte radera minnet.")
    removed = await _maybe(store.remove(user_id, checked["data"]))
    if removed["kind"] == "deleted":
        return {"data": {"success": True}}
    if removed["kind"] == "missing":
        return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.")
    return fail("DELETE_FAILED", "Kunde inte radera minnet.")
