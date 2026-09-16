import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryStore } from "../src/in-memory";
import { createMemoryApi } from "../src/store";
import { createSupabaseStore } from "../src/supabase";
import { createFakeSupabase, type FakeStoredRow } from "./fake-supabase";
import {
  DEADLINE,
  DECISION,
  FACT,
  UPDATED_DEADLINE_CONTENT,
  USER_A,
  USER_B,
} from "./fixtures";

type Api = ReturnType<typeof createMemoryApi>;

type Harness = {
  a: Api;
  b: Api;
};

function sequentialId() {
  let n = 0;
  return () => {
    n += 1;
    return `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  };
}

function clock(start = "2026-09-10T12:00:00.123Z") {
  let tick = Date.parse(start);
  return () => {
    const date = new Date(tick);
    tick += 1000;
    return date;
  };
}

function memoryHarness(): Harness {
  const store = createInMemoryStore({ now: clock(), id: sequentialId() });
  const api = createMemoryApi(store);
  return { a: api, b: api };
}

function supabaseHarness(): Harness {
  const now = clock();
  const id = sequentialId();
  const rows: FakeStoredRow[] = [];
  return {
    a: createMemoryApi(createSupabaseStore(createFakeSupabase({ userId: USER_A, now, id, rows }))),
    b: createMemoryApi(createSupabaseStore(createFakeSupabase({ userId: USER_B, now, id, rows }))),
  };
}

async function runVector(apiA: Api, apiB: Api) {
  const saved = await apiA.saveMemory(USER_A, DEADLINE);
  const duplicate = await apiA.saveMemory(USER_A, {
    ...DEADLINE,
    title: "  Lanseringsdatum  ",
    content: "  Vi lanserar 15 oktober 2026.  ",
  });
  const decision = await apiA.saveMemory(USER_A, DECISION);
  const fact = await apiA.saveMemory(USER_A, FACT);
  const oktober = await apiA.searchMemory(USER_A, { query: "Oktober" });
  const projectCase = await apiA.searchMemory(USER_A, { project: "Projekt a" });
  const specials = await apiA.searchMemory(USER_A, { query: "%_(), " });
  const project = await apiA.searchMemory(USER_A, { project: "Projekt A" });
  const updated = await apiA.updateMemory(USER_A, {
    id: "data" in saved ? saved.data.id : "",
    ...DEADLINE,
    content: UPDATED_DEADLINE_CONTENT,
  });
  const afterUpdate = await apiA.searchMemory(USER_A, { query: "oktober" });
  const miss = await apiA.searchMemory(USER_A, { query: "finns-inte-xyz" });
  const invalid = await apiA.saveMemory(USER_A, { ...DEADLINE, category: "nope" });
  const bSearch = await apiB.searchMemory(USER_B, {});
  const bUpdate = await apiB.updateMemory(USER_B, {
    id: "data" in saved ? saved.data.id : "550e8400-e29b-41d4-a716-446655440000",
    ...DEADLINE,
  });
  const unknown = await apiB.updateMemory(USER_B, {
    id: "550e8400-e29b-41d4-a716-446655440000",
    ...DEADLINE,
  });
  const bDelete = await apiB.deleteMemory(USER_B, "data" in saved ? saved.data.id : "550e8400-e29b-41d4-a716-446655440000");
  const unknownDelete = await apiB.deleteMemory(USER_B, "550e8400-e29b-41d4-a716-446655440000");
  const aDelete = await apiA.deleteMemory(USER_A, "data" in fact ? fact.data.id : "");
  const afterDelete = await apiA.searchMemory(USER_A, { project: "Projekt A" });

  return {
    saved,
    duplicate,
    decision,
    fact,
    oktober,
    projectCase,
    specials,
    project,
    updated,
    afterUpdate,
    miss,
    invalid,
    bSearch,
    bUpdate,
    unknown,
    bDelete,
    unknownDelete,
    aDelete,
    afterDelete,
  };
}

test("in-memory and fake supabase return the same vector", async () => {
  const memory = await runVector(...Object.values(memoryHarness()) as [Api, Api]);
  const supabase = await runVector(...Object.values(supabaseHarness()) as [Api, Api]);
  assert.deepEqual(supabase, memory);

  assert.ok("data" in memory.saved);
  assert.equal(memory.saved.data.id, "aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
  assert.equal(memory.saved.data.created_at, "2026-09-10T12:00:00Z");
  assert.ok(!("user_id" in memory.saved.data));

  assert.ok("data" in memory.duplicate);
  assert.equal(memory.duplicate.data.id, memory.saved.data.id);
  assert.equal(memory.duplicate.data.updated_at, memory.saved.data.updated_at);

  assert.ok("data" in memory.oktober);
  assert.deepEqual(memory.oktober.data.map((row) => row.title), ["Lanseringsdatum"]);

  assert.ok("data" in memory.projectCase);
  assert.deepEqual(memory.projectCase.data, []);

  assert.ok("data" in memory.specials);
  assert.equal(memory.specials.data.length, 3);

  assert.ok("data" in memory.project);
  assert.deepEqual(
    memory.project.data.map((row) => row.title),
    ["Tre testkonton", "Stack för V1", "Lanseringsdatum"],
  );

  assert.ok("data" in memory.updated);
  assert.equal(memory.updated.data.id, memory.saved.data.id);
  assert.equal(memory.updated.data.content, UPDATED_DEADLINE_CONTENT);
  assert.equal(memory.updated.data.created_at, memory.saved.data.created_at);
  assert.ok(memory.updated.data.updated_at > memory.saved.data.updated_at);

  assert.ok("data" in memory.afterUpdate);
  assert.equal(memory.afterUpdate.data.length, 1);

  assert.ok("data" in memory.miss);
  assert.deepEqual(memory.miss.data, []);

  assert.ok("error" in memory.invalid);
  assert.equal(memory.invalid.error.code, "INVALID_CATEGORY");

  assert.ok("data" in memory.bSearch);
  assert.deepEqual(memory.bSearch.data, []);

  assert.ok("error" in memory.bUpdate && "error" in memory.unknown);
  assert.equal(memory.bUpdate.error.code, "NOT_FOUND");
  assert.equal(memory.unknown.error.message, memory.bUpdate.error.message);

  assert.ok("error" in memory.bDelete && "error" in memory.unknownDelete);
  assert.equal(memory.bDelete.error.code, "NOT_FOUND");
  assert.equal(memory.unknownDelete.error.message, memory.bDelete.error.message);

  assert.deepEqual(memory.aDelete, { data: { success: true } });
  assert.ok("data" in memory.afterDelete);
  assert.deepEqual(
    memory.afterDelete.data.map((row) => row.title),
    ["Lanseringsdatum", "Stack för V1"],
  );
});

test("update into another identical row is UPDATE_FAILED on both stores", async () => {
  async function collide(harness: Harness) {
    const first = await harness.a.saveMemory(USER_A, DEADLINE);
    const second = await harness.a.saveMemory(USER_A, { ...DEADLINE, title: "Annat datum" });
    assert.ok("data" in first && "data" in second);
    return harness.a.updateMemory(USER_A, {
      id: second.data.id,
      ...DEADLINE,
    });
  }

  const memory = await collide(memoryHarness());
  const supabase = await collide(supabaseHarness());
  assert.deepEqual(supabase, memory);
  assert.ok("error" in memory);
  assert.equal(memory.error.code, "UPDATE_FAILED");
});

test("fake supabase insert without user_id still owns the row", async () => {
  const rows: FakeStoredRow[] = [];
  const store = createSupabaseStore(createFakeSupabase({ userId: USER_A, rows }));
  const created = await store.insert(USER_A, {
    project: DEADLINE.project,
    category: DEADLINE.category,
    title: DEADLINE.title,
    content: DEADLINE.content,
  });
  assert.equal(created.kind, "created");
  assert.equal(rows[0]?.user_id, USER_A);
  assert.ok(created.kind === "created" && !("user_id" in created.row));
});

test("supabase listByUser follows RLS not the function argument", async () => {
  const rows: FakeStoredRow[] = [];
  const api = createMemoryApi(createSupabaseStore(createFakeSupabase({ userId: USER_A, rows })));
  const saved = await api.saveMemory(USER_A, DEADLINE);
  assert.ok("data" in saved);
  const leaked = await api.searchMemory(USER_B, {});
  assert.ok("data" in leaked);
  assert.equal(leaked.data.length, 1);
  assert.equal(leaked.data[0]?.title, "Lanseringsdatum");
});

test("adapter maps insert 23505 then missing lookup to SAVE_FAILED", async () => {
  const rows: FakeStoredRow[] = [];
  const first = createSupabaseStore(createFakeSupabase({ userId: USER_A, rows }));
  const created = await first.insert(USER_A, {
    project: DEADLINE.project,
    category: DEADLINE.category,
    title: DEADLINE.title,
    content: DEADLINE.content,
  });
  assert.equal(created.kind, "created");

  const api = createMemoryApi({
    ...createSupabaseStore(createFakeSupabase({ userId: USER_A, rows })),
    async findIdentical() {
      return null;
    },
  });
  const result = await api.saveMemory(USER_A, DEADLINE);
  assert.ok("error" in result);
  assert.equal(result.error.code, "SAVE_FAILED");
});

test("adapter IO failures keep Alfredo codes", async () => {
  const insertApi = createMemoryApi(
    createSupabaseStore(createFakeSupabase({ userId: USER_A, failInsert: true })),
  );
  const insert = await insertApi.saveMemory(USER_A, DEADLINE);
  assert.ok("error" in insert);
  assert.equal(insert.error.code, "SAVE_FAILED");

  const searchApi = createMemoryApi(
    createSupabaseStore(createFakeSupabase({ userId: USER_A, failSelect: true })),
  );
  const search = await searchApi.searchMemory(USER_A, {});
  assert.ok("error" in search);
  assert.equal(search.error.code, "SEARCH_FAILED");

  const updateApi = createMemoryApi(
    createSupabaseStore(createFakeSupabase({ userId: USER_A, failUpdate: true })),
  );
  const update = await updateApi.updateMemory(USER_A, {
    id: "550e8400-e29b-41d4-a716-446655440000",
    ...DEADLINE,
  });
  assert.ok("error" in update);
  assert.equal(update.error.code, "UPDATE_FAILED");

  const deleteApi = createMemoryApi(
    createSupabaseStore(createFakeSupabase({ userId: USER_A, failDelete: true })),
  );
  const deleted = await deleteApi.deleteMemory(USER_A, "550e8400-e29b-41d4-a716-446655440000");
  assert.ok("error" in deleted);
  assert.equal(deleted.error.code, "DELETE_FAILED");
});
