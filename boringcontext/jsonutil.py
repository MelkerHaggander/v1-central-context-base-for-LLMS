import json


def js_json(value: object) -> str:
    """JSON.stringify length is part of the context budget, so spacing and escaping must match."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
