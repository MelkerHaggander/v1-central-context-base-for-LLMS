import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryStore } from "../src/in-memory";
import { createMemoryApi } from "../src/store";
import {
  DEADLINE,
  DECISION,
  FACT,
  UPDATED_DEADLINE_CONTENT,
  USER_A,
} from "./fixtures";

function api() {
  return createMemoryApi(createInMemoryStore());
}

test("saves deadline fixture with uuid and Z timestamps", async () => {
  const memory = api();
  const saved = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);
  assert.match(
    saved.data.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.match(saved.data.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(saved.data.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(saved.data.title, "Lanseringsdatum");
  assert.ok(!("user_id" in saved.data));
});

test("query oktober hits Lanseringsdatum content", async () => {
  const memory = api();
  await memory.saveMemory(USER_A, DEADLINE);
  await memory.saveMemory(USER_A, DECISION);
  const found = await memory.searchMemory(USER_A, { query: "oktober" });
  assert.ok("data" in found);
  assert.equal(found.data.length, 1);
  assert.equal(found.data[0]?.title, "Lanseringsdatum");
});

test("filters project and category exactly", async () => {
  const memory = api();
  await memory.saveMemory(USER_A, DEADLINE);
  await memory.saveMemory(USER_A, DECISION);
  await memory.saveMemory(USER_A, FACT);
  const found = await memory.searchMemory(USER_A, {
    project: "Projekt A",
    category: "deadline",
  });
  assert.ok("data" in found);
  assert.equal(found.data.length, 1);
  assert.equal(found.data[0]?.title, "Lanseringsdatum");
});

test("search by project returns fixtures newest first", async () => {
  let tick = Date.parse("2026-09-10T12:00:00Z");
  const memory = createMemoryApi(
    createInMemoryStore({
      now: () => {
        const date = new Date(tick);
        tick += 1000;
        return date;
      },
    }),
  );
  await memory.saveMemory(USER_A, DEADLINE);
  await memory.saveMemory(USER_A, DECISION);
  await memory.saveMemory(USER_A, FACT);
  const found = await memory.searchMemory(USER_A, { project: "Projekt A" });
  assert.ok("data" in found);
  assert.deepEqual(
    found.data.map((row) => row.title),
    ["Tre testkonton", "Stack för V1", "Lanseringsdatum"],
  );
});

test("search by category deadline hits Lanseringsdatum", async () => {
  const memory = api();
  await memory.saveMemory(USER_A, DEADLINE);
  await memory.saveMemory(USER_A, DECISION);
  const found = await memory.searchMemory(USER_A, { category: "deadline" });
  assert.ok("data" in found);
  assert.equal(found.data.length, 1);
  assert.equal(found.data[0]?.title, "Lanseringsdatum");
});

test("miss query is empty list", async () => {
  const memory = api();
  await memory.saveMemory(USER_A, DEADLINE);
  const found = await memory.searchMemory(USER_A, { query: "finns-inte-xyz" });
  assert.ok("data" in found);
  assert.deepEqual(found.data, []);
});

test("update keeps id bumps updated_at", async () => {
  let tick = Date.parse("2026-09-10T12:00:00Z");
  const memory = createMemoryApi(
    createInMemoryStore({
      now: () => {
        const date = new Date(tick);
        tick += 1000;
        return date;
      },
    }),
  );
  const saved = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);
  const updated = await memory.updateMemory(USER_A, {
    id: saved.data.id,
    ...DEADLINE,
    content: UPDATED_DEADLINE_CONTENT,
  });
  assert.ok("data" in updated);
  assert.equal(updated.data.id, saved.data.id);
  assert.equal(updated.data.content, UPDATED_DEADLINE_CONTENT);
  assert.equal(updated.data.created_at, saved.data.created_at);
  assert.ok(updated.data.updated_at > saved.data.updated_at);
  const listed = await memory.searchMemory(USER_A, { query: "oktober" });
  assert.ok("data" in listed);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0]?.content, UPDATED_DEADLINE_CONTENT);
});

test("update rejects silent project moves and allows an explicit flag", async () => {
  const memory = api();
  const saved = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);

  const rejected = await memory.updateMemory(USER_A, {
    id: saved.data.id,
    ...DEADLINE,
    project: "Projekt B",
  });
  assert.ok("error" in rejected);
  assert.equal(rejected.error.code, "PROJECT_CHANGE_REQUIRES_FLAG");
  assert.equal(
    rejected.error.message,
    "Projektbyte kräver allow_project_change: true.",
  );

  const allowed = await memory.updateMemory(USER_A, {
    id: saved.data.id,
    ...DEADLINE,
    project: "Projekt B",
    allow_project_change: true,
  });
  assert.ok("data" in allowed);
  assert.equal(allowed.data.project, "Projekt B");
});

test("ordinary memories cannot become lessons through update_memory", async () => {
  const memory = api();
  const fact = await memory.saveMemory(USER_A, FACT);
  assert.ok("data" in fact);

  const rejected = await memory.updateMemory(USER_A, {
    id: fact.data.id,
    ...FACT,
    category: "lesson",
  });
  assert.ok("error" in rejected);
  assert.equal(rejected.error.code, "LESSON_CATEGORY_REQUIRES_TOOL");
  assert.equal(
    rejected.error.message,
    "Ett vanligt minne kan inte ändras till lesson; använd lesson_memory.",
  );

  const lesson = await memory.saveLesson(USER_A, {
    project: "Projekt A",
    title: "Återanvänd testdata",
    content: "Återanvänd testdata för deterministiska tester.",
  });
  assert.ok("data" in lesson);
  const updated = await memory.updateMemory(USER_A, {
    id: lesson.data.id,
    project: lesson.data.project,
    category: "lesson",
    title: lesson.data.title,
    content: "Återanvänd testdata för snabba och deterministiska tester.",
  });
  assert.ok("data" in updated);
  assert.equal(updated.data.category, "lesson");
});

test("update failure is UPDATE_FAILED", async () => {
  const store = createInMemoryStore();
  const setup = createMemoryApi(store);
  const saved = await setup.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);

  const memory = createMemoryApi({
    ...store,
    async update() {
      return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
    },
  });
  const result = await memory.updateMemory(USER_A, {
    id: saved.data.id,
    ...DEADLINE,
  });
  assert.ok("error" in result);
  assert.equal(result.error.code, "UPDATE_FAILED");
  assert.equal(result.error.message, "Kunde inte uppdatera minnet.");
});

test("invalid category does not insert", async () => {
  const store = createInMemoryStore();
  const memory = createMemoryApi(store);
  const result = await memory.saveMemory(USER_A, { ...DEADLINE, category: "nope" });
  assert.ok("error" in result);
  assert.equal(result.error.code, "INVALID_CATEGORY");
  const listed = await store.listByUser(USER_A);
  assert.equal(listed.length, 0);
});
