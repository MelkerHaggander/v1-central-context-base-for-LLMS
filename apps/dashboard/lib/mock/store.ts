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
  type MemorySource,
  type Member,
  type MemoryVersion,
  type SearchInput,
  type Space,
  type UpdateMemoryInput,
} from "../types";

/**
 * user_id is who wrote the row. space_id is where it lives. Rows without a
 * space_id are the pre-v1.2 shape and are owned by user_id alone, which keeps
 * the older tests and the legacy methods below meaningful.
 */
export type Row = Memory & { user_id: string; space_id?: string | null };
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

  if (project.length > 100) {
    return fail("INVALID_PROJECT", "Project must be 100 characters or fewer.");
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

/**
 * Same rule as projectKey() in packages/memory/src/brain.ts: lower case, no
 * whitespace, no hyphens. "Boring Context" and "boringcontext" are one project.
 */
export function projectKey(project: string): string {
  return project.normalize("NFKC").toLocaleLowerCase("sv-SE").replace(/[\s-]+/gu, "");
}

/** canonicalProject() in brain.ts: reuse the saved spelling when the key matches. */
export function canonicalProject(requested: string, existing: readonly string[]): string {
  const trimmed = requested.trim();
  const key = projectKey(trimmed);
  return existing.find((name) => projectKey(name) === key) ?? trimmed;
}

function strip(row: Row): Memory {
  // user_id lämnar aldrig servern. space_id and source do, as in v1.2.
  const { user_id: _omit, ...memory } = row;
  void _omit;
  return memory;
}

const NOT_FOUND = "The memory does not exist or belongs to another account.";
const NOT_MEMBER = "You are not a member of that space.";

export type MockAccounts = {
  emailOf: (userId: string) => string | null;
  idOfEmail: (email: string) => string | null;
};

export class MockMemoryStore {
  private rows: Row[] = [];
  private spaces: Space[] = [];
  private members = new Map<string, Set<string>>();
  private versions: MemoryVersion[] = [];

  private accounts: MockAccounts;

  constructor(
    seed: Row[] = [],
    spaces: Array<Space & { members: string[] }> = [],
    accounts: MockAccounts = { emailOf: () => null, idOfEmail: () => null },
  ) {
    this.rows = [...seed];
    this.accounts = accounts;
    for (const space of spaces) {
      // No name key when there is none: the same shape PR #40 sends today.
      this.spaces.push({ id: space.id, kind: space.kind, ...(space.name ? { name: space.name } : {}) });
      this.members.set(space.id, new Set(space.members));
    }
  }

  /* ---------------- proposed: teams and members ----------------
   * Not in the v1.2 contract yet. This is the shape proposed to Alfredo in
   * "Förslag: team och medlemmar". All members have the same rights
   * (Backend features, Utrymmen). A personal space cannot be renamed, shared
   * or left. A team cannot be left empty. Memories stay in the team when
   * someone leaves; their history keeps changed_by.
   */

  createSpace(userId: string, name: string): Result<Space> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 60) return fail("INVALID_NAME", "Team name must be 1–60 characters.");
    const space: Space = { id: randomUUID(), kind: "shared", name: trimmed };
    this.spaces.push(space);
    this.members.set(space.id, new Set([userId]));
    return { data: { ...space } };
  }

  private teamFor(userId: string, spaceId: string): Result<Space> {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space || !this.isMember(userId, spaceId)) return fail("FORBIDDEN", NOT_MEMBER);
    if (space.kind !== "shared") return fail("PERSONAL_SPACE", "A personal space has no members to manage.");
    return { data: space };
  }

  renameSpace(userId: string, spaceId: string, name: string): Result<Space> {
    const team = this.teamFor(userId, spaceId);
    if ("error" in team) return team;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 60) return fail("INVALID_NAME", "Team name must be 1–60 characters.");
    team.data.name = trimmed;
    return { data: { ...team.data } };
  }

  listMembers(userId: string, spaceId: string): Result<Member[]> {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space || !this.isMember(userId, spaceId)) return fail("FORBIDDEN", NOT_MEMBER);
    const members = [...(this.members.get(spaceId) ?? [])].map((id) => ({
      user_id: id,
      email: this.accounts.emailOf(id) ?? id,
    }));
    return { data: members.sort((a, b) => a.email.localeCompare(b.email)) };
  }

  addMember(userId: string, spaceId: string, email: string): Result<Member> {
    const team = this.teamFor(userId, spaceId);
    if ("error" in team) return team;
    const wanted = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wanted)) return fail("INVALID_EMAIL", "That is not an email address.");
    const id = this.accounts.idOfEmail(wanted);
    if (!id) return fail("NO_ACCOUNT", "No account has that email. Accounts are created by hand.");
    const set = this.members.get(spaceId)!;
    if (set.has(id)) return fail("ALREADY_MEMBER", "That account is already in the team.");
    set.add(id);
    return { data: { user_id: id, email: this.accounts.emailOf(id) ?? wanted } };
  }

  removeMember(userId: string, spaceId: string, memberId: string): Result<{ success: true }> {
    const team = this.teamFor(userId, spaceId);
    if ("error" in team) return team;
    const set = this.members.get(spaceId)!;
    if (!set.has(memberId)) return fail("NOT_A_MEMBER", "That account is not in the team.");
    if (set.size === 1) return fail("LAST_MEMBER", "The last member cannot leave. A team is never left empty.");
    set.delete(memberId);
    return { data: { success: true } };
  }

  /* ---------------- v1.2: spaces ---------------- */

  /** GET /api/spaces. Personal first, then shared, then by id (Alfredo PR #40). */
  listSpaces(userId: string): Space[] {
    const order: Record<string, number> = { personal: 0, shared: 1 };
    return this.spaces
      .filter((space) => this.members.get(space.id)?.has(userId))
      .map((space) => ({ ...space }))
      .sort((a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
  }

  isMember(userId: string, spaceId: string): boolean {
    return this.members.get(spaceId)?.has(userId) ?? false;
  }

  private canTouch(userId: string, row: Row): boolean {
    return row.space_id ? this.isMember(userId, row.space_id) : row.user_id === userId;
  }

  /** GET /api/memories?space_id=. searchInSpace() in packages/memory/src/store.ts. */
  searchInSpace(userId: string, spaceId: string, input: SearchInput): Result<Memory[]> {
    if (!spaceId.trim()) return fail("INVALID_SPACE", "space_id is required.");
    if (!this.isMember(userId, spaceId)) return fail("FORBIDDEN", NOT_MEMBER);
    return this.search(this.rows.filter((r) => r.space_id === spaceId), input);
  }

  /**
   * POST /api/memories with space_id. saveDashboardMemory(): membership, then
   * validation, then project matching, then upsert on (space, project,
   * category, title). Same subject means the content is overwritten and the
   * old text becomes a version. source is "dashboard".
   */
  saveInSpace(userId: string, spaceId: string, input: MemoryInput, source: MemorySource = "dashboard"): Result<Memory> {
    if (!spaceId.trim()) return fail("INVALID_SPACE", "space_id is required.");
    if (!this.isMember(userId, spaceId)) return fail("FORBIDDEN", NOT_MEMBER);
    const parsed = validateMemoryInput(input);
    if ("error" in parsed) return parsed;

    const inSpace = this.rows.filter((r) => r.space_id === spaceId);
    const project = canonicalProject(parsed.data.project, [...new Set(inSpace.map((r) => r.project))]);
    const f = { ...parsed.data, project };

    const existing = inSpace.find(
      (r) => r.project === f.project && r.category === f.category && r.title === f.title,
    );
    if (existing?.content === f.content) return { data: strip(existing) };
    if (existing) {
      this.recordVersion(existing, userId, "update", existing.title, f.content);
      existing.content = f.content;
      existing.updated_at = toIso(new Date());
      return { data: strip(existing) };
    }

    // Same title in the same project is not allowed (any category).
    if (inSpace.some((r) => r.project === f.project && r.title === f.title)) {
      return fail("DUPLICATE_TITLE", "A memory with that title already exists in this project.");
    }

    const now = toIso(new Date());
    const row: Row = {
      id: randomUUID(),
      user_id: userId,
      space_id: spaceId,
      source,
      ...f,
      created_at: now,
      updated_at: now,
    };
    this.rows.push(row);
    return { data: strip(row) };
  }

  /** GET /api/memories/:id/versions. Newest first. Needs the memory to still exist, like the API. */
  listVersions(userId: string, id: string): Result<MemoryVersion[]> {
    const idCheck = validateMemoryId(id);
    if ("error" in idCheck) return idCheck;
    const row = this.rows.find((r) => r.id === idCheck.data);
    if (!row) return fail("NOT_FOUND", NOT_FOUND);
    if (!this.canTouch(userId, row)) {
      return row.space_id ? fail("FORBIDDEN", NOT_MEMBER) : fail("NOT_FOUND", NOT_FOUND);
    }
    return {
      data: this.versions
        .filter((v) => v.memory_id === row.id)
        .sort((a, b) => b.version_number - a.version_number)
        .map((v) => ({ ...v })),
    };
  }

  /**
   * GET /api/memories/deleted?space_id=. listDeletions() in
   * packages/memory/src/store.ts: the delete events of one space, newest
   * first, for members only. Only the last 30 days are kept.
   */
  listDeletions(userId: string, spaceId: string): Result<MemoryVersion[]> {
    if (!spaceId.trim()) return fail("INVALID_SPACE", "space_id is required.");
    if (!this.isMember(userId, spaceId)) return fail("FORBIDDEN", NOT_MEMBER);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return {
      data: this.versions
        .filter((v) => v.event === "delete" && v.space_id === spaceId)
        .filter((v) => Date.parse(v.created_at) >= cutoff)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
        .map((v) => ({ ...v })),
    };
  }

  /** Test and seed hook: a version row as the database would hold it. */
  seedVersion(version: MemoryVersion) {
    this.versions.push({ ...version });
  }

  private recordVersion(
    row: Row,
    changedBy: string,
    event: "update" | "delete",
    titleAfter: string,
    contentAfter: string,
  ) {
    const next =
      this.versions
        .filter((v) => v.memory_id === row.id)
        .reduce((max, v) => Math.max(max, v.version_number), 0) + 1;
    this.versions.push({
      version_number: next,
      memory_id: row.id,
      space_id: row.space_id ?? null,
      changed_by: changedBy,
      event,
      project: row.project,
      category: row.category,
      title_before: row.title,
      title_after: titleAfter,
      content_before: row.content,
      content_after: contentAfter,
      source: row.source ?? null,
      created_at: toIso(new Date()),
    });
  }

  /* ---------------- shared by both shapes ---------------- */

  private search(pool: Row[], input: SearchInput): Result<Memory[]> {
    const parsed = validateSearchInput(input);
    if ("error" in parsed) return parsed;
    const p = parsed.data;

    let rows = pool;
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

  /* ---------------- pre-v1.2 shape, owner only ---------------- */

  saveMemory(userId: string, input: MemoryInput): Result<Memory> {
    const parsed = validateMemoryInput(input);
    if ("error" in parsed) return parsed;
    const f = parsed.data;

    const existing = this.rows.find(
      (r) =>
        !r.space_id &&
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
    return this.search(
      this.rows.filter((r) => !r.space_id && r.user_id === userId),
      input,
    );
  }

  /* ---------------- both: edit and delete by id ---------------- */

  /**
   * DELETE /api/memories/:id. In a space any member may delete (Backend
   * features, Dashboard step 6). The row goes, its history stays and gains a
   * delete event, like c31e656. A missing row and a foreign personal row give
   * the same error, so the answer never reveals whether an id exists.
   */
  deleteMemory(userId: string, id: string): Result<{ success: true }> {
    const idCheck = validateMemoryId(id);
    if ("error" in idCheck) return idCheck;

    const index = this.rows.findIndex((r) => r.id === idCheck.data);
    const row = index === -1 ? null : this.rows[index];
    if (!row || !this.canTouch(userId, row)) {
      if (row?.space_id && this.spaces.some((s) => s.id === row.space_id && s.kind === "shared")) {
        return fail("FORBIDDEN", NOT_MEMBER);
      }
      return fail("NOT_FOUND", NOT_FOUND);
    }

    if (row.space_id) this.recordVersion(row, userId, "delete", "", "");
    this.rows.splice(index, 1);
    return { data: { success: true } };
  }

  updateMemory(userId: string, input: UpdateMemoryInput): Result<Memory> {
    const idCheck = validateMemoryId(input.id);
    if ("error" in idCheck) return idCheck;
    const parsed = validateMemoryInput(input);
    if ("error" in parsed) return parsed;

    // Saknad rad och annan ägare ger samma fel. Avslöjar inte om id finns.
    const row = this.rows.find((r) => r.id === idCheck.data);
    if (!row || !this.canTouch(userId, row)) {
      return fail("NOT_FOUND", NOT_FOUND);
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

    // Title must stay unique inside the project (or among free-standing memories).
    if (
      row.space_id &&
      this.rows.some(
        (r) =>
          r.id !== row.id &&
          r.space_id === row.space_id &&
          r.project === parsed.data.project &&
          r.title === parsed.data.title,
      )
    ) {
      return fail("DUPLICATE_TITLE", "A memory with that title already exists in this project.");
    }

    // An identical rewrite writes no version and leaves updated_at alone
    // (contracts.md: "Identisk text ändrar inte updated_at").
    const unchanged =
      row.project === parsed.data.project &&
      row.category === parsed.data.category &&
      row.title === parsed.data.title &&
      row.content === parsed.data.content;
    if (unchanged) return { data: strip(row) };

    // Every field change is a version: title, content, project or category.
    // The version row holds the values before the change; the dashboard
    // derives project/category "after" from the next version or the live row.
    if (row.space_id) {
      this.recordVersion(row, userId, "update", parsed.data.title, parsed.data.content);
    }
    Object.assign(row, parsed.data, { updated_at: toIso(new Date()) });
    return { data: strip(row) };
  }
}
