import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryStore } from "../src/in-memory";
import { createMemoryApi } from "../src/store";
import { DEADLINE, USER_A, USER_B } from "./fixtures";

test("B search omits A row", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const saved = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);
  const bSearch = await memory.searchMemory(USER_B, {});
  assert.ok("data" in bSearch);
  assert.deepEqual(bSearch.data, []);
});

test("B update of A id is NOT_FOUND same message", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const saved = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);
  const missing = await memory.updateMemory(USER_B, {
    id: saved.data.id,
    ...DEADLINE,
    content: "Vi lanserar 22 oktober 2026.",
  });
  const unknown = await memory.updateMemory(USER_B, {
    id: "550e8400-e29b-41d4-a716-446655440000",
    ...DEADLINE,
  });
  assert.ok("error" in missing);
  assert.ok("error" in unknown);
  assert.equal(missing.error.code, "NOT_FOUND");
  assert.equal(unknown.error.code, missing.error.code);
  assert.equal(unknown.error.message, missing.error.message);
  const stillA = await memory.searchMemory(USER_A, {});
  assert.ok("data" in stillA);
  assert.equal(stillA.data[0]?.content, DEADLINE.content);
});

test("B delete of A id is NOT_FOUND same message", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const saved = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);
  const missing = await memory.deleteMemory(USER_B, saved.data.id);
  const unknown = await memory.deleteMemory(USER_B, "550e8400-e29b-41d4-a716-446655440000");
  assert.ok("error" in missing);
  assert.ok("error" in unknown);
  assert.equal(missing.error.code, "NOT_FOUND");
  assert.equal(unknown.error.code, missing.error.code);
  assert.equal(unknown.error.message, missing.error.message);
  const stillA = await memory.searchMemory(USER_A, {});
  assert.ok("data" in stillA);
  assert.equal(stillA.data.length, 1);
  const badId = await memory.deleteMemory(USER_A, "inte-uuid");
  assert.ok("error" in badId);
  assert.equal(badId.error.code, "INVALID_ID");
});

test("owner can delete own memory", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const saved = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);
  const deleted = await memory.deleteMemory(USER_A, saved.data.id);
  assert.deepEqual(deleted, { data: { success: true } });
  const after = await memory.searchMemory(USER_A, {});
  assert.ok("data" in after);
  assert.deepEqual(after.data, []);
});

test("saveLesson stores category lesson and isolates accounts", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const saved = await memory.saveLesson(USER_A, {
    project: "Projekt A",
    title: "Rätta category till gemener",
    content: "Ogiltig category ska rättas till gemener, inte sparas som svensk etikett.",
  });
  assert.ok("data" in saved);
  assert.equal(saved.data.category, "lesson");
  const found = await memory.searchMemory(USER_A, { category: "lesson" });
  assert.ok("data" in found);
  assert.equal(found.data.length, 1);
  const other = await memory.searchMemory(USER_B, { category: "lesson" });
  assert.ok("data" in other);
  assert.deepEqual(other.data, []);
});

test("saveLesson de-duplicates identical lessons and is not stored as fact", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const input = {
    project: "Projekt A",
    title: "Rätta category till gemener",
    content: "Ogiltig category ska rättas till gemener, inte sparas som svensk etikett.",
  };
  const first = await memory.saveLesson(USER_A, input);
  const second = await memory.saveLesson(USER_A, input);
  assert.ok("data" in first && "data" in second);
  assert.equal(first.data.category, "lesson");
  assert.equal(second.data.id, first.data.id);
  assert.equal(second.data.updated_at, first.data.updated_at);
  const facts = await memory.searchMemory(USER_A, { category: "fact" });
  assert.ok("data" in facts);
  assert.deepEqual(facts.data, []);
});
