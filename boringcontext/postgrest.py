"""Small PostgREST client for the logged-in user.

The anon or publishable key is only the `apikey`. Table calls send the user's
access token so Postgres sees `auth.uid()`. A service-role key is never read.
"""

from __future__ import annotations

import json
import re
from contextvars import ContextVar
from typing import Any
from urllib.parse import quote

import httpx

access_token: ContextVar[str | None] = ContextVar("boringcontext_access_token", default=None)

_SIMPLE = re.compile(r"^[A-Za-z0-9_@.+-]+$")


def _literal(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value)
    if _SIMPLE.fullmatch(text):
        return text
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


class PostgrestClient:
    def __init__(self, url: str, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.url = url.rstrip("/")
        self.api_key = api_key
        self._transport = transport

    def table(self, name: str) -> Query:
        return Query(self, name)

    async def rpc(self, fn: str, args: dict) -> dict:
        response = await self._request("POST", f"/rest/v1/rpc/{fn}", json_body=args)
        if response["error"]:
            return response
        return {"data": response["data"], "error": None}

    def _headers(self, *, prefer: str | None = None) -> dict[str, str]:
        token = access_token.get() or self.api_key
        headers = {
            "apikey": self.api_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: list[tuple[str, str]] | None = None,
        json_body: Any = None,
        prefer: str | None = None,
    ) -> dict:
        async with httpx.AsyncClient(transport=self._transport, timeout=20.0) as http:
            response = await http.request(
                method,
                f"{self.url}{path}",
                params=params,
                headers=self._headers(prefer=prefer),
                content=None if json_body is None else json.dumps(json_body),
            )
        if response.status_code >= 400:
            return {"data": None, "error": _error_body(response)}
        if response.status_code == 204 or not response.content:
            return {"data": None, "error": None}
        return {"data": response.json(), "error": None}


class Query:
    def __init__(self, client: PostgrestClient, table: str) -> None:
        self.client = client
        self.table = table
        self.method = "GET"
        self.payload: Any = None
        self.filters: list[tuple[str, str]] = []
        self.columns = "*"
        self._order: str | None = None
        self._limit: int | None = None
        self.cardinality = "many"

    def insert(self, fields: dict) -> Query:
        self.method = "POST"
        self.payload = fields
        return self

    def update(self, fields: dict) -> Query:
        self.method = "PATCH"
        self.payload = fields
        return self

    def delete(self) -> Query:
        self.method = "DELETE"
        return self

    def select(self, columns: str = "*") -> Query:
        self.columns = columns
        return self

    def eq(self, column: str, value: Any) -> Query:
        self.filters.append((column, f"eq.{_literal(value)}"))
        return self

    def in_(self, column: str, values: list) -> Query:
        inner = ",".join(_literal(value) for value in values)
        self.filters.append((column, f"in.({inner})"))
        return self

    def order(self, column: str, *, ascending: bool = True) -> Query:
        direction = "asc" if ascending else "desc"
        self._order = f"{column}.{direction}"
        return self

    def limit(self, count: int) -> Query:
        self._limit = count
        return self

    def single(self) -> Query:
        self.cardinality = "one"
        return self

    def maybe_single(self) -> Query:
        self.cardinality = "maybe"
        return self

    def __await__(self):
        return self._run().__await__()

    async def _run(self) -> dict:
        if any(op.startswith("in.(") and op == "in.()" for _column, op in self.filters):
            if self.cardinality == "many":
                return {"data": [], "error": None}
            return {"data": None, "error": None}

        params: list[tuple[str, str]] = [("select", self.columns)]
        params.extend(self.filters)
        if self._order:
            params.append(("order", self._order))
        if self._limit is not None:
            params.append(("limit", str(self._limit)))
        prefer = "return=representation" if self.method != "GET" else None
        result = await self.client._request(
            self.method,
            f"/rest/v1/{quote(self.table, safe='')}",
            params=params,
            json_body=self.payload,
            prefer=prefer,
        )
        if result["error"]:
            return result
        rows = result["data"]
        if not isinstance(rows, list):
            return {"data": rows, "error": None}
        if self.cardinality == "many":
            return {"data": rows, "error": None}
        if len(rows) == 1:
            return {"data": rows[0], "error": None}
        if len(rows) == 0:
            if self.cardinality == "maybe":
                return {"data": None, "error": None}
            return {"data": None, "error": {"code": "PGRST116", "message": "The result contains 0 rows"}}
        return {"data": None, "error": {"code": "PGRST116", "message": "The result contains more than one row"}}


def _error_body(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except Exception:
        body = None
    if isinstance(body, dict):
        return {
            "code": body.get("code"),
            "message": body.get("message") or response.reason_phrase,
        }
    return {"code": str(response.status_code), "message": response.reason_phrase or "request failed"}
