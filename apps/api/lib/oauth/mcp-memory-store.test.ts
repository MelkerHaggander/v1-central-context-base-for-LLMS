import assert from "node:assert/strict";
import { test } from "node:test";
import { asMemory } from "./mcp-memory-store";

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
