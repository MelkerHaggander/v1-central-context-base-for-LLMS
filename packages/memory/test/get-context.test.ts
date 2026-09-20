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

test("project filtering is case-insensitive", async () => {
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
  assert.equal(wrongCase.data.items.length, 1);
});

test("category cues boost lexical matches but never revive score-zero rows", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "deadline",
    title: "Milstolpe",
    content: "Leveransplan för Projekt A.",
  });
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "fact",
    title: "Ordlista",
    content: "Leveransplan är ett sammansatt ord.",
  });
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "deadline",
    title: "Budgetdatum",
    content: "Budgeten fastställs i oktober.",
  });

  const result = await memory.getContext(USER_A, {
    prompt: "När är deadline för leveransplan?",
  });
  assert.ok("data" in result);
  assert.equal(result.data.items[0]?.category, "deadline");
  assert.deepEqual(result.data.items.map((item) => item.title), [
    "Milstolpe",
    "Ordlista",
  ]);
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

test("light Swedish stemming matches lanseringsdatumet to Lanseringsdatum", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "deadline",
    title: "Lanseringsdatum",
    content: "Vi lanserar 15 oktober 2026.",
  });

  const result = await memory.getContext(USER_A, {
    prompt: "Vad är lanseringsdatumet?",
  });
  assert.ok("data" in result);
  assert.deepEqual(result.data.items.map((item) => item.title), [
    "Lanseringsdatum",
  ]);
});

test("expanded stopwords do not retrieve unrelated category memories", async () => {
  const keywords = extractKeywords(
    "Hur skall jag söka kort sedan, och vilken väg får mig rätt?",
  );
  for (const stopword of ["hur", "skall", "kort", "sedan", "vilken", "får", "mig"]) {
    assert.equal(keywords.includes(stopword), false, stopword);
  }

  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "deadline",
    title: "Lanseringsdatum",
    content: "Vi lanserar 15 oktober 2026.",
  });
  const result = await memory.getContext(USER_A, {
    prompt: "Hur skall jag söka kort sedan?",
  });
  assert.ok("data" in result);
  assert.deepEqual(result.data.items, []);
});

test("launch synonym matches lansering without returning every deadline", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "deadline",
    title: "Lansering",
    content: "Lansering sker i oktober.",
  });
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "deadline",
    title: "Budgetdatum",
    content: "Budgeten fastställs i oktober.",
  });

  const result = await memory.getContext(USER_A, { prompt: "launch date" });
  assert.ok("data" in result);
  assert.deepEqual(result.data.keywords, ["launch"]);
  assert.deepEqual(result.data.items.map((item) => item.title), ["Lansering"]);
});

test("content keywords beat same-project noise in Swedish and English", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "Kaffekvarnen",
    category: "fact",
    title: "Databas",
    content: "Kaffekvarnen använder PostgreSQL.",
  });
  await memory.saveMemory(USER_A, {
    project: "Kaffekvarnen",
    category: "preference",
    title: "Svarsspråk",
    content: "Kaffekvarnen föredrar svenska svar.",
  });
  await memory.saveMemory(USER_A, {
    project: "Kaffekvarnen",
    category: "goal",
    title: "Tillväxtmål",
    content: "Kaffekvarnen ska nå 60 användare.",
  });

  for (const prompt of [
    "Vilken databas använder Kaffekvarnen?",
    "Which database does Kaffekvarnen use?",
  ]) {
    const result = await memory.getContext(USER_A, { prompt });
    assert.ok("data" in result);
    assert.deepEqual(result.data.items.map((item) => item.title), ["Databas"]);
  }
});

test("case-insensitive project filter finds MCP-TEST as mcp-test", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "fact",
    title: "Databas",
    content: "PostgreSQL.",
  });

  const result = await memory.getContext(USER_A, {
    prompt: "databas",
    project: "mcp-test",
  });
  assert.ok("data" in result);
  assert.equal(result.data.items[0]?.project, "MCP-TEST");
});

test("near-duplicate saves expose only the newest content", async () => {
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
  await memory.saveMemory(USER_A, {
    project: "Kaffekvarnen",
    category: "goal",
    title: "Användarmål",
    content: "Kaffekvarnen ska nå 50 användare.",
  });
  await memory.saveMemory(USER_A, {
    project: "Kaffekvarnen",
    category: "goal",
    title: "Användarmål",
    content: "Kaffekvarnen ska nå 60 användare.",
  });

  const result = await memory.getContext(USER_A, {
    prompt: "Hur många användare har Kaffekvarnen?",
  });
  assert.ok("data" in result);
  assert.equal(result.data.items.length, 1);
  assert.match(result.data.items[0]?.snippet ?? "", /60 användare/);
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
