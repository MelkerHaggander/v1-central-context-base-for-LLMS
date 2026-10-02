/**
 * v1.2 helpers that only read what the dashboard already loaded.
 *
 * None of this calls the brain or the API. The duplicate finder is a plain word
 * overlap, not embeddings: the dashboard is not allowed to call the brain
 * (Backend features, "Dashboarden anropar inte hjärnan"), and a cheap lexical
 * check catches the obvious rot, "Launch 15 Oct" saved twice with different
 * wording. It is a suggestion list, never an automatic delete.
 *
 * Pure functions. test/insights.test.ts covers them.
 */
import type { Category, Memory, MemoryVersion, Space, SpaceKind } from "./types";

/* ------------------------------ spaces ------------------------------ */

/** The spaces table has no name column, so the label comes from the kind. */
export const SPACE_LABEL: Record<SpaceKind, string> = { personal: "Personal", shared: "Team" };

export function spaceLabel(space: Pick<Space, "kind" | "name"> | null | undefined): string {
  if (!space) return "No space";
  if (space.kind === "shared" && space.name?.trim()) return space.name.trim();
  return SPACE_LABEL[space.kind];
}

/**
 * Move-menu label for a team destination: "Boringcontext (Teams)".
 * Only shared spaces belong here; Personal is never a Move target from a team.
 */
export function teamMoveLabel(space: Pick<Space, "kind" | "name">): string {
  const name =
    space.kind === "shared" && space.name?.trim() ? space.name.trim() : SPACE_LABEL.shared;
  return `${name} (Teams)`;
}

export const TEAM_NAME_MAX = 60;

/** Same rule the mock enforces and the proposal asks the server to enforce. */
export function teamNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the team a name.";
  if (trimmed.length > TEAM_NAME_MAX) return `At most ${TEAM_NAME_MAX} characters.`;
  return null;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Personal first, then teams by name. The server orders teams by id, which reads as random. */
export function orderSpaces(spaces: readonly Space[]): Space[] {
  return [...spaces].sort(
    (a, b) =>
      (a.kind === "personal" ? 0 : 1) - (b.kind === "personal" ? 0 : 1) ||
      spaceLabel(a).localeCompare(spaceLabel(b), "sv") ||
      a.id.localeCompare(b.id),
  );
}

/** Personal is the default (Backend features, Dashboard step 1). */
export function defaultSpace(spaces: readonly Space[]): Space | null {
  return spaces.find((s) => s.kind === "personal") ?? spaces[0] ?? null;
}

/** Keep a remembered choice only while it is still one of the user's spaces. */
export function pickSpace(spaces: readonly Space[], rememberedId: string | null): Space | null {
  return spaces.find((s) => s.id === rememberedId) ?? defaultSpace(spaces);
}

/* ------------------------------ who ------------------------------ */

/**
 * "Who changed this" in the history. The reader is "You". A teammate is their
 * email when the members endpoint answers, otherwise a short id. Someone who
 * has left the team is no longer listed, so they keep the id form.
 */
export function whoChanged(
  version: Pick<MemoryVersion, "changed_by">,
  userId: string,
  kind: SpaceKind,
  people?: ReadonlyMap<string, string>,
): string {
  if (version.changed_by === userId) return "You";
  // Personal has one member, so every change there is the reader's own, even
  // when the id differs (another session, a migrated account).
  if (kind === "personal") return "You";
  // With the proposed members endpoint the id becomes an email. Someone who
  // has left the team is no longer listed, so they keep the id form.
  const email = people?.get(version.changed_by);
  if (email) return email;
  return `A teammate (${version.changed_by.slice(0, 8)})`;
}

/* ------------------------------ versions ------------------------------ */

/**
 * A version row stores project and category as they were *before* the
 * change (memory_versions has no *_after columns). The value after is the
 * next version's "before", or the live row for the newest one. Version
 * numbers are consecutive per memory, so the derivation is unambiguous.
 * A delete has no "after": those stay null.
 */
export type VersionWithAfter = MemoryVersion & {
  project_after: string | null;
  category_after: Category | null;
};

export function withAfterValues(
  versions: readonly MemoryVersion[],
  live: Pick<Memory, "project" | "category"> | null,
): VersionWithAfter[] {
  const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);
  return sorted.map((version, index) => {
    if (version.event === "delete") return { ...version, project_after: null, category_after: null };
    // Newest first, so the one that came after this version sits at index - 1.
    const next = index > 0 ? sorted[index - 1] : null;
    const after = next ?? live;
    return {
      ...version,
      project_after: after ? after.project : null,
      category_after: after ? after.category : null,
    };
  });
}

/**
 * The newest entry in a memory's history, or null when it has not been changed
 * since it was saved. By version number, then time, whatever order the server
 * sends.
 */
export function latestChange<T extends Pick<MemoryVersion, "version_number" | "created_at">>(
  versions: readonly T[],
): T | null {
  let latest: T | null = null;
  for (const v of versions) {
    if (
      !latest ||
      v.version_number > latest.version_number ||
      (v.version_number === latest.version_number && v.created_at > latest.created_at)
    ) {
      latest = v;
    }
  }
  return latest;
}

/**
 * Whether a deleted memory can be put back.
 *
 * Restoring saves it again with the same space, project, category, title and
 * text. The API saves on (space, project, category, title), so if a memory
 * with that title is back in the space a restore would overwrite it:
 * - "restored": one with the same title and text is there, so it is back;
 * - "taken": one with the same title but other text is there, and restoring
 *   would replace that newer text, so it is not offered;
 * - "restorable": nothing is in the way.
 * Project names compare the way the server matches them (projectKey).
 */
export type RestoreState = "restorable" | "restored" | "taken";

export function restoreState(
  deleted: Pick<MemoryVersion, "project" | "category" | "title_before" | "content_before">,
  memories: readonly Pick<Memory, "project" | "category" | "title" | "content">[],
): RestoreState {
  const key = projectKey(deleted.project);
  const same = memories.find(
    (m) => projectKey(m.project) === key && m.category === deleted.category && m.title === deleted.title_before,
  );
  if (!same) return "restorable";
  return same.content === deleted.content_before ? "restored" : "taken";
}

/**
 * Deleted rows grouped by project so the panel can restore a whole project.
 * Empty project → one free-standing group (isProject false, no Restore project).
 * Named projects keep first-seen order from the deleted list (usually newest first).
 */
export type DeletedProjectGroup = {
  key: string;
  label: string;
  isProject: boolean;
  items: MemoryVersion[];
};

export function groupDeletedByProject(versions: readonly MemoryVersion[]): DeletedProjectGroup[] {
  const order: string[] = [];
  const map = new Map<string, DeletedProjectGroup>();
  for (const version of versions) {
    const trimmed = version.project.trim();
    const key = trimmed ? projectKey(trimmed) : "";
    let group = map.get(key);
    if (!group) {
      group = { key, label: trimmed, isProject: trimmed.length > 0, items: [] };
      map.set(key, group);
      order.push(key);
    }
    group.items.push(version);
  }
  return order.map((key) => map.get(key)!);
}

/* ------------------------------ new ------------------------------ */

export const NEW_WINDOW_HOURS = 24;

/** Created within the last 24 hours, by created_at. Filip's answer 17 to Melker. */
export function isNew(memory: Pick<Memory, "created_at">, now: Date = new Date(), hours = NEW_WINDOW_HOURS): boolean {
  const created = Date.parse(memory.created_at);
  if (Number.isNaN(created)) return false;
  const age = now.getTime() - created;
  return age >= -60_000 && age <= hours * 3_600_000;
}

/** Created or changed after the reader's previous visit to this space. */
export function changedSince(memory: Pick<Memory, "updated_at">, since: string | null): boolean {
  if (!since) return false;
  const changed = Date.parse(memory.updated_at);
  const mark = Date.parse(since);
  if (Number.isNaN(changed) || Number.isNaN(mark)) return false;
  return changed > mark;
}

/* ------------------------------ projects ------------------------------ */

/**
 * The server's rule (projectKey in packages/memory/src/brain.ts): lower case,
 * whitespace and hyphens removed. Mirrored here only to warn before saving.
 */
export function projectKey(project: string): string {
  return project.normalize("NFKC").toLocaleLowerCase("sv-SE").replace(/[\s-]+/gu, "");
}

/**
 * The existing project a typed name will land in, when the spelling differs.
 * null when it is a new project or already spelled exactly like the saved one.
 */
export function projectMatch(typed: string, existing: readonly string[]): string | null {
  const trimmed = typed.trim();
  if (!trimmed) return null;
  const key = projectKey(trimmed);
  const hit = existing.find((name) => projectKey(name) === key);
  return hit && hit !== trimmed ? hit : null;
}

/* ------------------------------ duplicates ------------------------------ */

const STOP = new Set(
  (
    "the a an and or of to in on for is are was be it this that with as at by from we our you your " +
    "plus not no och att det som en ett är på för med av till vi har inte de den"
  ).split(" "),
);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLocaleLowerCase("sv-SE").split(/[^\p{L}\p{N}.]+/u)) {
    const word = raw.replace(/^\.+|\.+$/g, "");
    if (word.length < 2 || STOP.has(word)) continue;
    out.add(word);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

export type DuplicatePair = { a: Memory; b: Memory; score: number; reason: "same title" | "similar text" };

export const DUPLICATE_THRESHOLD = 0.5;

/**
 * Pairs inside one project that look like the same thing saved twice.
 * Same title (case and spacing ignored) always counts. Otherwise the word
 * overlap of title plus content must reach the threshold. Newest pair first
 * within equal scores, so fresh rot is on top.
 */
export function findDuplicates(memories: readonly Memory[], threshold = DUPLICATE_THRESHOLD): DuplicatePair[] {
  const byProject = new Map<string, Memory[]>();
  for (const m of memories) {
    const key = projectKey(m.project);
    const list = byProject.get(key);
    if (list) list.push(m);
    else byProject.set(key, [m]);
  }

  const pairs: DuplicatePair[] = [];
  for (const group of byProject.values()) {
    const words = group.map((m) => tokens(`${m.title} ${m.content}`));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (projectKey(a.title) === projectKey(b.title)) {
          pairs.push(order(a, b, 1, "same title"));
          continue;
        }
        const score = jaccard(words[i], words[j]);
        if (score >= threshold) pairs.push(order(a, b, score, "similar text"));
      }
    }
  }
  return pairs.sort(
    (x, y) => y.score - x.score || (newest(y) < newest(x) ? -1 : newest(y) > newest(x) ? 1 : 0),
  );
}

function order(a: Memory, b: Memory, score: number, reason: DuplicatePair["reason"]): DuplicatePair {
  // Older first: the newer row is usually the one to question.
  return a.created_at <= b.created_at ? { a, b, score, reason } : { a: b, b: a, score, reason };
}

function newest(pair: DuplicatePair): string {
  return pair.a.updated_at > pair.b.updated_at ? pair.a.updated_at : pair.b.updated_at;
}

/* ------------------------------ export ------------------------------ */

export function exportJson(memories: readonly Memory[], meta: { space: string; exportedAt: string }): string {
  return `${JSON.stringify(
    {
      format: "boringcontext-export",
      version: 1,
      space: meta.space,
      exported_at: meta.exportedAt,
      count: memories.length,
      memories: memories.map((m) => ({
        id: m.id,
        project: m.project,
        category: m.category,
        title: m.title,
        content: m.content,
        created_at: m.created_at,
        updated_at: m.updated_at,
        ...(m.source ? { source: m.source } : {}),
      })),
    },
    null,
    2,
  )}\n`;
}

/** One heading per project, one section per memory. Readable without the dashboard. */
export function exportMarkdown(memories: readonly Memory[], meta: { space: string; exportedAt: string }): string {
  const byProject = new Map<string, Memory[]>();
  for (const m of memories) {
    const list = byProject.get(m.project);
    if (list) list.push(m);
    else byProject.set(m.project, [m]);
  }
  const lines = [
    `# Boringcontext export: ${meta.space}`,
    "",
    `${memories.length} memories, exported ${meta.exportedAt}.`,
    "",
  ];
  for (const project of [...byProject.keys()].sort((a, b) => a.localeCompare(b))) {
    lines.push(`## ${project}`, "");
    const rows = byProject.get(project)!.slice().sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    for (const m of rows) {
      lines.push(`### ${m.title}`, "", `*${m.category}* · created ${m.created_at} · updated ${m.updated_at}`, "", m.content, "");
    }
  }
  return lines.join("\n");
}

/** File name that sorts by date and says which space it came from. */
export function exportFileName(space: string, date: Date, extension: "json" | "md"): string {
  const day = date.toISOString().slice(0, 10);
  return `boringcontext-${space.toLowerCase()}-${day}.${extension}`;
}
