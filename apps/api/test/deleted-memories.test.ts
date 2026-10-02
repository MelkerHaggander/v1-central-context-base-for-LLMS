import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("deleted memory history", () => {
  it("keeps the deletion route off MCP and on the Python brain", () => {
    const mcp = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
    const route = readFileSync(join(__dirname, "../app/api/memories/deleted/route.ts"), "utf8");
    assert.equal(mcp.includes("deleted"), false);
    assert.match(route, /callPythonBrain\(\s*"list_deletions"/);
    assert.doesNotMatch(route, /@v1\/memory|createMemoryApi/);
  });

  it("purges expired deletions on a Supabase cron, not when listing Deleted", () => {
    const route = readFileSync(join(__dirname, "../app/api/memories/deleted/route.ts"), "utf8");
    const migration = readFileSync(
      join(__dirname, "../../../supabase/migrations/20261001190000_purge_expired_deleted_memories.sql"),
      "utf8",
    );
    assert.equal(route.includes("purgeExpiredDeletedMemories"), false);
    assert.match(migration, /purge_expired_deleted_memories/);
    assert.match(migration, /cron\.schedule/);
    assert.match(migration, /interval '30 days'/);
  });
});
