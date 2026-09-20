import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFingerprint, createInMemoryStore } from "../src/in-memory";
import { createMemoryApi } from "../src/store";
import { DEADLINE, USER_A } from "./fixtures";

test("identical save returns same id and updated_at", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const first = await memory.saveMemory(USER_A, DEADLINE);
  const second = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in first && "data" in second);
  assert.equal(second.data.id, first.data.id);
  assert.equal(second.data.updated_at, first.data.updated_at);
  const listed = await memory.searchMemory(USER_A, {});
  assert.ok("data" in listed);
  assert.equal(listed.data.length, 1);
});

test("md5 key matches unique index", () => {
  assert.equal(contentFingerprint(DEADLINE.content), contentFingerprint(DEADLINE.content));
  assert.notEqual(
    contentFingerprint(DEADLINE.content),
    contentFingerprint("Vi lanserar 22 oktober 2026."),
  );
});

test("duplicate without identical row is SAVE_FAILED", async () => {
  const memory = createMemoryApi({
    async insert() {
      return { kind: "duplicate" };
    },
    async findIdentical() {
      return null;
    },
    async update() {
      return { kind: "missing" };
    },
    async listByUser() {
      return [];
    },
  });
  const result = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("error" in result);
  assert.equal(result.error.code, "SAVE_FAILED");
  assert.equal(result.error.message, "Kunde inte spara minnet.");
});

test("insert failure is SAVE_FAILED", async () => {
  const memory = createMemoryApi({
    async insert() {
      return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
    },
    async findIdentical() {
      return null;
    },
    async update() {
      return { kind: "missing" };
    },
    async listByUser() {
      return [];
    },
  });
  const result = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("error" in result);
  assert.equal(result.error.code, "SAVE_FAILED");
});

test("trimmed identical save is a duplicate", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const first = await memory.saveMemory(USER_A, DEADLINE);
  const second = await memory.saveMemory(USER_A, {
    ...DEADLINE,
    title: "  Lanseringsdatum  ",
    content: "  Vi lanserar 15 oktober 2026.  ",
  });
  assert.ok("data" in first && "data" in second);
  assert.equal(second.data.id, first.data.id);
});

test("same project category and title upserts newer content", async () => {
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
  const first = await memory.saveMemory(USER_A, {
    project: "Kaffekvarnen",
    category: "goal",
    title: "Användarmål",
    content: "Målet är 1000 användare.",
  });
  const second = await memory.saveMemory(USER_A, {
    project: "Kaffekvarnen",
    category: "goal",
    title: "Användarmål",
    content: "Målet är 2000 användare.",
  });

  assert.ok("data" in first && "data" in second);
  assert.equal(second.data.id, first.data.id);
  assert.equal(second.data.content, "Målet är 2000 användare.");
  assert.ok(second.data.updated_at > first.data.updated_at);

  const listed = await memory.searchMemory(USER_A, { project: "Kaffekvarnen" });
  assert.ok("data" in listed);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0]?.content, "Målet är 2000 användare.");
});
