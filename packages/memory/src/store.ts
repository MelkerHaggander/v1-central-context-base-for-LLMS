import type {
  Category,
  ContextInput,
  ContextItem,
  ContextResult,
  MemoryInput,
  MemoryRecord,
  Result,
  SearchInput,
} from "./types";
import { fail, validateMemoryId, validateMemoryInput, validateSearchInput } from "./validate";

export const PAGE_SIZE = 50;
export const CONTEXT_ITEM_LIMIT = 8;
export const CONTEXT_SNIPPET_LIMIT = 280;
export const CONTEXT_JSON_LIMIT = 3500;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "alla",
  "allt",
  "also",
  "and",
  "are",
  "att",
  "av",
  "before",
  "but",
  "den",
  "det",
  "din",
  "dina",
  "dit",
  "eller",
  "en",
  "ett",
  "for",
  "från",
  "för",
  "har",
  "hur",
  "inte",
  "jag",
  "kan",
  "med",
  "men",
  "min",
  "mina",
  "mot",
  "när",
  "och",
  "om",
  "oss",
  "our",
  "ska",
  "som",
  "the",
  "their",
  "this",
  "till",
  "vad",
  "var",
  "vi",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
  "över",
]);

const CATEGORY_CUES: Record<Category, Set<string>> = {
  fact: new Set(["fact", "facts", "fakta", "faktum"]),
  decision: new Set([
    "beslut",
    "beslutade",
    "bestämt",
    "bestämdes",
    "decide",
    "decided",
    "decision",
    "valde",
  ]),
  goal: new Set(["goal", "goals", "mål", "målet", "målbild", "objective"]),
  deadline: new Set([
    "date",
    "datum",
    "deadline",
    "deadlines",
    "due",
    "förfallodatum",
    "lansera",
    "lansering",
    "leverans",
    "när",
    "tidsfrist",
    "when",
  ]),
  preference: new Set([
    "föredrar",
    "prefer",
    "preference",
    "preferences",
    "preferens",
    "preferenser",
  ]),
  lesson: new Set([
    "learned",
    "lesson",
    "lessons",
    "lärdom",
    "lärdomar",
    "lärt",
    "misstag",
  ]),
};

function normalizedTokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("sv-SE")
    .replace(/[\p{P}\p{S}_]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

export function extractKeywords(prompt: string): string[] {
  if (typeof prompt !== "string") return [];
  return [
    ...new Set(
      normalizedTokens(prompt).filter(
        (token) => token.length >= 3 && !STOP_WORDS.has(token),
      ),
    ),
  ];
}

function categoryCues(prompt: string): Set<Category> {
  const tokens = new Set(normalizedTokens(prompt));
  return new Set(
    (Object.entries(CATEGORY_CUES) as Array<[Category, Set<string>]>)
      .filter(([, cues]) => [...cues].some((cue) => tokens.has(cue)))
      .map(([category]) => category),
  );
}

function snippet(content: string): string {
  const compact = content.trim().replace(/\s+/gu, " ");
  if (compact.length <= CONTEXT_SNIPPET_LIMIT) return compact;
  return `${compact.slice(0, CONTEXT_SNIPPET_LIMIT - 1).trimEnd()}…`;
}

function contextItem(row: MemoryRecord): ContextItem {
  return {
    id: row.id,
    project: row.project,
    category: row.category,
    title: row.title,
    snippet: snippet(row.content),
  };
}

function contextResult(
  keywords: string[],
  project: string | undefined,
  items: ContextItem[],
  omitted: number,
): ContextResult {
  return {
    keywords,
    ...(project === undefined ? {} : { project }),
    items,
    omitted,
  };
}

function outputKeywords(keywords: string[], project: string | undefined, omitted: number): string[] {
  const packed: string[] = [];
  for (const keyword of keywords) {
    if (packed.length >= 32) break;
    const next = [...packed, keyword];
    if (JSON.stringify(contextResult(next, project, [], omitted)).length > 1000) break;
    packed.push(keyword);
  }
  return packed;
}

export type NormalizedMemoryInput = {
  project: string;
  category: string;
  title: string;
  content: string;
};

export type MemoryStore = {
  insert(
    userId: string,
    fields: NormalizedMemoryInput,
  ): Promise<
    | { kind: "created"; row: MemoryRecord }
    | { kind: "duplicate" }
    | { kind: "failed"; code: "SAVE_FAILED"; message: string }
  >;
  findIdentical(userId: string, fields: NormalizedMemoryInput): Promise<MemoryRecord | null>;
  update(
    userId: string,
    id: string,
    fields: NormalizedMemoryInput,
  ): Promise<
    | { kind: "updated"; row: MemoryRecord }
    | { kind: "missing" }
    | { kind: "failed"; code: "UPDATE_FAILED"; message: string }
  >;
  remove(
    userId: string,
    id: string,
  ): Promise<
    | { kind: "deleted" }
    | { kind: "missing" }
    | { kind: "failed"; code: "DELETE_FAILED"; message: string }
  >;
  listByUser(userId: string): Promise<MemoryRecord[]>;
};

export function cleanSearchQuery(query: string): string {
  return query.replace(/[%_,()]/g, " ").trim();
}

export async function saveMemory(
  userId: string,
  input: MemoryInput,
  store: MemoryStore,
): Promise<Result<MemoryRecord>> {
  const parsed = validateMemoryInput(input);
  if ("error" in parsed) return parsed;

  const inserted = await store.insert(userId, parsed.data);
  if (inserted.kind === "created") {
    return { data: inserted.row };
  }
  if (inserted.kind === "duplicate") {
    const existing = await store.findIdentical(userId, parsed.data);
    if (existing) return { data: existing };
  }
  return fail("SAVE_FAILED", "Kunde inte spara minnet.");
}

export async function searchMemory(
  userId: string,
  input: SearchInput,
  store: MemoryStore,
): Promise<Result<MemoryRecord[]>> {
  const parsed = validateSearchInput(input);
  if ("error" in parsed) return parsed;

  let rows: MemoryRecord[];
  try {
    rows = await store.listByUser(userId);
  } catch {
    return fail("SEARCH_FAILED", "Kunde inte söka minnen.");
  }

  if (parsed.data.project) {
    rows = rows.filter((row) => row.project === parsed.data.project);
  }
  if (parsed.data.category) {
    rows = rows.filter((row) => row.category === parsed.data.category);
  }
  if (parsed.data.query) {
    const q = cleanSearchQuery(parsed.data.query);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.title.toLowerCase().includes(needle) ||
          row.content.toLowerCase().includes(needle),
      );
    }
  }

  rows = [...rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  return { data: rows.slice(parsed.data.offset, parsed.data.offset + PAGE_SIZE) };
}

export async function getContext(
  userId: string,
  input: ContextInput,
  store: MemoryStore,
): Promise<Result<ContextResult>> {
  const rawPrompt = typeof input?.prompt === "string" ? input.prompt : "";
  const prompt = rawPrompt.trim();
  if (prompt.length < 1 || rawPrompt.length > 8000) {
    return fail("INVALID_PROMPT", "prompt måste vara 1–8 000 tecken.");
  }

  let rows: MemoryRecord[];
  try {
    rows = await store.listByUser(userId);
  } catch {
    return fail("SEARCH_FAILED", "Kunde inte söka minnen.");
  }

  if (input.project !== undefined) {
    rows = rows.filter((row) => row.project === input.project);
  }

  const keywords = extractKeywords(prompt);
  const cues = categoryCues(prompt);
  const ranked = rows
    .map((row) => {
      const title = row.title.toLocaleLowerCase("sv-SE");
      const content = row.content.toLocaleLowerCase("sv-SE");
      let titleHits = 0;
      let contentHits = 0;

      for (const keyword of keywords) {
        if (title.includes(keyword)) {
          titleHits += 1;
        } else if (content.includes(keyword)) {
          contentHits += 1;
        }
      }

      const matches = titleHits + contentHits;
      const coverage = keywords.length === 0 ? 0 : matches / keywords.length;
      const categoryBoost = cues.has(row.category) ? 30 : 0;
      const score = titleHits * 100 + contentHits * 20 + Math.round(coverage * 10) + categoryBoost;
      return { row, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.row.updated_at !== b.row.updated_at) {
        return a.row.updated_at < b.row.updated_at ? 1 : -1;
      }
      return a.row.id.localeCompare(b.row.id);
    });

  const packedKeywords = outputKeywords(keywords, input.project, ranked.length);
  const items: ContextItem[] = [];
  for (const { row } of ranked) {
    if (items.length >= CONTEXT_ITEM_LIMIT) break;
    const item = contextItem(row);
    const next = [...items, item];
    const candidate = contextResult(
      packedKeywords,
      input.project,
      next,
      ranked.length - next.length,
    );
    if (JSON.stringify(candidate).length <= CONTEXT_JSON_LIMIT) {
      items.push(item);
    }
  }

  return {
    data: contextResult(
      packedKeywords,
      input.project,
      items,
      ranked.length - items.length,
    ),
  };
}

export async function updateMemory(
  userId: string,
  input: MemoryInput & { id: string },
  store: MemoryStore,
): Promise<Result<MemoryRecord>> {
  const idCheck = validateMemoryId(input.id);
  if ("error" in idCheck) return idCheck;

  const parsed = validateMemoryInput(input);
  if ("error" in parsed) return parsed;

  const updated = await store.update(userId, idCheck.data, parsed.data);
  if (updated.kind === "updated") {
    return { data: updated.row };
  }
  if (updated.kind === "missing") {
    return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
  }
  return fail("UPDATE_FAILED", "Kunde inte uppdatera minnet.");
}

export async function deleteMemory(
  userId: string,
  id: string,
  store: MemoryStore,
): Promise<Result<{ success: true }>> {
  const idCheck = validateMemoryId(id);
  if ("error" in idCheck) return idCheck;

  const removed = await store.remove(userId, idCheck.data);
  if (removed.kind === "deleted") {
    return { data: { success: true } };
  }
  if (removed.kind === "missing") {
    return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
  }
  return fail("DELETE_FAILED", "Kunde inte radera minnet.");
}

export function createMemoryApi(store: MemoryStore) {
  return {
    saveMemory: (userId: string, input: MemoryInput) => saveMemory(userId, input, store),
    searchMemory: (userId: string, input: SearchInput) => searchMemory(userId, input, store),
    getContext: (userId: string, input: ContextInput) => getContext(userId, input, store),
    updateMemory: (userId: string, input: MemoryInput & { id: string }) =>
      updateMemory(userId, input, store),
    deleteMemory: (userId: string, id: string) => deleteMemory(userId, id, store),
    saveLesson: (
      userId: string,
      input: { project: string; title: string; content: string },
    ) => saveMemory(userId, { ...input, category: "lesson" }, store),
  };
}
