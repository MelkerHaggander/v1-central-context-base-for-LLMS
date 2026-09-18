import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryStore } from "../src/in-memory";
import {
  CONTEXT_ITEM_LIMIT,
  CONTEXT_JSON_LIMIT,
  CONTEXT_SNIPPET_LIMIT,
  createMemoryApi,
  extractKeywords,
} from "../src/store";
import { USER_A, USER_B } from "./fixtures";

test("extractKeywords removes Swedish stop words and punctuation", () => {
  assert.deepEqual(extractKeywords("När ska vi lansera projektet?"), [
    "lansera",
    "projektet",
  ]);
});

test("title hits outrank content hits and score-zero memories are excluded", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "fact",
    title: "Raketmotor",
    content: "Titelträffen ska vinna.",
  });
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "fact",
    title: "Nyare anteckning",
    content: "Vi diskuterade en raketmotor.",
  });
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "fact",
    title: "Orelaterat",
    content: "Det här handlar om något annat.",
  });

  const result = await memory.getContext(USER_A, { prompt: "Berätta om vår raketmotor" });
  assert.ok("data" in result);
  assert.deepEqual(result.data.items.map((item) => item.title), [
    "Raketmotor",
    "Nyare anteckning",
  ]);
});

test("project filtering is exact and case-sensitive", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "fact",
    title: "Raketmotor",
    content: "Aktiv.",
  });

  const exact = await memory.getContext(USER_A, {
    prompt: "raketmotor",
    project: "Projekt A",
  });
  const wrongCase = await memory.getContext(USER_A, {
    prompt: "raketmotor",
    project: "Projekt a",
  });
  assert.ok("data" in exact && "data" in wrongCase);
  assert.equal(exact.data.items.length, 1);
  assert.deepEqual(wrongCase.data.items, []);
});

test("deadline prompt cue outranks a weak fact content hit", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "deadline",
    title: "Leveransplan",
    content: "Den femtonde oktober.",
  });
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "fact",
    title: "Ordlista",
    content: "Deadline är ett engelskt låneord.",
  });

  const result = await memory.getContext(USER_A, { prompt: "När är vår deadline?" });
  assert.ok("data" in result);
  assert.equal(result.data.items[0]?.category, "deadline");
});

test("score zero produces a valid empty items list", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "fact",
    title: "Backend",
    content: "Postgres används.",
  });

  const result = await memory.getContext(USER_A, { prompt: "kvantskum" });
  assert.ok("data" in result);
  assert.deepEqual(result.data.items, []);
  assert.equal(result.data.omitted, 0);
});

test("clips snippets and packs matches into the response budget", async () => {
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

  for (let index = 0; index < CONTEXT_ITEM_LIMIT + 2; index += 1) {
    const saved = await memory.saveMemory(USER_A, {
      project: "Projekt A",
      category: "fact",
      title: `Gemensam träff ${index}`,
      content: `Gemensam ${"lång text ".repeat(120)}`,
    });
    assert.ok("data" in saved);
  }

  const result = await memory.getContext(USER_A, { prompt: "gemensam" });
  assert.ok("data" in result);
  assert.ok(result.data.items.length <= CONTEXT_ITEM_LIMIT);
  assert.ok(result.data.items.every((item) => item.snippet.length <= CONTEXT_SNIPPET_LIMIT));
  assert.ok(JSON.stringify(result.data).length <= CONTEXT_JSON_LIMIT);
  assert.equal(result.data.omitted, CONTEXT_ITEM_LIMIT + 2 - result.data.items.length);
  assert.ok(result.data.omitted > 0);
  assert.deepEqual(Object.keys(result.data.items[0] ?? {}).sort(), [
    "category",
    "id",
    "project",
    "snippet",
    "title",
  ]);
});

test("getContext preserves user isolation", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "fact",
    title: "Raketmotor",
    content: "Hemlig konstruktion.",
  });

  const result = await memory.getContext(USER_B, { prompt: "raketmotor" });
  assert.ok("data" in result);
  assert.deepEqual(result.data.items, []);
});

test("invalid prompts return INVALID_PROMPT", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  for (const prompt of ["", "   ", "a".repeat(8001)]) {
    const result = await memory.getContext(USER_A, { prompt });
    assert.ok("error" in result);
    assert.equal(result.error.code, "INVALID_PROMPT");
  }
});

test("listByUser failures return SEARCH_FAILED", async () => {
  const store = createInMemoryStore();
  const memory = createMemoryApi({
    ...store,
    async listByUser() {
      throw new Error("boom");
    },
  });

  const result = await memory.getContext(USER_A, { prompt: "raketmotor" });
  assert.ok("error" in result);
  assert.equal(result.error.code, "SEARCH_FAILED");
});
