import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getDeletedMemories } from "../lib/memory-http";
import {
  createInMemoryStore,
  createMemoryApi,
  DELETION_RETENTION_DAYS,
  keepRecentDeletions,
  type MemoryVersion,
  type SpaceAccess,
} from "../vendor/memory/src/index";

const ALFREDO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILIP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHARED = "44444444-4444-4444-8444-444444444444";

function spaces(): SpaceAccess {
  const members: Record<string, string[]> = {
    [ALFREDO]: [SHARED],
    [FILIP]: [SHARED],
  };
  return {
    async readableSpaceIds(userId) {
      return members[userId] ?? [];
    },
    async spaceFor(_userId, kind) {
      return kind === "shared" ? SHARED : null;
    },
    async isMember(userId, spaceId) {
      return (members[userId] ?? []).includes(spaceId);
    },
  };
}

function version(
  over: Partial<MemoryVersion> & Pick<MemoryVersion, "created_at" | "memory_id">,
): MemoryVersion {
  return {
    version_number: 1,
    space_id: SHARED,
    changed_by: ALFREDO,
    event: "delete",
    project: "Team",
    category: "fact",
    title_before: "T",
    title_after: "",
    content_before: "old",
    content_after: "",
    source: "dashboard",
    ...over,
  };
}

describe("deleted memory history", () => {
  it("shows who deleted the memory and the text that was removed", async () => {
    const store = createInMemoryStore();
    const access = spaces();
    const memory = createMemoryApi(store, { spaces: access });
    const saved = await memory.saveDashboardMemory(
      ALFREDO,
      { project: "Team", category: "decision", title: "Verktyg", content: "Vi valde verktyg A." },
      SHARED,
    );
    assert.ok("data" in saved);
    assert.ok("data" in (await memory.deleteMemory(FILIP, saved.data.id)));

    const listed = await getDeletedMemories(ALFREDO, SHARED, { store, spaces: access });
    assert.equal(listed.status, 200);
    const body = listed.body as Array<{ changed_by: string; content_before: string; event: string }>;
    assert.equal(body[0]?.event, "delete");
    assert.equal(body[0]?.changed_by, FILIP);
    assert.equal(body[0]?.content_before, "Vi valde verktyg A.");
  });

  it("does not let a non-member read the deletion list", async () => {
    const listed = await getDeletedMemories("outsider", SHARED, {
      store: createInMemoryStore(),
      spaces: spaces(),
    });
    assert.equal(listed.status, 403);
  });

  it("keeps the deletion route off MCP", () => {
    const route = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
    assert.equal(route.includes("deleted"), false);
  });

  it(`hides delete history older than ${DELETION_RETENTION_DAYS} days`, () => {
    const now = Date.parse("2026-10-01T12:00:00.000Z");
    const kept = version({
      memory_id: "11111111-1111-4111-8111-111111111111",
      created_at: "2026-09-10T12:00:00.000Z",
    });
    const expired = version({
      memory_id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-08-01T12:00:00.000Z",
    });
    assert.deepEqual(
      keepRecentDeletions([kept, expired], now).map((row) => row.memory_id),
      [kept.memory_id],
    );
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
