"""One brain call on stdin, one JSON result on stdout.

The Next.js MCP route uses this so formulation and ranking run in Python.
No socket is opened unless Supabase env is set.
"""

from __future__ import annotations

import asyncio
import json
import sys

from boringcontext.runtime import run_brain_call


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError:
        json.dump({"error": {"code": "INVALID_BODY", "message": "Ogiltig JSON."}}, sys.stdout)
        return
    if not isinstance(payload, dict):
        json.dump({"error": {"code": "INVALID_BODY", "message": "Ogiltig JSON."}}, sys.stdout)
        return
    result = asyncio.run(
        run_brain_call(
            str(payload.get("op") or ""),
            str(payload.get("user_id") or ""),
            payload.get("input") if isinstance(payload.get("input"), dict) else {},
            str(payload.get("bearer") or ""),
        )
    )
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
