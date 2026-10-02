/**
 * Goals and deadlines as a checklist.
 *
 * There is no status column, and there does not need to be one: checking an
 * item off writes a last line "Done: 2026-09-28" into the memory's content.
 * That line is the whole point. The AI reads content, so a finished deadline
 * stops being served as if it were still ahead. In a team everyone sees it,
 * and the history records who checked it off and when. Unchecking removes the
 * line again.
 *
 * Dates are found in the text with plain patterns (ISO, "5 October",
 * "October 5", Swedish month names). No brain call: the dashboard is not
 * allowed to use it. A date without a year gets the year that puts it closest
 * after the memory was written.
 *
 * Pure functions. test/checklist.test.ts covers them.
 */
import { readDue, realDay } from "./due";
import type { Memory } from "./types";

export const CHECKLIST_CATEGORIES = new Set(["goal", "deadline"]);

const DONE_LINE = /(?:^|\n)[ \t]*(?:status:\s*)?done:?\s+(\d{4}-\d{2}-\d{2})\.?[ \t]*$/i;
const CONTENT_MAX = 10_000;

export function doneDate(content: string): string | null {
  return content.trimEnd().match(DONE_LINE)?.[1] ?? null;
}

export function isDone(memory: Pick<Memory, "content">): boolean {
  return doneDate(memory.content) !== null;
}

/** The content with a done line added. null when it would break the 10,000 character limit. */
export function markDone(content: string, day: string): string | null {
  const base = reopen(content).trimEnd();
  const next = `${base}\n\nDone: ${day}`;
  return next.length > CONTENT_MAX ? null : next;
}

/** The content without its done line. */
export function reopen(content: string): string {
  const trimmed = content.trimEnd();
  const match = trimmed.match(DONE_LINE);
  if (!match || match.index === undefined) return content;
  return trimmed.slice(0, match.index).trimEnd();
}

/**
 * The text with a "Due: YYYY-MM-DD" line (lib/due.ts), placed before a
 * "Done:" line if there is one, so the done line stays last. No date: the
 * text as it is.
 */
export function withDue(body: string, due: string | null): string {
  if (!due) return body;
  const done = doneDate(body);
  const main = (done ? reopen(body) : body).trimEnd();
  return [main, `Due: ${due}`, done ? `Done: ${done}` : ""].filter(Boolean).join("\n\n");
}

/** YYYY-MM-DD in local time. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ------------------------------ dates ------------------------------ */

const MONTHS: Record<string, number> = {};
const NAMES: Array<[number, string[]]> = [
  [0, ["january", "jan", "januari"]],
  [1, ["february", "feb", "februari"]],
  [2, ["march", "mar", "mars"]],
  [3, ["april", "apr"]],
  [4, ["may", "maj"]],
  [5, ["june", "jun", "juni"]],
  [6, ["july", "jul", "juli"]],
  [7, ["august", "aug", "augusti"]],
  [8, ["september", "sep", "sept"]],
  [9, ["october", "oct", "oktober", "okt"]],
  [10, ["november", "nov"]],
  [11, ["december", "dec"]],
];
for (const [index, names] of NAMES) for (const name of names) MONTHS[name] = index;
const MONTH = `(${Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|")})\\.?`;

const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|:e|e)?\\s+${MONTH}(?:\\s+(\\d{4}))?\\b`, "gi");
// The lookahead keeps "20 September 14:00" from also reading as 14 September.
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?!:\\d|\\d)(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi");

function valid(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null;
}

/**
 * Without a year: the first occurrence no more than two months before
 * `written`. "5 October" written in September is this October; "1 May" or
 * "10 January" written in September is next year. A short window means a
 * bare date is rarely read as already past, which is the safe side: a missed
 * overdue costs less than an invented one.
 */
function withYear(m: number, d: number, written: Date): Date | null {
  const floor = new Date(written.getFullYear(), written.getMonth() - 2, written.getDate());
  for (const y of [written.getFullYear(), written.getFullYear() + 1]) {
    const date = valid(y, m, d);
    if (date && date >= floor) return date;
  }
  return null;
}

/** A word right before a date that makes it the thing's due date. */
const CUE = /\b(?:by|due|until|before|deadline|no later than|senast|före|innan|till|klart|färdigt)\b[^.\n]{0,12}$/i;

export type DateHit = { at: number; date: Date; cued: boolean };

/** Every date in the text, in the order they appear, with whether a due-word precedes it. */
export function findDateHits(text: string, written: Date): DateHit[] {
  const hits: DateHit[] = [];
  const add = (at: number, date: Date | null) => {
    if (date) hits.push({ at, date, cued: CUE.test(text.slice(Math.max(0, at - 24), at)) });
  };
  for (const m of text.matchAll(ISO)) add(m.index ?? 0, valid(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  for (const m of text.matchAll(DAY_MONTH)) {
    // "1 may be remote": lowercase "may" is the verb, not the month.
    if (m[2] === "may") continue;
    const month = MONTHS[m[2].toLowerCase()];
    const day = Number(m[1]);
    add(m.index ?? 0, m[3] ? valid(Number(m[3]), month, day) : withYear(month, day, written));
  }
  for (const m of text.matchAll(MONTH_DAY)) {
    if (m[1] === "may") continue;
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    add(m.index ?? 0, m[3] ? valid(Number(m[3]), month, day) : withYear(month, day, written));
  }
  return hits.sort((a, b) => a.at - b.at);
}

export function findDates(text: string, written: Date): Date[] {
  return findDateHits(text, written).map((h) => h.date);
}

/**
 * When an item is due. A "Due: YYYY-MM-DD" line, which the editor's date
 * field writes, is the date and wins over anything else in the text.
 * Without one it is read from the text, built to rather miss a date than
 * invent an overdue one:
 * - a deadline is due on the LATEST date in its title and text, so "decided
 *   3 Sep, ship by 20 Dec" and "moved from 1 Oct to 15 Nov" both read right;
 * - a goal only has a due date when a due-word stands right before it ("by",
 *   "senast", "före"), because goals mention past dates as background.
 * The year of a bare date comes from when the text was last written.
 * The done line never counts.
 */
export function dueDate(memory: Pick<Memory, "title" | "content" | "updated_at" | "category">): Date | null {
  const line = readDue(memory.content);
  if (line) return realDay(line);
  const written = new Date(memory.updated_at);
  if (Number.isNaN(written.getTime())) return null;
  const hits = [...findDateHits(memory.title, written), ...findDateHits(reopen(memory.content), written)];
  const pool = memory.category === "deadline" ? hits : hits.filter((h) => h.cued);
  if (pool.length === 0) return null;
  return pool.reduce((latest, h) => (h.date > latest ? h.date : latest), pool[0].date);
}

/* ------------------------------ the list ------------------------------ */

export type ChecklistItem = {
  memory: Memory;
  due: Date | null;
  done: string | null;
  overdue: boolean;
};

export type Checklist = {
  overdue: ChecklistItem[];
  upcoming: ChecklistItem[];
  undated: ChecklistItem[];
  done: ChecklistItem[];
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function checklistItem(memory: Memory, now: Date): ChecklistItem {
  const done = doneDate(memory.content);
  const due = dueDate(memory);
  return { memory, due, done, overdue: !done && due !== null && due < startOfDay(now) };
}

export function buildChecklist(memories: readonly Memory[], now: Date): Checklist {
  const items = memories.filter((m) => CHECKLIST_CATEGORIES.has(m.category)).map((m) => checklistItem(m, now));
  const byDue = (a: ChecklistItem, b: ChecklistItem) => a.due!.getTime() - b.due!.getTime();
  return {
    overdue: items.filter((i) => i.overdue).sort(byDue),
    upcoming: items.filter((i) => !i.done && !i.overdue && i.due).sort(byDue),
    undated: items
      .filter((i) => !i.done && !i.due)
      .sort((a, b) => (a.memory.updated_at < b.memory.updated_at ? 1 : -1)),
    done: items.filter((i) => i.done).sort((a, b) => (a.done! < b.done! ? 1 : -1)),
  };
}
