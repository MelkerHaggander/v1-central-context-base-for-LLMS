import assert from "node:assert/strict";
import { test } from "node:test";
import { cosineSimilarity } from "../src/brain";
import { createInMemoryStore } from "../src/in-memory";
import {
  CONTEXT_ITEM_LIMIT,
  CONTEXT_JSON_LIMIT,
  CONTEXT_SNIPPET_LIMIT,
  createMemoryApi,
  extractKeywords,
} from "../src/store";
import type { EmbeddingClient, MemoryDraft, MemoryFormulator, SpaceAccess } from "../src/types";
import { USER_A, USER_B } from "./fixtures";

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-000000000010";
const SHARED = "aaaaaaaa-aaaa-4aaa-8aaa-000000000011";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-000000000012";

function memberSpaces(userId: string, readable: string[] = [PERSONAL, SHARED]): SpaceAccess {
  return {
    async readableSpaceIds(id) {
      return id === userId ? readable : [];
    },
    async spaceFor(id, kind) {
      if (id !== userId) return null;
      if (kind === "shared") return readable.includes(SHARED) ? SHARED : null;
      return readable.includes(PERSONAL) ? PERSONAL : null;
    },
    async isMember(id, spaceId) {
      return id === userId && readable.includes(spaceId);
    },
  };
}

function embeddingFrom(map: (text: string) => number[]): EmbeddingClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    dimensions: 3,
    calls,
    async embed(text: string) {
      calls.push(text);
      return map(text);
    },
  };
}

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

test("snippet centers on the best content match instead of the opening", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "fact",
    title: "Drift",
    content: `${"prefixword ".repeat(40)}Backup körs varje natt klockan 02.`,
  });

  const result = await memory.getContext(USER_A, {
    prompt: "Hur fungerar backup?",
  });
  assert.ok("data" in result);
  const value = result.data.items[0]?.snippet ?? "";
  assert.match(value, /Backup körs varje natt/);
  assert.match(value, /^…(?:prefixword|Backup)/);
  assert.ok(value.length <= CONTEXT_SNIPPET_LIMIT);
});

test("category-only deadline intent returns deadlines without list mode", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "deadline",
    title: "Lansering",
    content: "Lansering sker 5 november.",
  });
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "fact",
    title: "Databas",
    content: "PostgreSQL används.",
  });

  for (const prompt of [
    "Vilka deadlines har jag framför mig?",
    "Vad är på gång?",
  ]) {
    const result = await memory.getContext(USER_A, { prompt });
    assert.ok("data" in result);
    assert.deepEqual(result.data.items.map((item) => item.category), [
      "deadline",
    ]);
  }
});

test("short numeric date tokens remain searchable", async () => {
  assert.deepEqual(extractKeywords("Vad händer 5 november?"), [
    "händer",
    "5",
    "november",
  ]);

  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "deadline",
    title: "Första leverans",
    content: "Första leveransen sker 5 november.",
  });
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "deadline",
    title: "Andra leverans",
    content: "Andra leveransen sker 12 november.",
  });

  const result = await memory.getContext(USER_A, {
    prompt: "När är leveransen 5 november?",
  });
  assert.ok("data" in result);
  assert.equal(result.data.items[0]?.title, "Första leverans");
});

test("compound matching does not confuse lagerblad with lagerstyrning", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "fact",
    title: "Lagerblad",
    content: "Lagerbladet är grönt.",
  });
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "fact",
    title: "Lagerstyrning",
    content: "Lagerstyrning körs automatiskt.",
  });

  const result = await memory.getContext(USER_A, { prompt: "lagerblad" });
  assert.ok("data" in result);
  assert.deepEqual(result.data.items.map((item) => item.title), ["Lagerblad"]);
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

test("lanserar retrieves launch memories across projects", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "Projekt A",
    category: "deadline",
    title: "Lanseringsdatum",
    content: "Projekt A lanseras 5 november.",
  });
  await memory.saveMemory(USER_A, {
    project: "Kaffekvarnen",
    category: "deadline",
    title: "Lansering",
    content: "Kaffekvarnen lanseras 12 november.",
  });

  const result = await memory.getContext(USER_A, {
    prompt: "När lanserar vi?",
  });
  assert.ok("data" in result);
  assert.deepEqual(
    new Set(result.data.items.map((item) => item.project)),
    new Set(["Projekt A", "Kaffekvarnen"]),
  );
});

test("category intent survives unmatched leftover words", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveLesson(USER_A, {
    project: "MCP-TEST",
    title: "Testlärdom",
    content: "Verifiera alltid resultatet innan leverans.",
  });
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "fact",
    title: "Databas",
    content: "PostgreSQL används.",
  });

  for (const prompt of [
    "Vad har vi lärt oss hittills?",
    "Vilka lärdomar har vi sparat?",
  ]) {
    const result = await memory.getContext(USER_A, { prompt });
    assert.ok("data" in result);
    assert.deepEqual(result.data.items.map((item) => item.category), ["lesson"]);
  }
});

test("English plural category intent returns decisions and lessons", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "decision",
    title: "Database choice",
    content: "We decided to use PostgreSQL.",
  });
  await memory.saveLesson(USER_A, {
    project: "MCP-TEST",
    title: "Test before release",
    content: "Run the complete suite before release.",
  });
  await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "fact",
    title: "Region",
    content: "The deployment region is ARN1.",
  });

  const result = await memory.getContext(USER_A, {
    prompt: "Which decisions and lessons?",
  });
  assert.ok("data" in result);
  assert.deepEqual(
    new Set(result.data.items.map((item) => item.category)),
    new Set(["decision", "lesson"]),
  );
});

test("inflected Swedish category cues select their categories", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  for (const [category, title] of [
    ["decision", "Stackbeslut"],
    ["goal", "Tillväxtmål"],
    ["deadline", "Tidsfrist"],
    ["lesson", "Lärdom"],
  ] as const) {
    await memory.saveMemory(USER_A, {
      project: "MCP-TEST",
      category,
      title,
      content: `${title} för projektet.`,
    });
  }

  for (const [prompt, category] of [
    ["Vad var beslutet?", "decision"],
    ["Vilka är målen?", "goal"],
    ["Vilka tidsfrister finns?", "deadline"],
    ["Vilka lärdomar finns?", "lesson"],
  ] as const) {
    const result = await memory.getContext(USER_A, { prompt });
    assert.ok("data" in result);
    assert.deepEqual(result.data.items.map((item) => item.category), [category]);
  }
});

test("returned user data is marked, timestamped and HTML-escaped", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  const saved = await memory.saveMemory(USER_A, {
    project: "MCP-TEST",
    category: "fact",
    title: "Backup HTML",
    content: "<script>alert('x')</script> & backup körs varje natt.",
  });
  assert.ok("data" in saved);

  const result = await memory.getContext(USER_A, { prompt: "backup" });
  assert.ok("data" in result);
  const item = result.data.items[0];
  assert.equal(item?.source, "user_memory");
  assert.equal(item?.updated_at, saved.data.updated_at);
  assert.match(item?.snippet ?? "", /&lt;script>/);
  assert.match(item?.snippet ?? "", /&amp; backup/);
  assert.doesNotMatch(item?.snippet ?? "", /<script>/);
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

test("reports duplicate and capped omissions separately", async () => {
  const rows = Array.from({ length: CONTEXT_ITEM_LIMIT + 2 }, (_, index) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
    project: "MCP-TEST",
    category: "fact" as const,
    title: `Gemensam ${index}`,
    content: `Gemensam rad ${index}.`,
    created_at: "2026-09-10T12:00:00Z",
    updated_at: `2026-09-10T12:00:${String(index).padStart(2, "0")}Z`,
  }));
  rows.push({
    ...rows[0]!,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    content: "Gemensam äldre dubblett.",
    updated_at: "2026-09-10T11:59:59Z",
  });
  const base = createInMemoryStore();
  const memory = createMemoryApi({
    ...base,
    async listByUser() {
      return rows;
    },
  });

  const result = await memory.getContext(USER_A, { prompt: "gemensam" });
  assert.ok("data" in result);
  assert.equal(result.data.omitted_duplicate, 1);
  assert.equal(
    result.data.omitted_capped,
    CONTEXT_ITEM_LIMIT + 2 - result.data.items.length,
  );
  assert.equal(
    result.data.omitted,
    result.data.omitted_duplicate + result.data.omitted_capped,
  );
});

test("returns a compact project hint only without a project filter", async () => {
  const memory = createMemoryApi(createInMemoryStore());
  for (const project of ["Alpha", "Beta", "Gamma"]) {
    await memory.saveMemory(USER_A, {
      project,
      category: "fact",
      title: `${project} databas`,
      content: `${project} använder PostgreSQL.`,
    });
  }

  const broad = await memory.getContext(USER_A, { prompt: "databas" });
  const filtered = await memory.getContext(USER_A, {
    prompt: "databas",
    project: "Alpha",
  });
  assert.ok("data" in broad && "data" in filtered);
  assert.deepEqual(new Set(broad.data.projects), new Set(["Alpha", "Beta", "Gamma"]));
  assert.equal("projects" in filtered.data, false);
  assert.ok((broad.data.projects?.length ?? 0) <= 8);
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
  assert.deepEqual(result.data.written, []);
  const { written: _written, ...legacy } = result.data;
  assert.ok(JSON.stringify(legacy).length <= CONTEXT_JSON_LIMIT);
  assert.equal(result.data.omitted, CONTEXT_ITEM_LIMIT + 2 - result.data.items.length);
  assert.ok(result.data.omitted > 0);
  assert.deepEqual(Object.keys(result.data.items[0] ?? {}).sort(), [
    "category",
    "id",
    "project",
    "snippet",
    "source",
    "title",
    "updated_at",
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

test("nearby vectors are returned together when the words do not overlap", async () => {
  const store = createInMemoryStore();
  const embedding = embeddingFrom((text) => {
    if (text.includes("ALPHA")) return [1, 0, 0];
    if (text.includes("BETA")) return [0.8, 0.6, 0];
    if (text.includes("qqqq")) return [1, 0, 0];
    return [0, 1, 0];
  });
  const memory = createMemoryApi(store, {
    embedding,
    spaces: memberSpaces(USER_A),
    formulator: { async formulate() { return []; } },
  });
  await memory.saveDashboardMemory(USER_A, {
    project: "Vectors",
    category: "fact",
    title: "Alpha note",
    content: "ALPHA quartz crystal",
  }, PERSONAL);
  await memory.saveDashboardMemory(USER_A, {
    project: "Vectors",
    category: "fact",
    title: "Beta note",
    content: "BETA marble stone",
  }, PERSONAL);

  const result = await memory.getContext(USER_A, { prompt: "qqqq zebra" });
  assert.ok("data" in result);
  assert.deepEqual(result.data.items.map((item) => item.title).sort(), [
    "Alpha note",
    "Beta note",
  ]);
  assert.ok(result.data.items.length <= CONTEXT_ITEM_LIMIT);
});

test("thresholds 0.35 and 0.55 do not pad the pack with a weak neighbor", async () => {
  const store = createInMemoryStore();
  const hit = [0.4, 0.916515138991168, 0];
  const neighbor = [0.2, 0.9797958971132712, 0];
  const weak = [0.2, -0.9797958971132712, 0];
  const low = [0.34, -0.940374469585652, 0];
  const prompt = [1, 0, 0];
  assert.ok(cosineSimilarity(prompt, hit) >= 0.35);
  assert.ok(cosineSimilarity(prompt, neighbor) < 0.35);
  assert.ok(cosineSimilarity(hit, neighbor) >= 0.55);
  assert.ok(cosineSimilarity(hit, weak) < 0.55);
  assert.ok(cosineSimilarity(prompt, low) < 0.35);
  assert.ok(cosineSimilarity(hit, low) < 0.55);

  const vectors = new Map<string, number[]>([
    ["HITTOKEN", hit],
    ["NEARTOKEN", neighbor],
    ["WEAKTOKEN", weak],
    ["LOWTOKEN", low],
  ]);
  const embedding = embeddingFrom((text) => {
    for (const [token, vector] of vectors) {
      if (text.includes(token)) return vector;
    }
    if (text.includes("PROMPT")) return prompt;
    return [0, -1, 0];
  });
  const memory = createMemoryApi(store, {
    embedding,
    spaces: memberSpaces(USER_A),
    formulator: { async formulate() { return []; } },
  });

  const saved: Array<{ token: string; title: string }> = [
    { token: "HITTOKEN", title: "Direct hit" },
    { token: "NEARTOKEN", title: "Strong neighbor" },
    { token: "WEAKTOKEN", title: "Weak neighbor" },
    { token: "LOWTOKEN", title: "Below direct" },
  ];
  for (let index = 0; index < 6; index += 1) {
    saved.push({ token: `FILLER${index}`, title: `Filler ${index}` });
  }
  for (const row of saved) {
    const result = await memory.saveDashboardMemory(USER_A, {
      project: "Vectors",
      category: "fact",
      title: row.title,
      content: `${row.token} privatebody`,
    }, PERSONAL);
    assert.ok("data" in result);
  }

  const result = await memory.getContext(USER_A, { prompt: "PROMPT querywords" });
  assert.ok("data" in result);
  const titles = result.data.items.map((item) => item.title);
  assert.deepEqual(titles.sort(), ["Direct hit", "Strong neighbor"]);
  assert.ok(result.data.items.length < CONTEXT_ITEM_LIMIT);
  assert.equal(titles.includes("Weak neighbor"), false);
  assert.equal(titles.includes("Below direct"), false);
});

test("memories outside readable spaces stay hidden", async () => {
  const store = createInMemoryStore();
  const embedding = embeddingFrom(() => [1, 0, 0]);
  const memory = createMemoryApi(store, {
    embedding,
    spaces: memberSpaces(USER_A, [PERSONAL]),
    formulator: { async formulate() { return []; } },
  });
  await memory.saveDashboardMemory(USER_A, {
    project: "Vectors",
    category: "fact",
    title: "Mine",
    content: "raketmotor i mitt utrymme",
  }, PERSONAL);
  await store.upsertSubject(USER_A, {
    spaceId: SHARED,
    project: "Vectors",
    category: "fact",
    title: "Team secret",
    content: "raketmotor i delat utrymme",
    source: "dashboard",
  });
  await store.upsertSubject(USER_B, {
    spaceId: OTHER,
    project: "Vectors",
    category: "fact",
    title: "Stranger",
    content: "raketmotor hos någon annan",
    source: "dashboard",
  });
  await store.setEmbedding(
    store.snapshot().find((row) => row.title === "Team secret")!.id,
    [1, 0, 0],
  );
  await store.setEmbedding(
    store.snapshot().find((row) => row.title === "Stranger")!.id,
    [1, 0, 0],
  );

  const result = await memory.getContext(USER_A, { prompt: "raketmotor" });
  assert.ok("data" in result);
  assert.deepEqual(result.data.items.map((item) => item.title), ["Mine"]);
});

test("a new decision is stored as brain and stays visible in that space", async () => {
  const store = createInMemoryStore();
  const memory = createMemoryApi(store, {
    embedding: embeddingFrom(() => [0, 1, 0]),
    spaces: memberSpaces(USER_A),
    formulator: {
      async formulate() {
        return [{
          space: "personal",
          project: "Boring Context",
          category: "decision",
          title: "Ship Friday",
          content: "We ship the brain on Friday.",
        }];
      },
    },
  });

  const result = await memory.getContext(USER_A, { prompt: "Ship the brain on Friday." });
  assert.ok("data" in result);
  assert.equal(result.data.written.length, 1);
  assert.equal(result.data.written[0]?.space, "personal");
  assert.equal(result.data.written[0]?.space_id, PERSONAL);
  const row = store.snapshot().find((item) => item.title === "Ship Friday");
  assert.equal(row?.source, "brain");
  assert.equal(row?.user_id, USER_A);
  const listed = await memory.searchInSpace(USER_A, PERSONAL, { query: "Friday" });
  assert.ok("data" in listed);
  assert.equal(listed.data[0]?.id, row?.id);
});

test("the same subject updates one row, versions the text, and refreshes the vector", async () => {
  const store = createInMemoryStore();
  const drafts: MemoryDraft[][] = [
    [{
      space: "personal",
      project: "Boring Context",
      category: "decision",
      title: "Ship Friday",
      content: "Ship on Friday.",
    }],
    [{
      space: "personal",
      project: "Boring Context",
      category: "decision",
      title: "Ship Friday",
      content: "Ship on Monday.",
    }],
    [{
      space: "personal",
      project: "Boring Context",
      category: "decision",
      title: "Ship Friday",
      content: "Ship on Monday.",
    }],
    [{
      space: "personal",
      project: "Boring Context",
      category: "fact",
      title: "Owner",
      content: "Melker owns the brain.",
    }],
  ];
  let step = 0;
  const embedding = embeddingFrom((text) => text.includes("Monday") ? [0, 1, 0] : [1, 0, 0]);
  const memory = createMemoryApi(store, {
    embedding,
    spaces: memberSpaces(USER_A),
    formulator: { async formulate() { return drafts[step++] ?? []; } },
  });

  const first = await memory.getContext(USER_A, { prompt: "Remember the ship decision." });
  const second = await memory.getContext(USER_A, { prompt: "The ship decision moved." });
  assert.ok("data" in first && "data" in second);
  const stamped = store.snapshot().find((item) => item.id === first.data.written[0]?.id);
  const third = await memory.getContext(USER_A, { prompt: "The ship decision moved again." });
  const fourth = await memory.getContext(USER_A, { prompt: "A different subject." });
  assert.ok("data" in third && "data" in fourth);
  assert.equal(second.data.written[0]?.id, first.data.written[0]?.id);
  assert.equal(third.data.written[0]?.id, first.data.written[0]?.id);
  assert.notEqual(fourth.data.written[0]?.id, first.data.written[0]?.id);

  const versions = await memory.listVersions(USER_A, first.data.written[0]!.id);
  assert.ok("data" in versions);
  assert.equal(versions.data.length, 1);
  assert.equal(versions.data[0]?.content, "Ship on Friday.");
  assert.equal("embedding" in (versions.data[0] ?? {}), false);

  const row = store.snapshot().find((item) => item.id === first.data.written[0]?.id);
  assert.equal(row?.content, "Ship on Monday.");
  assert.equal(row?.updated_at, stamped?.updated_at);
  assert.deepEqual(row?.embedding, [0, 1, 0]);
  assert.equal(store.snapshot().filter((item) => item.title === "Ship Friday").length, 1);
  assert.equal(store.snapshot().length, 2);
});

test("Boring Context and Boringcontext are one project", async () => {
  const store = createInMemoryStore();
  const memory = createMemoryApi(store, {
    spaces: memberSpaces(USER_A),
    embedding: embeddingFrom(() => [1, 0, 0]),
    formulator: {
      async formulate(): Promise<MemoryDraft[]> {
        return [
          {
            space: "personal",
            project: "Boring Context",
            category: "fact",
            title: "API path",
            content: "The API lives in apps/api.",
          },
          {
            space: "personal",
            project: "Boringcontext",
            category: "fact",
            title: "Dashboard",
            content: "The dashboard sends space_id.",
          },
        ];
      },
    },
  });
  const result = await memory.saveBrief(USER_A, { brief: "Notes about Boring Context." });
  assert.ok("data" in result);
  assert.equal(result.data.items.length, 2);
  assert.deepEqual(store.snapshot().map((row) => row.project), ["Boring Context", "Boring Context"]);
});

test("a throwing formulator still returns items and writes nothing", async () => {
  const store = createInMemoryStore();
  const memory = createMemoryApi(store, {
    spaces: memberSpaces(USER_A),
    embedding: embeddingFrom(() => [0, 1, 0]),
    formulator: {
      async formulate() {
        throw new Error("formulate down");
      },
    },
  });
  await memory.saveDashboardMemory(USER_A, {
    project: "Boring Context",
    category: "fact",
    title: "Raketmotor",
    content: "Hemlig konstruktion.",
  }, PERSONAL);
  const before = store.snapshot().length;

  const result = await memory.getContext(USER_A, { prompt: "Berätta om raketmotor" });
  assert.ok("data" in result);
  assert.equal(result.data.items[0]?.title, "Raketmotor");
  assert.deepEqual(result.data.written, []);
  assert.equal(store.snapshot().length, before);
});

test("save_memory stores each durable draft once and FORMULATE_FAILED writes nothing", async () => {
  const store = createInMemoryStore();
  let mode: "two" | "same" | "fail" = "two";
  const formulator: MemoryFormulator = {
    async formulate() {
      if (mode === "fail") throw new Error("down");
      if (mode === "same") {
        return [
          { space: "personal", project: "Boring Context", category: "fact", title: "API", content: "Routes stay stable." },
          { space: "personal", project: "Boring Context", category: "decision", title: "Model", content: "Sonnet formulates." },
        ];
      }
      return [
        { space: "personal", project: "Boring Context", category: "fact", title: "API", content: "Routes stay stable." },
        { space: "personal", project: "Boring Context", category: "decision", title: "Model", content: "Sonnet formulates." },
      ];
    },
  };
  const memory = createMemoryApi(store, {
    spaces: memberSpaces(USER_A),
    embedding: embeddingFrom(() => [1, 0, 0]),
    formulator,
  });

  const first = await memory.saveBrief(USER_A, {
    brief: "The API routes stay stable. Sonnet formulates memories.",
    prompt: "raw prompt that must not be stored",
  });
  assert.ok("data" in first);
  assert.equal(first.data.items.length, 2);
  mode = "same";
  const second = await memory.saveBrief(USER_A, { brief: "The API routes stay stable. Sonnet formulates memories." });
  assert.ok("data" in second);
  assert.deepEqual(
    second.data.items.map((item) => item.id).sort(),
    first.data.items.map((item) => item.id).sort(),
  );
  assert.equal(
    store.snapshot().some((row) => row.content.includes("raw prompt")),
    false,
  );
  const count = store.snapshot().length;
  mode = "fail";
  const failed = await memory.saveBrief(USER_A, { brief: "This brief cannot be formulated." });
  assert.ok("error" in failed);
  assert.equal(failed.error.code, "FORMULATE_FAILED");
  assert.equal(store.snapshot().length, count);
});

test("invalid drafts are skipped and at most eight rows are saved", async () => {
  const store = createInMemoryStore();
  const drafts: MemoryDraft[] = [
    { space: "nope", project: "Boring Context", category: "fact", title: "Bad space", content: "Skip me." },
    { space: "personal", project: "Boring Context", category: "nope", title: "Bad category", content: "Skip me." },
  ];
  for (let index = 0; index < 9; index += 1) {
    drafts.push({
      space: "personal",
      project: "Boring Context",
      category: "fact",
      title: `Valid ${index}`,
      content: `Durable fact ${index}.`,
    });
  }
  const memory = createMemoryApi(store, {
    spaces: memberSpaces(USER_A),
    embedding: embeddingFrom(() => [1, 0, 0]),
    formulator: { async formulate() { return drafts; } },
  });
  const result = await memory.saveBrief(USER_A, { brief: "Nine facts and two invalid drafts." });
  assert.ok("data" in result);
  assert.equal(result.data.items.length, 8);
  assert.equal(store.snapshot().length, 8);
  assert.equal(store.snapshot().some((row) => row.title === "Bad space"), false);
});

test("embedding failure on write keeps the row and an embed failure on read stays lexical", async () => {
  const store = createInMemoryStore();
  let failEmbed = true;
  const memory = createMemoryApi(store, {
    spaces: memberSpaces(USER_A),
    embedding: {
      dimensions: 3,
      async embed() {
        if (failEmbed) throw new Error("embed down");
        return [1, 0, 0];
      },
    },
    formulator: { async formulate() { return []; } },
  });
  const saved = await memory.saveDashboardMemory(USER_A, {
    project: "Boring Context",
    category: "fact",
    title: "Raketmotor",
    content: "Hemlig konstruktion.",
  }, PERSONAL);
  assert.ok("data" in saved);
  assert.equal(store.snapshot()[0]?.embedding, null);

  failEmbed = true;
  const lexical = await memory.getContext(USER_A, { prompt: "raketmotor" });
  assert.ok("data" in lexical);
  assert.equal(lexical.data.items[0]?.title, "Raketmotor");
});

test("four fields without a brief are INVALID_CONTENT", async () => {
  const store = createInMemoryStore();
  let formulated = 0;
  const memory = createMemoryApi(store, {
    spaces: memberSpaces(USER_A),
    formulator: {
      async formulate() {
        formulated += 1;
        return [];
      },
    },
  });
  const result = await memory.saveBrief(USER_A, {
    project: "Boring Context",
    category: "fact",
    title: "API",
    content: "Routes stay stable.",
  });
  assert.ok("error" in result);
  assert.equal(result.error.code, "INVALID_CONTENT");
  assert.equal(formulated, 0);
  assert.equal(store.snapshot().length, 0);
});

test("shared is personal unless the text explicitly asks for shared", async () => {
  const store = createInMemoryStore();
  const seen: string[] = [];
  const formulator: MemoryFormulator = {
    async formulate(input) {
      seen.push(input.text);
      assert.equal("content" in (input.existing[0] ?? {}), false);
      assert.equal("id" in (input.existing[0] ?? {}), false);
      return [{
        space: "shared",
        project: "Boring Context",
        category: "fact",
        title: input.text.includes("shared") ? "Shared fact" : "Personal fact",
        content: "Stored from the draft.",
      }];
    },
  };
  const memory = createMemoryApi(store, {
    spaces: memberSpaces(USER_A),
    embedding: embeddingFrom(() => [1, 0, 0]),
    formulator,
  });
  const personal = await memory.saveBrief(USER_A, { brief: "Remember the API path." });
  const shared = await memory.saveBrief(USER_A, { brief: "Please store this in the shared space." });
  assert.ok("data" in personal && "data" in shared);
  assert.equal(personal.data.items[0]?.space, "personal");
  assert.equal(personal.data.items[0]?.space_id, PERSONAL);
  assert.equal(shared.data.items[0]?.space, "shared");
  assert.equal(shared.data.items[0]?.space_id, SHARED);
});
