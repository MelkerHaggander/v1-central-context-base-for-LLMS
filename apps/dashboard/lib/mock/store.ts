/**
 * Simulerad lagring för fristående läge. Speglar reglerna i Melkers @v1/memory
 * (validering, dubbletter, sökstädning, sidstorlek 50, felkoder) så att vyerna
 * inte behöver byggas om när mocken byts mot riktigt API.
 *
 * Lagringen är per serverprocess. Startar om vid omstart. Det räcker för mock.
 */
import { randomUUID } from "node:crypto";
import { CATEGORIES, PAGE_SIZE, type Memory, type MemoryInput, type SearchInput } from "../types";

type Row = Memory & { user_id: string };
type Fail = { error: { code: string; message: string } };
type Result<T> = { data: T } | Fail;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function fail(code: string, message: string): Fail {
  return { error: { code, message } };
}

/** UTC utan millisekunder: YYYY-MM-DDTHH:MM:SSZ */
export function toIso(value: string | Date): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function cleanSearchQuery(query: string): string {
  return query.replace(/[%_,()]/g, " ").trim();
}

export function validateMemoryInput(input: MemoryInput) {
  const project = input.project?.trim() ?? "";
  const title = input.title?.trim() ?? "";
  const content = input.content?.trim() ?? "";
  const category = input.category?.trim() ?? "";

  if (project.length < 1 || project.length > 100) {
    return fail("INVALID_PROJECT", "project måste vara 1–100 tecken.");
  }
  if (title.length < 1 || title.length > 150) {
    return fail("INVALID_TITLE", "title måste vara 1–150 tecken.");
  }
  if (content.length < 1 || content.length > 10_000) {
    return fail("INVALID_CONTENT", "content måste vara 1–10 000 tecken.");
  }
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    return fail(
      "INVALID_CATEGORY",
      "category måste vara fact, decision, goal, deadline, preference eller lesson.",
    );
  }
  return { data: { project, category: category as Memory["category"], title, content } };
}

export function validateSearchInput(input: SearchInput) {
  const project = input.project?.trim();
  const category = input.category?.trim();
  const query = input.query?.trim();
  const offset = input.offset ?? 0;

  if (project && project.length > 100) {
    return fail("INVALID_PROJECT", "project måste vara 1–100 tecken.");
  }
  if (category && !(CATEGORIES as readonly string[]).includes(category)) {
    return fail(
      "INVALID_CATEGORY",
      "category måste vara fact, decision, goal, deadline, preference eller lesson.",
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return fail("INVALID_OFFSET", "offset måste vara ett heltal 0 eller högre.");
  }
  return {
    data: {
      project: project || undefined,
      category: category || undefined,
      query: query || undefined,
      offset,
    },
  };
}

export function validateMemoryId(id: string) {
  if (!UUID_RE.test(id)) return fail("INVALID_ID", "id måste vara ett UUID.");
  return { data: id };
}

function strip(row: Row): Memory {
  // user_id lämnar aldrig servern.
  const { user_id: _omit, ...memory } = row;
  void _omit;
  return memory;
}

export class MockMemoryStore {
  private rows: Row[] = [];

  constructor(seed: Row[] = []) {
    this.rows = [...seed];
  }

  saveMemory(userId: string, input: MemoryInput): Result<Memory> {
    const parsed = validateMemoryInput(input);
    if ("error" in parsed) return parsed;
    const f = parsed.data;

    const identical = this.rows.find(
      (r) =>
        r.user_id === userId &&
        r.project === f.project &&
        r.category === f.category &&
        r.title === f.title &&
        r.content === f.content,
    );
    // Identisk omsparning är lycka: samma id, samma updated_at.
    if (identical) return { data: strip(identical) };

    const now = toIso(new Date());
    const row: Row = { id: randomUUID(), user_id: userId, ...f, created_at: now, updated_at: now };
    this.rows.push(row);
    return { data: strip(row) };
  }

  searchMemory(userId: string, input: SearchInput): Result<Memory[]> {
    const parsed = validateSearchInput(input);
    if ("error" in parsed) return parsed;
    const p = parsed.data;

    let rows = this.rows.filter((r) => r.user_id === userId);
    if (p.project) rows = rows.filter((r) => r.project === p.project);
    if (p.category) rows = rows.filter((r) => r.category === p.category);
    if (p.query) {
      const q = cleanSearchQuery(p.query);
      if (q) {
        const needle = q.toLowerCase();
        rows = rows.filter(
          (r) => r.title.toLowerCase().includes(needle) || r.content.toLowerCase().includes(needle),
        );
      }
    }
    rows = [...rows].sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
    );
    return { data: rows.slice(p.offset, p.offset + PAGE_SIZE).map(strip) };
  }

  updateMemory(userId: string, input: MemoryInput & { id: string }): Result<Memory> {
    const idCheck = validateMemoryId(input.id);
    if ("error" in idCheck) return idCheck;
    const parsed = validateMemoryInput(input);
    if ("error" in parsed) return parsed;

    // Saknad rad och annan ägare ger samma fel. Avslöjar inte om id finns.
    const row = this.rows.find((r) => r.id === idCheck.data && r.user_id === userId);
    if (!row) return fail("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto.");

    Object.assign(row, parsed.data, { updated_at: toIso(new Date()) });
    return { data: strip(row) };
  }
}
