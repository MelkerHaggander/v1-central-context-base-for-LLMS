import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryApi, DELETION_RETENTION_DAYS, keepRecentDeletions } from "../src/index";
import { createInMemoryStore } from "../src/in-memory";
import type { MemoryVersion, SpaceAccess } from "../src/types";

const ALFREDO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILIP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSONAL = "11111111-1111-4111-8111-111111111111";
const SHARED = "44444444-4444-4444-8444-444444444444";
const FILIP_PERSONAL = "22222222-2222-4222-8222-222222222222";

function spaces(): SpaceAccess {
  const members: Record<string, string[]> = {
    [ALFREDO]: [PERSONAL, SHARED],
    [FILIP]: [FILIP_PERSONAL, SHARED],
  };
  return {
    async readableSpaceIds(userId) {
      return members[userId] ?? [];
    },
    async spaceFor(userId, kind) {
      const ids = members[userId] ?? [];
      if (kind === "personal") return ids.find((id) => id !== SHARED) ?? null;
      return ids.includes(SHARED) ? SHARED : null;
    },
    async isMember(userId, spaceId) {
      return (members[userId] ?? []).includes(spaceId);
    },
  };
}

test("a deleted memory stays visible with who deleted it and the old text", async () => {
  const memory = createMemoryApi(createInMemoryStore(), { spaces: spaces() });
  const saved = await memory.saveDashboardMemory(
    ALFREDO,
    { project: "Projekt A", category: "fact", title: "Stack", content: "TypeScript på Vercel." },
    SHARED,
  );
  assert.ok("data" in saved);
  const removed = await memory.deleteMemory(FILIP, saved.data.id);
  assert.ok("data" in removed);

  const gone = await memory.searchInSpace(ALFREDO, SHARED, { query: "TypeScript" });
  assert.ok("data" in gone);
  assert.equal(gone.data.length, 0);

  const history = await memory.listDeletions(ALFREDO, SHARED);
  assert.ok("data" in history);
  assert.equal(history.data.length, 1);
  assert.equal(history.data[0]?.event, "delete");
  assert.equal(history.data[0]?.changed_by, FILIP);
  assert.equal(history.data[0]?.content_before, "TypeScript på Vercel.");
  assert.equal(history.data[0]?.content_after, "");
  assert.equal(history.data[0]?.title_before, "Stack");

  const byId = await memory.listVersions(ALFREDO, saved.data.id);
  assert.ok("data" in byId);
  assert.equal(byId.data[0]?.changed_by, FILIP);
});

test("a project or category change is a version with the values before it", async () => {
  const memory = createMemoryApi(createInMemoryStore(), { spaces: spaces() });
  const saved = await memory.saveDashboardMemory(
    ALFREDO,
    { project: "Projekt A", category: "fact", title: "Stack", content: "TypeScript." },
    SHARED,
  );
  assert.ok("data" in saved);
  const moved = await memory.updateMemory(FILIP, {
    id: saved.data.id,
    project: "Infra",
    category: "fact",
    title: "Stack",
    content: "TypeScript.",
    allow_project_change: true,
  });
  assert.ok("data" in moved);
  const recategorised = await memory.updateMemory(ALFREDO, {
    id: saved.data.id,
    project: "Infra",
    category: "decision",
    title: "Stack",
    content: "TypeScript.",
  });
  assert.ok("data" in recategorised);

  const history = await memory.listVersions(ALFREDO, saved.data.id);
  assert.ok("data" in history);
  assert.equal(history.data.length, 2);
  // Newest first: the category change, written while the row still said "fact".
  assert.equal(history.data[0]?.changed_by, ALFREDO);
  assert.equal(history.data[0]?.project, "Infra");
  assert.equal(history.data[0]?.category, "fact");
  // The project change, written while the row still said "Projekt A".
  assert.equal(history.data[1]?.changed_by, FILIP);
  assert.equal(history.data[1]?.project, "Projekt A");
  assert.equal(history.data[1]?.content_before, history.data[1]?.content_after);
});

test("a deleted personal memory is visible only to that member", async () => {
  const memory = createMemoryApi(createInMemoryStore(), { spaces: spaces() });
  const saved = await memory.saveDashboardMemory(
    ALFREDO,
    { project: "Eget", category: "preference", title: "Kaffe", content: "Svart kaffe." },
    PERSONAL,
  );
  assert.ok("data" in saved);
  assert.ok("data" in (await memory.deleteMemory(ALFREDO, saved.data.id)));

  const own = await memory.listDeletions(ALFREDO, PERSONAL);
  assert.ok("data" in own);
  assert.equal(own.data[0]?.changed_by, ALFREDO);
  assert.equal(own.data[0]?.content_before, "Svart kaffe.");

  const other = await memory.listDeletions(FILIP, PERSONAL);
  assert.ok("error" in other);
  assert.equal(other.error.code, "FORBIDDEN");
});

test("someone who is not a member cannot delete or leave a history row", async () => {
  const memory = createMemoryApi(createInMemoryStore(), { spaces: spaces() });
  const saved = await memory.saveDashboardMemory(
    FILIP,
    { project: "Eget", category: "fact", title: "Hemligt", content: "Bara Filip." },
    FILIP_PERSONAL,
  );
  assert.ok("data" in saved);
  const blocked = await memory.deleteMemory(ALFREDO, saved.data.id);
  assert.ok("error" in blocked);
  assert.equal(blocked.error.code, "FORBIDDEN");

  const history = await memory.listDeletions(FILIP, FILIP_PERSONAL);
  assert.ok("data" in history);
  assert.equal(history.data.length, 0);
});

test(`delete history older than ${DELETION_RETENTION_DAYS} days is not listed`, () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z");
  const recent: MemoryVersion = {
    version_number: 1,
    memory_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    space_id: SHARED,
    changed_by: ALFREDO,
    event: "delete",
    project: "P",
    category: "fact",
    title_before: "A",
    title_after: "",
    content_before: "keep",
    content_after: "",
    source: "dashboard",
    created_at: "2026-09-20T12:00:00.000Z",
  };
  const old: MemoryVersion = {
    ...recent,
    memory_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    content_before: "drop",
    created_at: "2026-08-01T12:00:00.000Z",
  };
  assert.deepEqual(
    keepRecentDeletions([recent, old], now).map((row) => row.content_before),
    ["keep"],
  );
});
