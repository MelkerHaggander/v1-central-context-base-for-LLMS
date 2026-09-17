import type { MemoryInput, MemoryRecord, Result, SearchInput } from "./types";
import { fail, validateMemoryId, validateMemoryInput, validateSearchInput } from "./validate";

export const PAGE_SIZE = 50;

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
    updateMemory: (userId: string, input: MemoryInput & { id: string }) =>
      updateMemory(userId, input, store),
    deleteMemory: (userId: string, id: string) => deleteMemory(userId, id, store),
    saveLesson: (
      userId: string,
      input: { project: string; title: string; content: string },
    ) => saveMemory(userId, { ...input, category: "lesson" }, store),
  };
}
