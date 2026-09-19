/**
 * Counting, done in the browser.
 *
 * Why here and not on the server: the V1 contract (docs/contracts.md) has no
 * count and no aggregate endpoint. `GET /api/memories` returns at most 50 rows
 * with an offset. So the only honest way to show a total is to walk the pages
 * and add them up, with a ceiling on how many pages we are willing to fetch.
 *
 * That ceiling is the point of `complete`. When it is false the numbers describe
 * the rows we loaded, not the account, and the view says so out loud instead of
 * printing a total it cannot stand behind. If this ever needs to be exact for
 * large accounts, the fix is a `count` on the API, which is Alfredo's call
 * because the contract is locked.
 *
 * Pure functions only. test/aggregate.test.ts covers them.
 */
import { DISPLAY_ORDER } from "./categories";
import type { Category, Memory } from "./types";

export type CategoryCount = { category: string; count: number };

export type ProjectSummary = {
  project: string;
  count: number;
  /** ISO string of the most recently updated memory in the project. */
  lastUpdated: string;
  byCategory: CategoryCount[];
};

export type Totals = {
  memories: number;
  projects: number;
  /** False when the page ceiling cut the walk short. */
  complete: boolean;
  byCategory: CategoryCount[];
  projects_: ProjectSummary[];
  newest: string | null;
};

function tally(memories: readonly Memory[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of memories) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  return counts;
}

/**
 * Category counts in the fixed display order, always all six rows, zeros
 * included. A legend that loses a colour when its count hits zero teaches the
 * wrong thing about which colours exist.
 */
export function countByCategory(memories: readonly Memory[]): CategoryCount[] {
  const counts = tally(memories);
  const known: CategoryCount[] = DISPLAY_ORDER.map((category: Category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
  const extra: CategoryCount[] = [...counts.keys()]
    .filter((c) => !(DISPLAY_ORDER as readonly string[]).includes(c))
    .sort()
    .map((category) => ({ category, count: counts.get(category) ?? 0 }));
  return [...known, ...extra];
}

export function summariseProjects(memories: readonly Memory[]): ProjectSummary[] {
  const grouped = new Map<string, Memory[]>();
  for (const m of memories) {
    const rows = grouped.get(m.project);
    if (rows) rows.push(m);
    else grouped.set(m.project, [m]);
  }

  const summaries: ProjectSummary[] = [];
  for (const [project, rows] of grouped) {
    let lastUpdated = rows[0].updated_at;
    for (const r of rows) if (r.updated_at > lastUpdated) lastUpdated = r.updated_at;
    summaries.push({
      project,
      count: rows.length,
      lastUpdated,
      byCategory: countByCategory(rows).filter((c) => c.count > 0),
    });
  }

  // Busiest first. This orders a list, never a colour.
  summaries.sort((a, b) => b.count - a.count || (a.project < b.project ? -1 : 1));
  return summaries;
}

export function summarise(memories: readonly Memory[], complete: boolean): Totals {
  const projects = summariseProjects(memories);
  let newest: string | null = null;
  for (const m of memories) if (newest === null || m.updated_at > newest) newest = m.updated_at;

  return {
    memories: memories.length,
    projects: projects.length,
    complete,
    byCategory: countByCategory(memories),
    projects_: projects,
    newest,
  };
}

/** Local filtering for the panel. The API already filtered; this is the in-view slice. */
export function filterMemories(
  memories: readonly Memory[],
  filter: { project?: string | null; category?: string | null; query?: string },
): Memory[] {
  const needle = filter.query?.trim().toLowerCase() ?? "";
  return memories.filter((m) => {
    if (filter.project && m.project !== filter.project) return false;
    if (filter.category && m.category !== filter.category) return false;
    if (!needle) return true;
    return (
      m.title.toLowerCase().includes(needle) || m.content.toLowerCase().includes(needle)
    );
  });
}
