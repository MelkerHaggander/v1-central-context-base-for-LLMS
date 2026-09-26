import type { Category, MemoryDraft, MemoryIdentity, MemoryRecord, SpaceKind, WrittenMemory } from "./types";
import type { BrainDeps, SubjectWrite } from "./types";
import { CATEGORIES } from "./types";
import { validateMemoryInput } from "./validate";
import type { MemoryStore, NearestHit } from "./store";

export const DIRECT_SIMILARITY = 0.35;
export const NEIGHBOR_SIMILARITY = 0.55;
export const IDENTITY_LIMIT = 50;
export const NEAREST_LIMIT = 32;

const SHARED_REQUEST =
  /\bshared\b|\bgemensamt\b|\bgemensamma\b|\bshare (?:this|it|that|these) with\b/iu;

export function projectKey(project: string): string {
  return project.normalize("NFKC").toLocaleLowerCase("sv-SE").replace(/[\s-]+/gu, "");
}

export function embeddingText(title: string, content: string): string {
  return `${title}\n${content}`;
}

export function textRequestsShared(text: string): boolean {
  return SHARED_REQUEST.test(text);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function canonicalProject(requested: string, existing: string[]): string {
  const trimmed = requested.trim();
  const key = projectKey(trimmed);
  return existing.find((name) => projectKey(name) === key) ?? trimmed;
}

type RankedRow = {
  row: MemoryRecord;
  key: string;
  lexicalScore: number;
  score: number;
};

export async function applyVectorRanking(input: {
  userId: string;
  prompt: string;
  spaceIds: string[];
  store: MemoryStore;
  embedding: NonNullable<BrainDeps["embedding"]>;
  ranked: RankedRow[];
  keyFor: (row: MemoryRecord) => string;
}): Promise<RankedRow[]> {
  const query = await input.embedding.embed(input.prompt);
  if (!input.store.listNearest) {
    throw new Error("nearest neighbor query is unavailable");
  }
  const nearest = await input.store.listNearest(
    input.userId,
    query,
    input.spaceIds,
    NEAREST_LIMIT,
  );
  const direct = nearest.filter((hit) => hit.similarity >= DIRECT_SIMILARITY);
  const included = new Map<string, RankedRow>(
    input.ranked.map((candidate) => [candidate.row.id, candidate]),
  );

  const consider = (hit: NearestHit, score: number) => {
    if (included.has(hit.row.id)) return;
    included.set(hit.row.id, {
      row: hit.row,
      key: input.keyFor(hit.row),
      lexicalScore: 0,
      score,
    });
  };

  for (const hit of direct) {
    consider(hit, hit.similarity * 100);
  }

  if (direct.length > 0 && input.store.listNeighbors) {
    const neighbors = await input.store.listNeighbors(
      input.userId,
      direct.map((hit) => hit.row.id),
      input.spaceIds,
      NEIGHBOR_SIMILARITY,
      NEAREST_LIMIT,
    );
    for (const hit of neighbors) {
      if (hit.similarity < NEIGHBOR_SIMILARITY) continue;
      consider(hit, hit.similarity * 40);
    }
  }

  return [...included.values()].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.row.updated_at !== b.row.updated_at) {
      return a.row.updated_at < b.row.updated_at ? 1 : -1;
    }
    return a.row.id.localeCompare(b.row.id);
  });
}

export async function recentIdentities(
  userId: string,
  spaceIds: string[],
  store: MemoryStore,
): Promise<MemoryIdentity[]> {
  if (store.listIdentities) {
    return store.listIdentities(userId, spaceIds, IDENTITY_LIMIT);
  }
  const rows = store.listBySpaces
    ? await store.listBySpaces(userId, spaceIds)
    : await store.listByUser(userId);
  return rows
    .slice()
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
    .slice(0, IDENTITY_LIMIT)
    .map((row) => ({
      project: row.project,
      category: row.category,
      title: row.title,
      updated_at: row.updated_at,
    }));
}

function draftSpace(draft: MemoryDraft, allowShared: boolean): SpaceKind | null {
  if (draft.space === undefined || draft.space === "personal") return "personal";
  if (draft.space === "shared") return allowShared ? "shared" : "personal";
  return null;
}

async function knownProjects(
  userId: string,
  spaceIds: string[],
  store: MemoryStore,
): Promise<string[]> {
  const rows = store.listBySpaces
    ? await store.listBySpaces(userId, spaceIds)
    : await store.listByUser(userId);
  return [...new Set(rows.map((row) => row.project))];
}

async function rememberEmbedding(
  store: MemoryStore,
  embedding: BrainDeps["embedding"],
  row: MemoryRecord,
  changed: boolean,
): Promise<void> {
  if (!embedding || !store.setEmbedding) return;
  if (!changed && store.hasEmbedding && (await store.hasEmbedding(row.id))) return;
  try {
    const vector = await embedding.embed(embeddingText(row.title, row.content));
    await store.setEmbedding(row.id, vector);
  } catch {
    // The row is already saved. The next write may fill the vector.
  }
}

export async function persistDrafts(input: {
  userId: string;
  drafts: MemoryDraft[];
  text: string;
  project?: string;
  store: MemoryStore;
  brain: BrainDeps;
  limit: number;
}): Promise<WrittenMemory[]> {
  if (!input.brain.spaces || !input.store.upsertSubject) return [];
  const allowShared = textRequestsShared(input.text);
  let spaceIds: string[] = [];
  try {
    spaceIds = await input.brain.spaces.readableSpaceIds(input.userId);
  } catch {
    spaceIds = [];
  }
  const projects = await knownProjects(input.userId, spaceIds, input.store);
  const written: WrittenMemory[] = [];

  for (const draft of input.drafts) {
    if (written.length >= input.limit) break;
    const space = draftSpace(draft, allowShared);
    if (!space) continue;
    const requestedProject = input.project?.trim() || draft.project || "";
    const project = canonicalProject(requestedProject, projects);
    const parsed = validateMemoryInput({
      project,
      category: draft.category ?? "",
      title: draft.title ?? "",
      content: draft.content ?? "",
    });
    if ("error" in parsed) continue;
    if (!CATEGORIES.includes(parsed.data.category as Category)) continue;

    let spaceId: string | null = null;
    try {
      spaceId = await input.brain.spaces.spaceFor(input.userId, space);
    } catch {
      spaceId = null;
    }
    if (!spaceId) continue;

    const fields: SubjectWrite = {
      spaceId,
      project: parsed.data.project,
      category: parsed.data.category,
      title: parsed.data.title,
      content: parsed.data.content,
      source: "brain",
    };
    const saved = await input.store.upsertSubject(input.userId, fields);
    if (saved.kind === "failed") continue;
    if (!projects.includes(saved.row.project)) projects.push(saved.row.project);
    await rememberEmbedding(
      input.store,
      input.brain.embedding,
      saved.row,
      saved.kind !== "unchanged",
    );
    written.push({
      id: saved.row.id,
      project: saved.row.project,
      category: saved.row.category,
      title: saved.row.title,
      space,
      space_id: spaceId,
    });
  }

  return written;
}

export async function attachEmbedding(
  store: MemoryStore,
  embedding: BrainDeps["embedding"],
  row: MemoryRecord,
): Promise<void> {
  await rememberEmbedding(store, embedding, row, true);
}
