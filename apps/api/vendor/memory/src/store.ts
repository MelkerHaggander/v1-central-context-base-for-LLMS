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
  "after",
  "about",
  "again",
  "also",
  "alla",
  "allt",
  "am",
  "and",
  "använda",
  "använder",
  "använt",
  "are",
  "as",
  "att",
  "av",
  "bara",
  "be",
  "before",
  "been",
  "being",
  "berätta",
  "brief",
  "bör",
  "but",
  "can",
  "could",
  "de",
  "den",
  "det",
  "detta",
  "did",
  "din",
  "dina",
  "dit",
  "do",
  "does",
  "du",
  "då",
  "där",
  "eller",
  "en",
  "er",
  "era",
  "ett",
  "for",
  "from",
  "fråga",
  "från",
  "för",
  "får",
  "had",
  "han",
  "har",
  "has",
  "have",
  "he",
  "hennes",
  "här",
  "hon",
  "how",
  "hur",
  "is",
  "it",
  "its",
  "inte",
  "jag",
  "kort",
  "kunde",
  "later",
  "me",
  "mer",
  "mest",
  "mig",
  "kan",
  "mine",
  "med",
  "men",
  "min",
  "mina",
  "mot",
  "många",
  "måste",
  "my",
  "mycket",
  "någon",
  "något",
  "några",
  "nu",
  "och",
  "of",
  "också",
  "om",
  "on",
  "oss",
  "our",
  "på",
  "please",
  "redan",
  "sedan",
  "she",
  "short",
  "should",
  "sig",
  "sin",
  "sina",
  "sitt",
  "ska",
  "skall",
  "skulle",
  "som",
  "så",
  "tell",
  "than",
  "the",
  "their",
  "them",
  "then",
  "they",
  "this",
  "till",
  "to",
  "under",
  "upp",
  "us",
  "use",
  "used",
  "uses",
  "using",
  "ut",
  "utan",
  "vad",
  "var",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "vi",
  "vid",
  "vilken",
  "vill",
  "will",
  "with",
  "would",
  "vår",
  "våra",
  "vårt",
  "you",
  "your",
  "är",
  "än",
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

const CATEGORY_CUE_WORDS = new Set(
  Object.values(CATEGORY_CUES).flatMap((cues) => [...cues]),
);

const SYNONYM_GROUPS = [
  ["databas", "database"],
  ["lansera", "lansering", "launch"],
] as const;

const SWEDISH_SUFFIXES = [
  "heterna",
  "ornas",
  "ernas",
  "arnas",
  "elser",
  "heten",
  "anden",
  "andet",
  "ande",
  "ende",
  "orna",
  "erna",
  "arna",
  "ades",
  "ade",
  "ens",
  "ets",
  "ers",
  "ats",
  "ar",
  "er",
  "en",
  "et",
] as const;

function normalizedTokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("sv-SE")
    .replace(/[\p{P}\p{S}_]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

function stemSwedishToken(token: string): string {
  for (const suffix of SWEDISH_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function keywordForms(keyword: string): Set<string> {
  const stem = stemSwedishToken(keyword);
  const synonyms = SYNONYM_GROUPS.find((group) =>
    group.some((candidate) => stemSwedishToken(candidate) === stem),
  );
  return new Set([stem, ...(synonyms ?? []).map(stemSwedishToken)]);
}

function textStems(text: string): string[] {
  return normalizedTokens(text).map(stemSwedishToken);
}

function formMatchesToken(form: string, token: string): boolean {
  return form === token || (form.length >= 5 && token.startsWith(form));
}

function keywordMatches(forms: Set<string>, tokens: string[]): boolean {
  return [...forms].some((form) =>
    tokens.some((token) => formMatchesToken(form, token)),
  );
}

export function extractKeywords(prompt: string): string[] {
  if (typeof prompt !== "string") return [];
  return [
    ...new Set(
      normalizedTokens(prompt).filter(
        (token) =>
          token.length >= 3 &&
          !STOP_WORDS.has(token) &&
          !CATEGORY_CUE_WORDS.has(token),
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

function duplicateKey(row: MemoryRecord): string {
  return [
    row.project.normalize("NFKC").toLocaleLowerCase("sv-SE"),
    row.title.normalize("NFKC").toLocaleLowerCase("sv-SE"),
    row.category,
  ].join("\u0000");
}

function newestByIdentity(rows: MemoryRecord[]): {
  rows: MemoryRecord[];
  duplicateCounts: Map<string, number>;
} {
  const newest = new Map<string, MemoryRecord>();
  const duplicateCounts = new Map<string, number>();

  for (const row of rows) {
    const key = duplicateKey(row);
    const current = newest.get(key);
    if (!current) {
      newest.set(key, row);
      duplicateCounts.set(key, 0);
      continue;
    }

    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
    if (
      row.updated_at > current.updated_at ||
      (row.updated_at === current.updated_at && row.id > current.id)
    ) {
      newest.set(key, row);
    }
  }

  return { rows: [...newest.values()], duplicateCounts };
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
    const project = input.project.normalize("NFKC").toLocaleLowerCase("sv-SE");
    rows = rows.filter(
      (row) =>
        row.project.normalize("NFKC").toLocaleLowerCase("sv-SE") === project,
    );
  }

  const keywords = extractKeywords(prompt);
  const cues = categoryCues(prompt);
  const terms = keywords.map(keywordForms);
  const deduplicated = newestByIdentity(rows);
  const ranked = deduplicated.rows
    .map((row) => {
      const title = textStems(row.title);
      const content = textStems(row.content);
      const project = textStems(row.project);
      let titleHits = 0;
      let contentHits = 0;
      let projectHits = 0;
      let nonEntityMatches = 0;

      const entityTerms = terms.map((forms) => keywordMatches(forms, project));
      const hasNonEntityTerm = entityTerms.some((isEntity) => !isEntity);

      for (const [index, forms] of terms.entries()) {
        let matched = false;
        if (keywordMatches(forms, title)) {
          titleHits += 1;
          matched = true;
        } else if (keywordMatches(forms, content)) {
          contentHits += 1;
          matched = true;
        } else if (entityTerms[index]) {
          projectHits += 1;
          matched = true;
        }

        if (matched && !entityTerms[index]) {
          nonEntityMatches += 1;
        }
      }

      const matches = titleHits + contentHits + projectHits;
      const coverage = terms.length === 0 ? 0 : matches / terms.length;
      const hasRequiredContent = !hasNonEntityTerm || nonEntityMatches > 0;
      const lexicalScore = hasRequiredContent
        ? titleHits * 60 +
          contentHits * 25 +
          projectHits * 5 +
          nonEntityMatches * 10 +
          Math.round(coverage * 12)
        : 0;
      const categoryBoost =
        lexicalScore > 0 && cues.has(row.category) ? 8 : 0;
      return {
        row,
        key: duplicateKey(row),
        score: lexicalScore + categoryBoost,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.row.updated_at !== b.row.updated_at) {
        return a.row.updated_at < b.row.updated_at ? 1 : -1;
      }
      return a.row.id.localeCompare(b.row.id);
    });

  const duplicateOmitted = ranked.reduce(
    (total, { key }) => total + (deduplicated.duplicateCounts.get(key) ?? 0),
    0,
  );
  const relevantCount = ranked.length + duplicateOmitted;
  const packedKeywords = outputKeywords(keywords, input.project, relevantCount);
  const items: ContextItem[] = [];
  for (const { row } of ranked) {
    if (items.length >= CONTEXT_ITEM_LIMIT) break;
    const item = contextItem(row);
    const next = [...items, item];
    const candidate = contextResult(
      packedKeywords,
      input.project,
      next,
      relevantCount - next.length,
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
      relevantCount - items.length,
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
