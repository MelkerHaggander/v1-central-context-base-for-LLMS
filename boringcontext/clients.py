"""Embedding and formulation clients. Nothing is called unless both key and model are set."""

from __future__ import annotations

import json
import os

import httpx

EMBEDDING_DIMENSIONS = 3072

RECORD_TOOL = {
    "name": "record_memories",
    "description": "Extract durable memories. Return an empty list when nothing should be saved.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "memories": {
                "type": "array",
                "maxItems": 8,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "space": {"type": "string", "enum": ["personal", "shared"]},
                        "project": {"type": "string"},
                        "category": {
                            "type": "string",
                            "enum": ["fact", "decision", "goal", "deadline", "preference", "lesson"],
                        },
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["space", "project", "category", "title", "content"],
                },
            },
        },
        "required": ["memories"],
    },
}


def embedding_request(model: str, text: str) -> dict:
    return {"model": model, "input": text, "dimensions": EMBEDDING_DIMENSIONS}


def formulator_request(model: str, payload: dict) -> dict:
    return {
        "model": model,
        "max_tokens": 4096,
        "thinking": {"type": "disabled"},
        "system": " ".join(
            [
                "Extract only durable memories from the user text.",
                "Use personal by default. Asking to save to the team, shared memory, gemensamt, gemensamma, or gemensam för teamet selects shared when there is one team. With more than one team, do not guess a team.",
                "Never send a raw space id.",
                "Reuse an existing project, category and title when it is the same subject.",
                "Do not change category or project on an existing subject.",
                "A rule for how to answer next time is lesson, not preference.",
                "Do not store secrets or a secret filter the user rejected.",
                "An empty list is valid.",
                "Return at most 8 memories.",
            ]
        ),
        "messages": [
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "source": payload.get("source"),
                        "text": payload.get("text"),
                        "project": payload.get("project"),
                        "prompt": payload.get("prompt"),
                        "existing": payload.get("existing") or [],
                    }
                ),
            }
        ],
        "tools": [RECORD_TOOL],
        "tool_choice": {"type": "tool", "name": "record_memories"},
    }


def _read(env: dict[str, str | None], name: str) -> str:
    return (env.get(name) or "").strip()


class OpenAiEmbedding:
    def __init__(self, key: str, model: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.key = key
        self.model = model
        self.dimensions = EMBEDDING_DIMENSIONS
        self._transport = transport

    async def embed(self, text: str) -> list[float]:
        async with httpx.AsyncClient(transport=self._transport, timeout=30.0) as http:
            response = await http.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
                json=embedding_request(self.model, text),
            )
        if response.status_code >= 400:
            raise RuntimeError(f"embedding failed: {response.status_code}")
        body = response.json()
        vector = ((body.get("data") or [{}])[0]).get("embedding")
        if not isinstance(vector, list):
            raise RuntimeError("embedding missing")
        return vector


class AnthropicFormulator:
    def __init__(self, key: str, model: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.key = key
        self.model = model
        self._transport = transport

    async def formulate(self, payload: dict) -> list[dict]:
        async with httpx.AsyncClient(transport=self._transport, timeout=60.0) as http:
            response = await http.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=formulator_request(self.model, payload),
            )
        if response.status_code >= 400:
            raise RuntimeError(f"formulate failed: {response.status_code}")
        body = response.json()
        for block in body.get("content") or []:
            if block.get("type") == "tool_use" and block.get("name") == "record_memories":
                memories = (block.get("input") or {}).get("memories") or []
                return memories if isinstance(memories, list) else []
        return []


def create_embedding_client(
    env: dict[str, str | None] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> OpenAiEmbedding | None:
    source = env if env is not None else os.environ
    key = _read(source, "OPENAI_API_KEY")
    model = _read(source, "MEMORY_EMBEDDING_MODEL")
    if not key or not model:
        return None
    return OpenAiEmbedding(key, model, transport)


def create_formulator_client(
    env: dict[str, str | None] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AnthropicFormulator | None:
    source = env if env is not None else os.environ
    key = _read(source, "ANTHROPIC_API_KEY")
    model = _read(source, "MEMORY_FORMULATOR_MODEL")
    if not key or not model:
        return None
    return AnthropicFormulator(key, model, transport)
