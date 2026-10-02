/**
 * What the AI saved on its own, waiting for a human look.
 *
 * Every get_context call can write new memories (boringcontext, source
 * "brain"), and nobody sees them being written. A wrong one becomes wrong
 * context in every later chat. So the dashboard keeps a review inbox: memories
 * with source "brain" that this reader has not yet kept, fixed or deleted.
 *
 * "Reviewed" is remembered per browser, per account and space, keyed on id
 * plus a hash of what the memory says (project, category, title, content). If
 * the text changes afterwards (the AI overwrote it, or a teammate edited it)
 * it comes back for another look. Something the reader saves themselves counts
 * as reviewed.
 *
 * Not keyed on updated_at: on the live database updated_at moves on every
 * UPDATE, including the embedding write right after a save, so a memory the
 * reader had just kept came straight back. Keys written before this change
 * (id@updated_at) are still honoured.
 *
 * The inbox only exists when the list rows carry `source` at all, rather than
 * showing an empty inbox that looks like "all fine" against a server that
 * does not send it.
 *
 * Pure functions. test/review.test.ts covers them.
 */
import type { Memory } from "./types";

/** Entries kept per space. Old ones fall off; the worst case is a second look. */
export const REVIEWED_LIMIT = 2000;

type Reviewable = Pick<Memory, "id" | "project" | "category" | "title" | "content">;

/** FNV-1a, 32 bit. Only has to tell two versions of one memory apart. */
function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function reviewKey(memory: Reviewable): string {
  return `${memory.id}#${textHash([memory.project, memory.category, memory.title, memory.content].join("\u0000"))}`;
}

/** The key format used before 29 Sep 2026. */
function legacyKey(memory: Pick<Memory, "id" | "updated_at">): string {
  return `${memory.id}@${memory.updated_at}`;
}

export function isReviewed(memory: Memory, reviewed: ReadonlySet<string>): boolean {
  return reviewed.has(reviewKey(memory)) || reviewed.has(legacyKey(memory));
}

/** True when the server sends `source` on list rows, even as null. */
export function sourceKnown(memories: readonly Memory[]): boolean {
  return memories.some((m) => Object.prototype.hasOwnProperty.call(m, "source"));
}

/** Saved by the AI and not reviewed in its current form. Newest first. */
export function toReview(memories: readonly Memory[], reviewed: ReadonlySet<string>): Memory[] {
  return memories
    .filter((m) => m.source === "brain" && !isReviewed(m, reviewed))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

/** Add keys, drop the oldest beyond the limit. Order is insertion order. */
export function withReviewed(current: readonly string[], add: readonly string[], limit = REVIEWED_LIMIT): string[] {
  const next = current.filter((k) => !add.includes(k));
  next.push(...add);
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * POST and PATCH on the live API answer without `source` (asMemory), while the
 * list rows carry it. Keep what the list knew about the row; a brand-new row
 * saved from here is from the dashboard. Without this the Source line and the
 * inbox lose the row until the next refresh. Against a server whose list has
 * no `source` at all nothing is added, so the inbox stays hidden there.
 */
export function keepSource(saved: Memory, previous: Memory | undefined, listHasSource: boolean): Memory {
  if (!listHasSource || Object.prototype.hasOwnProperty.call(saved, "source")) return saved;
  if (previous) {
    return Object.prototype.hasOwnProperty.call(previous, "source") ? { ...saved, source: previous.source } : saved;
  }
  return { ...saved, source: "dashboard" };
}
