import {
  applyVectorRanking,
  attachEmbedding,
  canonicalProject,
  persistDrafts,
  projectKey,
  recentIdentities,
} from "./brain";
import type {
  BrainDeps,
  Category,
  ContextInput,
  ContextItem,
  ContextResult,
  MemoryIdentity,
  MemoryInput,
  MemoryRecord,
  MemoryVersion,
  Result,
  SaveBriefInput,
  SaveBriefResult,
  SearchInput,
  SpaceAccess,
  SubjectWrite,
  UpdateMemoryInput,
  WrittenMemory,
} from "./types";
import { fail, validateMemoryId, validateMemoryInput, validateSearchInput } from "./validate";

export const PAGE_SIZE = 50;
export const CONTEXT_ITEM_LIMIT = 8;
export const CONTEXT_SNIPPET_LIMIT = 280;
export const CONTEXT_JSON_LIMIT = 3500;
export const SAVED_ROW_LIMIT = 8;

const STOP_WORDS = new Set([
  "ahead",
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
  "framför",
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
  "innan",
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
  "behöver",
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
  "vilka",
  "vill",
  "will",
  "with",
  "would",
  "vår",
  "våra",
  "vårt",
  "gång",
  "gör",
  "göra",
  "need",
  "needs",
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
    "beslutet",
    "bestämt",
    "bestämdes",
    "decide",
    "decided",
    "decision",
    "decisions",
    "valde",
  ]),
  goal: new Set(["goal", "goals", "mål", "målen", "målet", "målbild", "objective"]),
  deadline: new Set([
    "kommande",
    "lansering",
    "date",
    "datum",
    "deadline",
    "deadlines",
    "due",
    "när",
    "tidsfrist",
    "tidsfrister",
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

const LEXICAL_CATEGORY_CUES = new Set(["lansering"]);
const CATEGORY_CUE_WORDS = new Set(
  Object.values(CATEGORY_CUES)
    .flatMap((cues) => [...cues])
    .filter((cue) => !LEXICAL_CATEGORY_CUES.has(cue)),
);

const SYNONYM_GROUPS = [
  ["databas", "database"],
  ["lanser", "lansera", "lansering", "launch"],
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
  return form === token || (form.length >= 7 && token.startsWith(form));
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
          (token.length >= 3 || /^\d+$/u.test(token)) &&
          !STOP_WORDS.has(token) &&
          !CATEGORY_CUE_WORDS.has(token),
      ),
    ),
  ];
}

function categoryCues(prompt: string): Set<Category> {
  const tokens = new Set(normalizedTokens(prompt));
  const cues = new Set(
    (Object.entries(CATEGORY_CUES) as Array<[Category, Set<string>]>)
      .filter(([, cues]) => [...cues].some((cue) => tokens.has(cue)))
      .map(([category]) => category),
  );
  const normalized = [...tokens].join(" ");
  if (
    normalized.includes("vad är på gång") ||
    normalized.includes("what is coming up")
  ) {
    cues.add("deadline");
  }
  return cues;
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

type MatchSpan = {
  start: number;
  end: number;
  term: number;
};

function contentMatchSpans(content: string, terms: Set<string>[]): MatchSpan[] {
  const spans: MatchSpan[] = [];
  for (const match of content.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = stemSwedishToken(match[0].toLocaleLowerCase("sv-SE"));
    const start = match.index ?? 0;
    for (const [term, forms] of terms.entries()) {
      if ([...forms].some((form) => formMatchesToken(form, token))) {
        spans.push({
          start,
          end: start + match[0].length,
          term,
        });
      }
    }
  }
  return spans;
}

function bestMatchSpan(spans: MatchSpan[]): MatchSpan | undefined {
  let best: { span: MatchSpan; score: number } | undefined;
  for (const span of spans) {
    const center = (span.start + span.end) / 2;
    const nearby = spans.filter(
      (candidate) =>
        Math.abs((candidate.start + candidate.end) / 2 - center) <=
        CONTEXT_SNIPPET_LIMIT / 2,
    );
    const score = new Set(nearby.map((candidate) => candidate.term)).size * 10 + nearby.length;
    if (!best || score > best.score) best = { span, score };
  }
  return best?.span;
}

function escapeUserText(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;");
}

function snapToWordBoundaries(
  content: string,
  left: number,
  right: number,
  match?: MatchSpan,
): { left: number; right: number } {
  const requiredStart = match?.start ?? right;
  const requiredEnd = match?.end ?? 0;

  while (
    left > 0 &&
    left < requiredStart &&
    /\S/u.test(content[left - 1] ?? "") &&
    /\S/u.test(content[left] ?? "")
  ) {
    left += 1;
  }
  while (left < requiredStart && /\s/u.test(content[left] ?? "")) left += 1;

  while (
    right < content.length &&
    right > requiredEnd &&
    /\S/u.test(content[right - 1] ?? "") &&
    /\S/u.test(content[right] ?? "")
  ) {
    right -= 1;
  }
  while (right > requiredEnd && /\s/u.test(content[right - 1] ?? "")) right -= 1;

  return { left, right };
}

function escapedWindow(content: string, match?: MatchSpan): string {
  if (!content) return "";

  let left = match?.start ?? 0;
  let right = match?.end ?? 0;
  let expandLeft = true;

  const value = (start: number, end: number) => {
    const body = escapeUserText(content.slice(start, end).trim());
    return `${start > 0 ? "…" : ""}${body}${end < content.length ? "…" : ""}`;
  };

  if (!match) {
    while (
      right < content.length &&
      value(0, right + 1).length <= CONTEXT_SNIPPET_LIMIT
    ) {
      right += 1;
    }
    const snapped = snapToWordBoundaries(content, 0, right);
    return value(snapped.left, snapped.right > 0 ? snapped.right : right);
  }

  while (value(left, right).length > CONTEXT_SNIPPET_LIMIT && right > left) {
    right -= 1;
  }

  let leftBlocked = left === 0;
  let rightBlocked = right === content.length;
  while (!leftBlocked || !rightBlocked) {
    const tryLeft = expandLeft && !leftBlocked;
    const nextLeft = tryLeft ? Math.max(0, left - 1) : left;
    const nextRight =
      !tryLeft && !rightBlocked ? Math.min(content.length, right + 1) : right;
    if (value(nextLeft, nextRight).length <= CONTEXT_SNIPPET_LIMIT) {
      left = nextLeft;
      right = nextRight;
      if (left === 0) leftBlocked = true;
      if (right === content.length) rightBlocked = true;
    } else if (tryLeft) {
      leftBlocked = true;
    } else {
      rightBlocked = true;
    }
    expandLeft = !expandLeft;
  }
  const snapped = snapToWordBoundaries(content, left, right, match);
  return value(snapped.left, snapped.right);
}

function snippet(content: string, terms: Set<string>[]): string {
  const compact = content.trim().replace(/\s+/gu, " ");
  const span = bestMatchSpan(contentMatchSpans(compact, terms));
  return escapedWindow(compact, span);
}

function contextItem(row: MemoryRecord, terms: Set<string>[]): ContextItem {
  return {
    id: row.id,
    project: row.project,
    category: row.category,
    title: row.title,
    snippet: snippet(row.content, terms),
    updated_at: row.updated_at,
    source: "user_memory",
  };
}

function contextResult(
  keywords: string[],
  project: string | undefined,
  projects: string[] | undefined,
  items: ContextItem[],
  omittedDuplicate: number,
  omittedCapped: number,
): Omit<ContextResult, "written"> {
  return {
    keywords,
    ...(project === undefined ? {} : { project }),
    ...(projects === undefined ? {} : { projects }),
    items,
    omitted: omittedDuplicate + omittedCapped,
    omitted_duplicate: omittedDuplicate,
    omitted_capped: omittedCapped,
  };
}

function outputKeywords(
  keywords: string[],
  project: string | undefined,
  projects: string[] | undefined,
  omittedDuplicate: number,
  omittedCapped: number,
): string[] {
  const packed: string[] = [];
  for (const keyword of keywords) {
    if (packed.length >= 32) break;
    const next = [...packed, keyword];
    if (
      JSON.stringify(
        contextResult(
          next,
          project,
          projects,
          [],
          omittedDuplicate,
          omittedCapped,
        ),
      ).length > 1000
    ) {
      break;
    }
    packed.push(keyword);
  }
  return packed;
}

function compactProjects(rows: MemoryRecord[]): string[] {
  const newest = new Map<string, MemoryRecord>();
  for (const row of rows) {
    const key = row.project.normalize("NFKC").toLocaleLowerCase("sv-SE");
    const current = newest.get(key);
    if (!current || row.updated_at > current.updated_at) newest.set(key, row);
  }

  const projects: string[] = [];
  for (const row of [...newest.values()].sort((a, b) =>
    a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
  )) {
    if (projects.length >= 8) break;
    const next = [...projects, row.project];
    if (JSON.stringify(next).length > 500) break;
    projects.push(row.project);
  }
  return projects;
}

export type NormalizedMemoryInput = {
  project: string;
  category: string;
  title: string;
  content: string;
};

export type NearestHit = {
  row: MemoryRecord;
  similarity: number;
};

export type SubjectUpsert =
  | { kind: "created" | "updated" | "unchanged"; row: MemoryRecord }
  | { kind: "failed"; code: "SAVE_FAILED"; message: string };

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
  listBySpaces?(userId: string, spaceIds: string[]): Promise<MemoryRecord[]>;
  listNearest?(
    userId: string,
    embedding: number[],
    spaceIds: string[],
    limit: number,
  ): Promise<NearestHit[]>;
  listNeighbors?(
    userId: string,
    seedIds: string[],
    spaceIds: string[],
    minSimilarity: number,
    limit: number,
  ): Promise<NearestHit[]>;
  listIdentities?(
    userId: string,
    spaceIds: string[],
    limit: number,
  ): Promise<MemoryIdentity[]>;
  upsertSubject?(userId: string, fields: SubjectWrite): Promise<SubjectUpsert>;
  setEmbedding?(id: string, embedding: number[] | null): Promise<void>;
  hasEmbedding?(id: string): Promise<boolean>;
  listVersions?(memoryId: string): Promise<MemoryVersion[] | null>;
  spaceOf?(memoryId: string): Promise<string | null>;
  removeById?(
    id: string,
  ): Promise<
    | { kind: "deleted" }
    | { kind: "missing" }
    | { kind: "failed"; code: "DELETE_FAILED"; message: string }
  >;
  updateById?(
    id: string,
    fields: NormalizedMemoryInput,
  ): Promise<
    | { kind: "updated"; row: MemoryRecord }
    | { kind: "missing" }
    | { kind: "failed"; code: "UPDATE_FAILED"; message: string }
  >;
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

    let rows: MemoryRecord[];
    try {
      rows = await store.listByUser(userId);
    } catch {
      return fail("SAVE_FAILED", "Kunde inte spara minnet.");
    }
    const nearDuplicate = rows.find(
      (row) =>
        row.project === parsed.data.project &&
        row.category === parsed.data.category &&
        row.title === parsed.data.title,
    );
    if (nearDuplicate) {
      const updated = await store.update(userId, nearDuplicate.id, parsed.data);
      if (updated.kind === "updated") return { data: updated.row };
    }
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

async function loadContextRows(
  userId: string,
  store: MemoryStore,
  brain?: BrainDeps,
): Promise<{ rows: MemoryRecord[]; spaceIds: string[] | null }> {
  if (brain?.spaces && store.listBySpaces) {
    try {
      const spaceIds = await brain.spaces.readableSpaceIds(userId);
      return { rows: await store.listBySpaces(userId, spaceIds), spaceIds };
    } catch {
      return { rows: await store.listByUser(userId), spaceIds: null };
    }
  }
  return { rows: await store.listByUser(userId), spaceIds: null };
}

export async function getContext(
  userId: string,
  input: ContextInput,
  store: MemoryStore,
  brain?: BrainDeps,
): Promise<Result<ContextResult>> {
  const rawPrompt = typeof input?.prompt === "string" ? input.prompt : "";
  const prompt = rawPrompt.trim();
  if (prompt.length < 1 || rawPrompt.length > 8000) {
    return fail("INVALID_PROMPT", "prompt måste vara 1–8 000 tecken.");
  }

  let rows: MemoryRecord[];
  let spaceIds: string[] | null = null;
  try {
    const loaded = await loadContextRows(userId, store, brain);
    rows = loaded.rows;
    spaceIds = loaded.spaceIds;
  } catch {
    return fail("SEARCH_FAILED", "Kunde inte söka minnen.");
  }

  const projects = input.project === undefined ? compactProjects(rows) : undefined;
  let responseProject = input.project;
  if (input.project !== undefined) {
    const key = projectKey(input.project);
    const spelled = rows.find((row) => projectKey(row.project) === key);
    if (spelled) responseProject = spelled.project;
    rows = rows.filter((row) => projectKey(row.project) === key);
  }

  const keywords = extractKeywords(prompt);
  const cues = categoryCues(prompt);
  const terms = keywords.map(keywordForms);
  const deduplicated = newestByIdentity(rows);
  const scored = deduplicated.rows.map((row) => {
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
        lexicalScore,
        score: lexicalScore + categoryBoost,
      };
    });
  const hasLexicalMatch = scored.some(({ lexicalScore }) => lexicalScore > 0);
  let ranked = scored
    .map((candidate) => ({
      ...candidate,
      score:
        candidate.score +
        (!hasLexicalMatch && cues.has(candidate.row.category) ? 20 : 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.row.updated_at !== b.row.updated_at) {
        return a.row.updated_at < b.row.updated_at ? 1 : -1;
      }
      return a.row.id.localeCompare(b.row.id);
    });

  if (brain?.embedding && spaceIds && store.listNearest) {
    try {
      ranked = await applyVectorRanking({
        userId,
        prompt,
        spaceIds,
        store,
        embedding: brain.embedding,
        ranked,
        keyFor: duplicateKey,
      });
    } catch {
      // Missing embedding column or a failed embed call keeps today's lexical ranking.
    }
  }

  const duplicateOmitted = ranked.reduce(
    (total, { key }) => total + (deduplicated.duplicateCounts.get(key) ?? 0),
    0,
  );
  const packedKeywords = outputKeywords(
    keywords,
    responseProject,
    projects,
    duplicateOmitted,
    ranked.length,
  );
  const items: ContextItem[] = [];
  for (const { row } of ranked) {
    if (items.length >= CONTEXT_ITEM_LIMIT) break;
    const item = contextItem(row, terms);
    const next = [...items, item];
    const candidate = contextResult(
      packedKeywords,
      responseProject,
      projects,
      next,
      duplicateOmitted,
      ranked.length - next.length,
    );
    if (JSON.stringify(candidate).length <= CONTEXT_JSON_LIMIT) {
      items.push(item);
    }
  }

  const packed = contextResult(
    packedKeywords,
    responseProject,
    projects,
    items,
    duplicateOmitted,
    ranked.length - items.length,
  );
  const written = await writtenFromPrompt(userId, prompt, input.project, spaceIds, store, brain);
  return { data: { ...packed, written } };
}

async function writtenFromPrompt(
  userId: string,
  prompt: string,
  project: string | undefined,
  spaceIds: string[] | null,
  store: MemoryStore,
  brain?: BrainDeps,
): Promise<WrittenMemory[]> {
  if (!brain?.formulator) return [];
  try {
    const existing = await recentIdentities(userId, spaceIds ?? [], store);
    const drafts = await brain.formulator.formulate({
      source: "get_context",
      text: prompt,
      project,
      existing,
    });
    return persistDrafts({
      userId,
      drafts,
      text: prompt,
      project,
      store,
      brain,
      limit: SAVED_ROW_LIMIT,
    });
  } catch {
    return [];
  }
}

function briefError(input: SaveBriefInput): Result<never> | null {
  const brief = typeof input.brief === "string" ? input.brief.trim() : "";
  if (brief.length < 1 || brief.length > 10_000) {
    return fail("INVALID_CONTENT", "brief måste vara 1–10 000 tecken.");
  }
  return null;
}

export async function saveBrief(
  userId: string,
  input: SaveBriefInput,
  store: MemoryStore,
  brain?: BrainDeps,
): Promise<Result<SaveBriefResult>> {
  const invalid = briefError(input);
  if (invalid) return invalid;
  if (!brain?.formulator) {
    return fail("FORMULATE_FAILED", "Kunde inte tolka minnet.");
  }

  const brief = input.brief?.trim() ?? "";
  let spaceIds: string[] = [];
  try {
    spaceIds = (await brain.spaces?.readableSpaceIds(userId)) ?? [];
  } catch {
    spaceIds = [];
  }

  let drafts;
  try {
    const existing = await recentIdentities(userId, spaceIds, store);
    drafts = await brain.formulator.formulate({
      source: "save_memory",
      text: brief,
      project: input.project,
      prompt: input.prompt,
      existing,
    });
  } catch {
    return fail("FORMULATE_FAILED", "Kunde inte tolka minnet.");
  }

  const items = await persistDrafts({
    userId,
    drafts,
    text: [brief, input.prompt ?? ""].filter(Boolean).join("\n"),
    project: input.project,
    store,
    brain,
    limit: SAVED_ROW_LIMIT,
  });
  return { data: { items } };
}

export async function saveDashboardMemory(
  userId: string,
  input: MemoryInput,
  spaceId: string,
  store: MemoryStore,
  brain?: BrainDeps,
): Promise<Result<MemoryRecord>> {
  if (!brain?.spaces) {
    return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.");
  }
  let member = false;
  try {
    member = await brain.spaces.isMember(userId, spaceId);
  } catch {
    member = false;
  }
  if (!member) {
    return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.");
  }
  if (!store.upsertSubject) {
    return fail("SAVE_FAILED", "Kunde inte spara minnet.");
  }

  const parsed = validateMemoryInput(input);
  if ("error" in parsed) return parsed;

  let projects: string[] = [];
  try {
    const rows = store.listBySpaces
      ? await store.listBySpaces(userId, [spaceId])
      : await store.listByUser(userId);
    projects = rows.map((row) => row.project);
  } catch {
    projects = [];
  }
  const project = canonicalProject(parsed.data.project, projects);
  const saved = await store.upsertSubject(userId, {
    spaceId,
    project,
    category: parsed.data.category,
    title: parsed.data.title,
    content: parsed.data.content,
    source: "dashboard",
  });
  if (saved.kind === "failed") {
    return fail("SAVE_FAILED", "Kunde inte spara minnet.");
  }
  await attachEmbedding(store, brain.embedding, saved.row);
  return { data: saved.row };
}

export async function searchInSpace(
  userId: string,
  spaceId: string,
  input: SearchInput,
  store: MemoryStore,
  spaces: SpaceAccess,
): Promise<Result<MemoryRecord[]>> {
  let member = false;
  try {
    member = await spaces.isMember(userId, spaceId);
  } catch {
    member = false;
  }
  if (!member) {
    return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.");
  }
  if (!store.listBySpaces) {
    return fail("SEARCH_FAILED", "Kunde inte söka minnen.");
  }

  const parsed = validateSearchInput(input);
  if ("error" in parsed) return parsed;

  let rows: MemoryRecord[];
  try {
    rows = await store.listBySpaces(userId, [spaceId]);
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

export async function listMemoryVersions(
  userId: string,
  id: string,
  store: MemoryStore,
  spaces?: SpaceAccess,
): Promise<Result<MemoryVersion[]>> {
  const idCheck = validateMemoryId(id);
  if ("error" in idCheck) return idCheck;
  if (!store.listVersions || !store.spaceOf) {
    return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
  }
  const spaceId = await store.spaceOf(idCheck.data);
  if (!spaceId) {
    return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
  }
  if (spaces) {
    const member = await spaces.isMember(userId, spaceId);
    if (!member) {
      return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.");
    }
  }
  const versions = await store.listVersions(idCheck.data);
  if (!versions) {
    return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
  }
  return {
    data: versions.map((version) => ({
      version_number: version.version_number,
      space_id: version.space_id,
      project: version.project,
      category: version.category,
      title: version.title,
      content: version.content,
      source: version.source,
      created_at: version.created_at,
    })),
  };
}

async function loadOwnedOrShared(
  userId: string,
  id: string,
  store: MemoryStore,
  spaces?: SpaceAccess,
): Promise<Result<MemoryRecord>> {
  if (spaces && store.spaceOf && store.listBySpaces) {
    const spaceId = await store.spaceOf(id);
    if (spaceId) {
      const member = await spaces.isMember(userId, spaceId);
      if (!member) return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.");
      const row = (await store.listBySpaces(userId, [spaceId])).find((candidate) => candidate.id === id);
      if (!row) return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
      return { data: row };
    }
  }
  try {
    const row = (await store.listByUser(userId)).find((candidate) => candidate.id === id);
    if (!row) return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
    return { data: row };
  } catch {
    return fail("UPDATE_FAILED", "Kunde inte uppdatera minnet.");
  }
}

export async function updateMemory(
  userId: string,
  input: UpdateMemoryInput,
  store: MemoryStore,
  brain?: BrainDeps,
): Promise<Result<MemoryRecord>> {
  const idCheck = validateMemoryId(input.id);
  if ("error" in idCheck) return idCheck;

  const parsed = validateMemoryInput(input);
  if ("error" in parsed) return parsed;

  const loaded = await loadOwnedOrShared(userId, idCheck.data, store, brain?.spaces);
  if ("error" in loaded) {
    if (loaded.error.code === "UPDATE_FAILED" && !brain?.spaces) return loaded;
    if (loaded.error.code === "NOT_FOUND" || loaded.error.code === "FORBIDDEN") return loaded;
    if ("error" in loaded) return loaded;
  }
  const existing = loaded.data;
  const project =
    projectKey(parsed.data.project) === projectKey(existing.project)
      ? existing.project
      : parsed.data.project;
  const fields = { ...parsed.data, project };
  if (existing.project !== fields.project && input.allow_project_change !== true) {
    return fail(
      "PROJECT_CHANGE_REQUIRES_FLAG",
      "Projektbyte kräver allow_project_change: true.",
    );
  }
  if (fields.category === "lesson" && existing.category !== "lesson") {
    return fail(
      "LESSON_CATEGORY_REQUIRES_TOOL",
      "Ett vanligt minne kan inte ändras till lesson; använd lesson_memory.",
    );
  }

  const inSpace = Boolean(brain?.spaces && store.spaceOf && (await store.spaceOf(idCheck.data)));
  const updated =
    inSpace && store.updateById
      ? await store.updateById(idCheck.data, fields)
      : await store.update(userId, idCheck.data, fields);
  if (updated.kind === "updated") {
    const textChanged =
      existing.title !== fields.title || existing.content !== fields.content;
    if (textChanged || (store.hasEmbedding && !(await store.hasEmbedding(updated.row.id)))) {
      await attachEmbedding(store, brain?.embedding, updated.row);
    }
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
  spaces?: SpaceAccess,
): Promise<Result<{ success: true }>> {
  const idCheck = validateMemoryId(id);
  if ("error" in idCheck) return idCheck;

  if (spaces && store.spaceOf && store.removeById) {
    const spaceId = await store.spaceOf(idCheck.data);
    if (spaceId) {
      const member = await spaces.isMember(userId, spaceId);
      if (!member) return fail("FORBIDDEN", "Du är inte medlem i det utrymmet.");
      const removed = await store.removeById(idCheck.data);
      if (removed.kind === "deleted") return { data: { success: true } };
      if (removed.kind === "missing") {
        return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
      }
      return fail("DELETE_FAILED", "Kunde inte radera minnet.");
    }
  }

  const removed = await store.remove(userId, idCheck.data);
  if (removed.kind === "deleted") {
    return { data: { success: true } };
  }
  if (removed.kind === "missing") {
    return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");
  }
  return fail("DELETE_FAILED", "Kunde inte radera minnet.");
}

export function createMemoryApi(store: MemoryStore, brain: BrainDeps = {}) {
  return {
    saveMemory: (userId: string, input: MemoryInput) => saveMemory(userId, input, store),
    searchMemory: (userId: string, input: SearchInput) => searchMemory(userId, input, store),
    searchInSpace: (userId: string, spaceId: string, input: SearchInput) => {
      if (!brain.spaces) return Promise.resolve(fail("FORBIDDEN", "Du är inte medlem i det utrymmet."));
      return searchInSpace(userId, spaceId, input, store, brain.spaces);
    },
    getContext: (userId: string, input: ContextInput) => getContext(userId, input, store, brain),
    updateMemory: (userId: string, input: UpdateMemoryInput) =>
      updateMemory(userId, input, store, brain),
    deleteMemory: (userId: string, id: string) => deleteMemory(userId, id, store, brain.spaces),
    saveLesson: (
      userId: string,
      input: { project: string; title: string; content: string },
    ) => saveMemory(userId, { ...input, category: "lesson" }, store),
    saveBrief: (userId: string, input: SaveBriefInput) => saveBrief(userId, input, store, brain),
    saveDashboardMemory: (userId: string, input: MemoryInput, spaceId: string) =>
      saveDashboardMemory(userId, input, spaceId, store, brain),
    listVersions: (userId: string, id: string) =>
      listMemoryVersions(userId, id, store, brain.spaces),
  };
}
