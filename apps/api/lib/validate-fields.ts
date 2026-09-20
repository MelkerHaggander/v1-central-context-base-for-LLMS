/**
 * The same limits and the same order as packages/memory/src/validate.ts, checked
 * in the browser so the reader sees the problem before the round trip instead of
 * a bare INVALID_TITLE after it.
 *
 * This is a courtesy, never the authority. The server validates again and its
 * error wins. Keep these numbers in step with contracts.md.
 */
import type { MemoryFields } from "./api";
import { DISPLAY_ORDER } from "./categories";

export const LIMITS = { project: 100, title: 150, content: 10_000 } as const;

/** First failure wins, in the server's order: project, title, content, category. */
export function firstProblem(fields: MemoryFields): string | null {
  const project = fields.project.trim();
  const title = fields.title.trim();
  const content = fields.content.trim();

  if (project.length < 1) return "A project name is required.";
  if (project.length > LIMITS.project) return `Project must be ${LIMITS.project} characters or fewer.`;
  if (title.length < 1) return "A title is required.";
  if (title.length > LIMITS.title) return `Title must be ${LIMITS.title} characters or fewer.`;
  if (content.length < 1) return "Content is required.";
  if (content.length > LIMITS.content)
    return `Content must be ${LIMITS.content.toLocaleString("en-GB")} characters or fewer.`;
  if (!(DISPLAY_ORDER as readonly string[]).includes(fields.category)) return "Pick a category.";
  return null;
}
