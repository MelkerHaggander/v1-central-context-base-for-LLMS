import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryStore } from "../src/in-memory";
import { createMemoryApi } from "../src/store";
import { toIso } from "../src/time";
import { DEADLINE, USER_A } from "./fixtures";

test("toIso drops milliseconds", () => {
  assert.equal(toIso("2026-09-10T12:00:00.123Z"), "2026-09-10T12:00:00Z");
  assert.equal(toIso(new Date("2026-09-10T12:00:00.987Z")), "2026-09-10T12:00:00Z");
  assert.equal(toIso("2026-09-10T12:00:00Z"), "2026-09-10T12:00:00Z");
});

test("created_at frozen on update", async () => {
  let tick = Date.parse("2026-09-10T12:00:00.123Z");
  const memory = createMemoryApi(
    createInMemoryStore({
      now: () => {
        const date = new Date(tick);
        tick += 1500;
        return date;
      },
    }),
  );
  const saved = await memory.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);
  assert.equal(saved.data.created_at, "2026-09-10T12:00:00Z");
  const identical = await memory.updateMemory(USER_A, { id: saved.data.id, ...DEADLINE });
  assert.ok("data" in identical);
  assert.equal(identical.data.created_at, saved.data.created_at);
  assert.equal(identical.data.id, saved.data.id);
  assert.equal(identical.data.updated_at, saved.data.updated_at);

  const updated = await memory.updateMemory(USER_A, {
    id: saved.data.id,
    ...DEADLINE,
    content: "Vi lanserar 22 oktober 2026.",
  });
  assert.ok("data" in updated);
  assert.equal(updated.data.created_at, saved.data.created_at);
  assert.ok(updated.data.updated_at > saved.data.updated_at);
});
