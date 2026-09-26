import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MEMORY_INSTRUCTIONS } from "../lib/mcp-instructions";
import {
  createEmbeddingClient,
  createFormulatorClient,
  embeddingRequest,
  EMBEDDING_DIMENSIONS,
  formulatorRequest,
} from "../lib/memory-clients";
import { getMemories, getMemoryVersions, postMemory, patchMemory } from "../lib/memory-http";
import { createInMemoryStore } from "../vendor/memory/src/in-memory";
import type { EmbeddingClient, MemoryFormulator, SpaceAccess } from "../vendor/memory/src/types";

const SPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const mcpRouteSrc = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");

function memberSpaces(members: Record<string, string[]>): SpaceAccess {
  return {
    async readableSpaceIds(userId) {
      return members[userId] ?? [];
    },
    async spaceFor(kind) {
      return kind === "personal" ? SPACE : OTHER;
    },
    async isMember(userId, spaceId) {
      return (members[userId] ?? []).includes(spaceId);
    },
  };
}

function embedder(calls: string[]): EmbeddingClient {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(text) {
      calls.push(text);
      return [1, 0, 0];
    },
  };
}

describe("v1.2 brain HTTP and clients", () => {
  it("lists exactly the two MCP tools, including the public handler", () => {
    const names = [...mcpRouteSrc.matchAll(/server\.tool\(\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(names, ["get_context", "save_memory"]);
    assert.equal(mcpRouteSrc.match(/createMcpHandler\(/g)?.length, 1);
    assert.match(mcpRouteSrc, /return withChatGptToolList\(await handler\(req\)\)/);
    assert.doesNotMatch(MEMORY_INSTRUCTIONS, /update_memory|lesson_memory|search_memory/);
  });

  it("builds one temperature-0 formulator call and one embedding call from env", async () => {
    const formulated = formulatorRequest("claude-sonnet", {
      source: "save_memory",
      text: "brief",
      existing: [],
    });
    assert.equal(formulated.temperature, 0);
    assert.deepEqual(formulated.thinking, { type: "disabled" });
    assert.equal(formulated.tools.length, 1);
    assert.equal(formulated.model, "claude-sonnet");

    const embedded = embeddingRequest("text-embedding-3-large", "Titel\nInnehåll");
    assert.equal(embedded.model, "text-embedding-3-large");
    assert.equal(embedded.dimensions, 3072);
    assert.equal(embedded.input, "Titel\nInnehåll");

    assert.equal(createEmbeddingClient({}), null);
    assert.equal(createFormulatorClient({}), null);

    let embedCalls = 0;
    const embedding = createEmbeddingClient(
      { OPENAI_API_KEY: "test-key", MEMORY_EMBEDDING_MODEL: "text-embedding-3-large" },
      async (_url, init) => {
        embedCalls += 1;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, "text-embedding-3-large");
        assert.equal(body.dimensions, 3072);
        return new Response(JSON.stringify({ data: [{ embedding: [0.2] }] }), { status: 200 });
      },
    );
    assert.ok(embedding);
    assert.deepEqual(await embedding.embed("Titel\nInnehåll"), [0.2]);
    assert.equal(embedCalls, 1);

    let formulateCalls = 0;
    const formulator = createFormulatorClient(
      { ANTHROPIC_API_KEY: "test-key", MEMORY_FORMULATOR_MODEL: "claude-sonnet" },
      async (_url, init) => {
        formulateCalls += 1;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.temperature, 0);
        assert.deepEqual(body.thinking, { type: "disabled" });
        assert.equal(body.model, "claude-sonnet");
        return new Response(
          JSON.stringify({
            content: [{ type: "tool_use", name: "record_memories", input: { memories: [] } }],
          }),
          { status: 200 },
        );
      },
    );
    assert.ok(formulator);
    assert.deepEqual(
      await formulator.formulate({ source: "get_context", text: "hej", existing: [] }),
      [],
    );
    assert.equal(formulateCalls, 1);
  });

  it("POST /api/memories embeds the four fields and does not formulate", async () => {
    const store = createInMemoryStore();
    const embedded: string[] = [];
    let formulated = 0;
    const formulator: MemoryFormulator = {
      async formulate() {
        formulated += 1;
        return [];
      },
    };
    const created = await postMemory(
      "user-a",
      {
        user_id: "user-b",
        space_id: SPACE,
        project: "Projekt A",
        category: "fact",
        title: "Titel",
        content: "Innehåll som ska ligga kvar.",
      },
      {
        store,
        spaces: memberSpaces({ "user-a": [SPACE] }),
        embedding: embedder(embedded),
        formulator,
      },
    );
    assert.equal(created.status, 201);
    assert.equal(formulated, 0);
    assert.deepEqual(embedded, ["Titel\nInnehåll som ska ligga kvar."]);
    const row = store.snapshot()[0];
    assert.equal(row?.user_id, "user-a");
    assert.equal(row?.space_id, SPACE);
    assert.equal(row?.source, "dashboard");
    assert.ok(row?.embedding);

    const denied = await postMemory(
      "user-b",
      {
        user_id: "user-a",
        space_id: SPACE,
        project: "Projekt A",
        category: "fact",
        title: "Annan",
        content: "Får inte in.",
      },
      { store, spaces: memberSpaces({ "user-a": [SPACE] }), embedding: embedder([]), formulator },
    );
    assert.equal(denied.status, 403);
    assert.equal((denied.body as { error: { code: string } }).error.code, "FORBIDDEN");
    assert.equal(store.snapshot().length, 1);
    assert.equal(formulated, 0);
  });

  it("GET stays lexical inside the space and ignores a client user_id", async () => {
    const store = createInMemoryStore();
    const deps = {
      store,
      spaces: memberSpaces({ "user-a": [SPACE, OTHER] }),
      embedding: embedder([]),
    };
    await postMemory(
      "user-a",
      {
        space_id: SPACE,
        project: "Projekt A",
        category: "fact",
        title: "Lansering",
        content: "Vi lanserar i oktober.",
      },
      deps,
    );
    await postMemory(
      "user-a",
      {
        space_id: OTHER,
        project: "Projekt A",
        category: "fact",
        title: "Annat utrymme",
        content: "Vi lanserar i oktober.",
      },
      deps,
    );
    let reads = 0;
    deps.embedding = {
      dimensions: 3072,
      async embed() {
        reads += 1;
        return [1];
      },
    };

    const listed = await getMemories(
      "user-a",
      new URL(`https://api.test/api/memories?space_id=${SPACE}&query=lanserar&user_id=user-b`),
      deps,
    );
    assert.equal(listed.status, 200);
    const rows = listed.body as Array<{ title: string }>;
    assert.deepEqual(rows.map((row) => row.title), ["Lansering"]);
    assert.equal(reads, 0);

    const outsider = await getMemories(
      "user-b",
      new URL(`https://api.test/api/memories?space_id=${SPACE}&user_id=user-a`),
      { store, spaces: memberSpaces({ "user-a": [SPACE] }) },
    );
    assert.equal(outsider.status, 403);
  });

  it("returns text versions newest first and without vectors", async () => {
    const store = createInMemoryStore();
    const deps = {
      store,
      spaces: memberSpaces({ "user-a": [SPACE] }),
      embedding: embedder([]),
    };
    const created = await postMemory(
      "user-a",
      {
        space_id: SPACE,
        project: "Projekt A",
        category: "decision",
        title: "Stack",
        content: "Första texten.",
      },
      deps,
    );
    assert.equal(created.status, 201);
    const id = (created.body as { id: string }).id;
    const second = await patchMemory(
      "user-a",
      id,
      { project: "Projekt A", category: "decision", title: "Stack", content: "Andra texten." },
      deps,
    );
    assert.equal(second.status, 200);
    const third = await patchMemory(
      "user-a",
      id,
      { project: "Projekt A", category: "decision", title: "Stack", content: "Tredje texten." },
      deps,
    );
    assert.equal(third.status, 200);
    assert.equal(store.snapshot()[0]?.source, "dashboard");

    const versions = await getMemoryVersions("user-a", id, deps);
    assert.equal(versions.status, 200);
    const body = versions.body as Array<{
      version_number: number;
      event: string;
      changed_by: string;
      content_before: string;
      content_after: string;
    }>;
    assert.deepEqual(
      body.map((version) => version.version_number),
      [2, 1],
    );
    assert.deepEqual(
      body.map((version) => version.content_before),
      ["Andra texten.", "Första texten."],
    );
    assert.deepEqual(
      body.map((version) => version.content_after),
      ["Tredje texten.", "Andra texten."],
    );
    assert.equal(body[0]?.event, "update");
    assert.equal(body[0]?.changed_by, "user-a");
    assert.equal(JSON.stringify(body).includes("embedding"), false);

    const denied = await getMemoryVersions("user-b", id, {
      store,
      spaces: memberSpaces({ "user-a": [SPACE] }),
    });
    assert.equal(denied.status, 403);
  });
});
