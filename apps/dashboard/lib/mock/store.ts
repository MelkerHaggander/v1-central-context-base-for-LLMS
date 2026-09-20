/**
 * Simulerad lagring för fristående läge. Speglar reglerna i Melkers @v1/memory
 * (validering, dubbletter, sökstädning, sidstorlek 50, felkoder) så att vyerna
 * inte behöver byggas om när mocken byts mot riktigt API.
 *
 * Lagringen är per serverprocess. Startar om vid omstart. Det räcker för mock.
 */
import { randomUUID } from "node:crypto";
import {
  CATEGORIES,
  PAGE_SIZE,
  type Memory,
  type MemoryInput,
  type SearchInput,
  type UpdateMemoryInput,
} from "../types";

type Row = Memory & { user_id: string };
type Fail = { error: { code: string; message: string } };
type Result<T> = { data: T } | Fail;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

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
    return fail("INVALID_PROJECT", "Project must be 1–100 characters.");
  }
  if (title.length < 1 || title.length > 150) {
    return fail("INVALID_TITLE", "Title must be 1–150 characters.");
  }
  if (content.length < 1 || content.length > 10_000) {
    return fail("INVALID_CONTENT", "Content must be 1–10,000 characters.");
  }
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    return fail(
      "INVALID_CATEGORY",
      "Category must be fact, decision, goal, deadline, preference or lesson.",
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
    return fail("INVALID_PROJECT", "Project must be 1–100 characters.");
  }
  if (category && !(CATEGORIES as readonly string[]).includes(category)) {
    return fail(
      "INVALID_CATEGORY",
      "Category must be fact, decision, goal, deadline, preference or lesson.",
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return fail("INVALID_OFFSET", "offset must be an integer 0 or higher.");
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
  if (id === NIL_UUID || !UUID_RE.test(id)) {
    return fail("INVALID_ID", "id must be a UUID.");
  }
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

    const existing = this.rows.find(
      (r) =>
        r.user_id === userId &&
        r.project === f.project &&
        r.category === f.category &&
        r.title === f.title,
    );
    // Identisk omsparning är lycka: samma id, samma updated_at.
    if (existing?.content === f.content) return { data: strip(existing) };
    if (existing) {
      existing.content = f.content;
      existing.updated_at = toIso(new Date());
      return { data: strip(existing) };
    }

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

  /**
   * Mirrors DELETE /api/memories/:id in Alfredos API (policy memories_delete_own).
   * A missing row and another account's row give the same error, so the answer
   * never reveals whether an id exists. Not reachable over MCP.
   */
  deleteMemory(userId: string, id: string): Result<{ success: true }> {
    const idCheck = validateMemoryId(id);
    if ("error" in idCheck) return idCheck;

    const index = this.rows.findIndex((r) => r.id === idCheck.data && r.user_id === userId);
    if (index === -1) return fail("NOT_FOUND", "The memory does not exist or belongs to another account.");

    this.rows.splice(index, 1);
    return { data: { success: true } };
  }

  updateMemory(userId: string, input: UpdateMemoryInput): Result<Memory> {
    const idCheck = validateMemoryId(input.id);
    if ("error" in idCheck) return idCheck;
    const parsed = validateMemoryInput(input);
    if ("error" in parsed) return parsed;

    // Saknad rad och annan ägare ger samma fel. Avslöjar inte om id finns.
    const row = this.rows.find((r) => r.id === idCheck.data && r.user_id === userId);
    if (!row) {
      return fail("NOT_FOUND", "The memory does not exist or belongs to another account.");
    }
    if (row.project !== parsed.data.project && input.allow_project_change !== true) {
      return fail(
        "PROJECT_CHANGE_REQUIRES_FLAG",
        "Project changes require allow_project_change: true.",
      );
    }
    if (parsed.data.category === "lesson" && row.category !== "lesson") {
      return fail(
        "LESSON_CATEGORY_REQUIRES_TOOL",
        "A regular memory cannot become a lesson; use lesson_memory.",
      );
    }

    Object.assign(row, parsed.data, { updated_at: toIso(new Date()) });
    return { data: strip(row) };
  }
}
