import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryApi } from "@v1/memory";
import type { SpaceAccess } from "@v1/memory";
import { asMemory, createMcpTokenStore, type McpRpcClient } from "./mcp-memory-store";

test("MCP client expires_in stays below the 2038 unix cap so ChatGPT does not drop the connector", async () => {
  const { mcpClientExpiresIn } = await import("./sessions");
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = mcpClientExpiresIn(now);
  assert.ok(now + expiresIn <= 2_147_483_647);
  assert.notEqual(expiresIn, 2_147_483_647);
});

test("MCP memory rows use contract timestamps without milliseconds", () => {
  const row = asMemory({
    id: "550e8400-e29b-41d4-a716-446655440000",
    project: "Projekt A",
    category: "fact",
    title: "Timestamp",
    content: "MCP timestamps follow the package contract.",
    created_at: "2026-09-21T18:30:00.123Z",
    updated_at: "2026-09-21T18:31:02.987Z",
  });

  assert.ok(row);
  assert.equal(row.created_at, "2026-09-21T18:30:00Z");
  assert.equal(row.updated_at, "2026-09-21T18:31:02Z");
});

test("MCP token store saves a subject, embedding and nearest hit through access RPCs", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const spaceId = "11111111-1111-4111-8111-111111111111";
  const memoryId = "550e8400-e29b-41d4-a716-446655440000";
  const row = {
    id: memoryId,
    project: "Projekt A",
    category: "decision",
    title: "Stack",
    content: "Vi kör Postgres.",
    created_at: "2026-09-21T18:30:00Z",
    updated_at: "2026-09-21T18:30:00Z",
  };
  const supabase: McpRpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === "mcp_upsert_subject") return { data: { kind: "created", row }, error: null };
      if (fn === "mcp_set_embedding") return { data: null, error: null };
      if (fn === "mcp_list_nearest") return { data: [{ ...row, similarity: 0.91 }], error: null };
      if (fn === "mcp_list_by_spaces" || fn === "mcp_list_identities") {
        return { data: [], error: null };
      }
      return { data: null, error: { message: `unexpected ${fn}` } };
    },
  };
  const spaces: SpaceAccess = {
    async readableSpaceIds() {
      return [spaceId];
    },
    async spaceFor() {
      return spaceId;
    },
    async isMember() {
      return true;
    },
  };
  const store = createMcpTokenStore("opaque-token", supabase);
  const saved = await store.upsertSubject!("user-a", {
    spaceId,
    project: "Projekt A",
    category: "decision",
    title: "Stack",
    content: "Vi kör Postgres.",
    source: "brain",
  });
  assert.equal(saved.kind, "created");
  await store.setEmbedding!(memoryId, [0.2, 0.8]);
  const nearest = await store.listNearest!("user-a", [0.2, 0.8], [spaceId], 8);
  assert.equal(nearest[0]?.row.id, memoryId);
  assert.equal(nearest[0]?.similarity, 0.91);
  const removed = await store.remove("user-a", memoryId);
  assert.equal(removed.kind, "missing");

  assert.deepEqual(
    calls.map((call) => call.fn),
    ["mcp_upsert_subject", "mcp_set_embedding", "mcp_list_nearest"],
  );
  assert.equal(calls[0]?.args.p_access, "opaque-token");
  assert.equal(calls[0]?.args.p_space_id, spaceId);
  assert.equal(calls[0]?.args.p_source, "brain");
  assert.equal(calls[1]?.args.p_access, "opaque-token");
  assert.deepEqual(calls[1]?.args.p_embedding, [0.2, 0.8]);
  assert.equal(calls[2]?.args.p_access, "opaque-token");
  assert.deepEqual(calls[2]?.args.p_space_ids, [spaceId]);

  const memory = createMemoryApi(store, {
    spaces,
    embedding: {
      dimensions: 2,
      async embed() {
        return [0.2, 0.8];
      },
    },
    formulator: {
      async formulate() {
        return [
          {
            space: "personal",
            project: "Projekt A",
            category: "decision",
            title: "Stack",
            content: "Vi kör Postgres.",
          },
        ];
      },
    },
  });
  calls.length = 0;
  const written = await memory.saveBrief("user-a", { brief: "Kom ihåg stacken." });
  assert.ok("data" in written);
  assert.equal(written.data.items[0]?.space_id, spaceId);
  assert.equal(
    calls.some((call) => call.fn === "mcp_upsert_subject" && call.args.p_source === "brain"),
    true,
  );
  assert.equal(
    calls.some((call) => call.fn === "mcp_set_embedding" && call.args.p_access === "opaque-token"),
    true,
  );
});
