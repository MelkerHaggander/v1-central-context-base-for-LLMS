import re

CATEGORIES = (
    "fact",
    "decision",
    "goal",
    "deadline",
    "preference",
    "lesson",
)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_NIL_UUID = "00000000-0000-0000-0000-000000000000"


def fail(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def _is_error(result: dict) -> bool:
    return "error" in result


def validate_memory_input(memory: dict) -> dict:
    project = str(memory.get("project") or "").strip()
    title = str(memory.get("title") or "").strip()
    content = str(memory.get("content") or "").strip()
    category = str(memory.get("category") or "").strip()

    if len(project) < 1 or len(project) > 100:
        return fail("INVALID_PROJECT", "project måste vara 1–100 tecken.")
    if len(title) < 1 or len(title) > 150:
        return fail("INVALID_TITLE", "title måste vara 1–150 tecken.")
    if len(content) < 1 or len(content) > 10_000:
        return fail("INVALID_CONTENT", "content måste vara 1–10 000 tecken.")
    if category not in CATEGORIES:
        return fail(
            "INVALID_CATEGORY",
            "category måste vara fact, decision, goal, deadline, preference eller lesson.",
        )
    return {
        "data": {
            "project": project,
            "category": category,
            "title": title,
            "content": content,
        }
    }


def _js_is_integer(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        return False
    return float(value).is_integer()


def validate_search_input(search: dict | None) -> dict:
    search = search or {}
    project = str(search.get("project") or "").strip()
    category = str(search.get("category") or "").strip()
    raw_query = search.get("query")
    query = str(raw_query).strip() if raw_query is not None else ""
    offset = 0 if search.get("offset") is None else search.get("offset")

    if project and len(project) > 100:
        return fail("INVALID_PROJECT", "project måste vara 1–100 tecken.")
    if category and category not in CATEGORIES:
        return fail(
            "INVALID_CATEGORY",
            "category måste vara fact, decision, goal, deadline, preference eller lesson.",
        )
    if not _js_is_integer(offset) or float(offset) < 0:
        return fail("INVALID_OFFSET", "offset måste vara ett heltal 0 eller högre.")

    data: dict = {"offset": int(offset)}
    if project:
        data["project"] = project
    if category:
        data["category"] = category
    if query:
        data["query"] = query
    return {"data": data}


def validate_memory_id(memory_id: str) -> dict:
    if memory_id == _NIL_UUID or not _UUID_RE.match(memory_id or ""):
        return fail("INVALID_ID", "id måste vara ett UUID.")
    return {"data": memory_id}
