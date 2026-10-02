/**
 * The date on a goal or a deadline, and dates that cannot exist.
 *
 * The API has four fields (project, category, title, content) and no date
 * column, so the date lives in the text. Until 29 Sep the editor had no date
 * field at all: a deadline was whatever the text said, "32 oktober" and
 * "2026-02-30" included, and the checklist silently read no date from it
 * (Filip: "man kan skriva vad som helst").
 *
 * Now the editor has a real date field for Goal and Deadline, and the date is
 * written as a line of its own at the end of the text:
 *
 *   Due: 2026-10-15
 *
 * One fixed ISO line, so the checklist, the AI and a person all read the same
 * date and nothing has to guess a year. A "Done: ..." line from the checklist
 * stays the last line, so Due goes right before it (withDue, in
 * lib/checklist.ts next to the done line it has to respect).
 *
 * Pure functions. test/due.test.ts covers them.
 */

/** The range the date field accepts. Catches "20266" and "0026" typed into a year. */
export const DUE_MIN = "2000-01-01";
export const DUE_MAX = "2099-12-31";

const DUE_LINE = /(^|\n)[ \t]*due:[ \t]*(\d{4}-\d{2}-\d{2})\.?[ \t]*(?=\n|$)/i;

/** A real calendar day as YYYY-MM-DD inside the accepted range, else null. */
export function realDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  const iso = value.trim();
  if (iso < DUE_MIN || iso > DUE_MAX) return null;
  return date;
}

/** The date on the "Due:" line, when there is one and it is a real day. */
export function readDue(content: string): string | null {
  const iso = DUE_LINE.exec(content)?.[2] ?? null;
  return iso && realDay(iso) ? iso : null;
}

/** The text without its "Due:" line, and the date that line held. */
export function splitDue(content: string): { body: string; due: string | null } {
  const match = DUE_LINE.exec(content);
  if (!match || match.index === undefined) return { body: content, due: null };
  const start = match.index + match[1].length;
  const before = content.slice(0, start).trimEnd();
  const after = content.slice(match.index + match[0].length).replace(/^[ \t]*\n+/, "");
  const body = before && after ? `${before}\n\n${after}` : before || after;
  return { body, due: realDay(match[2]) ? match[2] : null };
}

/* ------------------------- dates that cannot exist ------------------------- */

const MONTH_NAMES: Array<[number, string[]]> = [
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
const MONTHS = new Map<string, number>();
for (const [index, names] of MONTH_NAMES) for (const name of names) MONTHS.set(name, index);
const MONTH = `(${[...MONTHS.keys()].sort((a, b) => b.length - a.length).join("|")})\\.?`;

const ISO_LIKE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|:e|e)?\\s+${MONTH}(?:\\s+(\\d{4}))?\\b`, "gi");
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?!:\\d|\\d)(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi");

/** Days in a month. Without a year February gets 29, so "29 February" alone is never flagged. */
function daysIn(month: number, year?: number): number {
  return new Date(year ?? 2024, month + 1, 0).getDate();
}

function impossible(month: number, day: number, year?: number): boolean {
  return day < 1 || day > daysIn(month, year);
}

/**
 * Every date in the text that cannot exist: "2026-02-30", "32 oktober",
 * "April 31", "29 February 2027". In the order they appear, as written.
 * Lowercase "may" is skipped, as in the checklist: "1 may be late" is a verb.
 */
export function impossibleDates(text: string): string[] {
  const hits: Array<{ at: number; text: string }> = [];
  for (const m of text.matchAll(ISO_LIKE)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || impossible(mo - 1, d, y)) hits.push({ at: m.index ?? 0, text: m[0] });
  }
  for (const m of text.matchAll(DAY_MONTH)) {
    if (m[2] === "may") continue;
    const month = MONTHS.get(m[2].toLowerCase());
    if (month === undefined) continue;
    if (impossible(month, Number(m[1]), m[3] ? Number(m[3]) : undefined)) hits.push({ at: m.index ?? 0, text: m[0] });
  }
  for (const m of text.matchAll(MONTH_DAY)) {
    if (m[1] === "may") continue;
    const month = MONTHS.get(m[1].toLowerCase());
    if (month === undefined) continue;
    if (impossible(month, Number(m[2]), m[3] ? Number(m[3]) : undefined)) hits.push({ at: m.index ?? 0, text: m[0] });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.text.trim());
}

/* ------------------------------ the editor ------------------------------ */

/** Categories that carry a date. Deadline must have one, Goal may. */
export function dateRule(category: string): "required" | "optional" | null {
  if (category === "deadline") return "required";
  if (category === "goal") return "optional";
  return null;
}

/**
 * What is wrong with the date, or null. `badInput` is the date field's own
 * validity flag: true while a day, month or year is only partly typed.
 */
export function dueProblem(category: string, due: string, badInput = false): string | null {
  const rule = dateRule(category);
  if (!rule) return null;
  if (badInput) return "Finish the date: day, month and year.";
  if (!due) return rule === "required" ? "A deadline needs a date. Pick one in the date field." : null;
  if (!realDay(due)) return `Pick a real date between ${DUE_MIN.slice(0, 4)} and ${DUE_MAX.slice(0, 4)}.`;
  return null;
}

/** The first impossible date in the title or text, as a sentence, or null. */
export function impossibleDateProblem(title: string, content: string): string | null {
  const bad = impossibleDates(`${title}\n${content}`)[0];
  return bad ? `"${bad}" is not a real date. Fix it, or use the date field.` : null;
}
