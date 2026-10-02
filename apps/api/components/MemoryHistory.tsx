"use client";

/**
 * Earlier versions of one memory. GET /api/memories/:id/versions (Melker,
 * c31e656): newest first, who and when, and what changed.
 *
 * A version row stores the values *before* the change. Title and content
 * carry their "after" on the row; project and category do not, so those are
 * derived (lib/insights.ts withAfterValues) from the next version or the
 * live row. Only the fields that actually changed are printed.
 *
 * "Who" is a user id. The reader's own changes say "You". In Personal every
 * change is "You" (one member). A teammate shows their email when the
 * members list (GET /api/spaces/:id/members) answers, otherwise "A teammate"
 * with the first characters of the id. Never a guessed name.
 *
 * Old versions are text only and never context for a model. This is the one
 * place they are shown.
 */

import { labelFor } from "@/lib/categories";
import { formatAge, formatDateTime } from "@/lib/format";
import { whoChanged, withAfterValues } from "@/lib/insights";
import type { Memory, MemoryVersion, SpaceKind } from "@/lib/types";
import { ErrorText, Skeleton } from "./ui";

/** Free-standing memories have an empty project; the panel calls that Memories. */
function projectName(project: string | null): string {
  return project && project.trim() ? project.trim() : "Memories";
}

export function MemoryHistory({
  versions,
  error,
  userId,
  spaceKind,
  people,
  live,
}: {
  versions: MemoryVersion[] | null;
  error: { code?: string; message: string } | null;
  userId: string;
  spaceKind: SpaceKind;
  people?: ReadonlyMap<string, string>;
  /** The memory as it is now, to fill in the "after" of the newest version. */
  live: Pick<Memory, "project" | "category"> | null;
}) {
  if (error) return <ErrorText code={error.code} message={error.message} />;
  if (!versions) return <Skeleton className="h-10 w-full" />;
  if (versions.length === 0) {
    return <p className="text-xs text-ink-3">No earlier versions. This is the text it was saved with.</p>;
  }

  const rows = withAfterValues(versions, live);

  return (
    <ol className="flex flex-col gap-3">
      {rows.map((version) => {
        const isDelete = version.event === "delete";
        const titleChanged = !isDelete && version.title_before !== version.title_after;
        const contentChanged = !isDelete && version.content_before !== version.content_after;
        const projectChanged =
          !isDelete && version.project_after !== null && version.project !== version.project_after;
        const categoryChanged =
          !isDelete && version.category_after !== null && version.category !== version.category_after;
        return (
          <li key={version.version_number} className="border-l border-line-2 pl-3">
            <p className="text-xs text-ink-3">
              <span className="font-medium text-ink-2">{whoChanged(version, userId, spaceKind, people)}</span>{" "}
              {isDelete ? "deleted it" : "changed it"} ·{" "}
              <time dateTime={version.created_at} title={formatDateTime(version.created_at)}>
                {formatAge(version.created_at)}
              </time>
            </p>

            {/* One line per changed field. Unchanged fields are not printed. */}
            {titleChanged ? (
              <p className="mt-1 text-xs">
                <span className="text-ink-3">Title </span>
                <del className="text-ink-3">{version.title_before}</del>{" "}
                <span aria-hidden className="text-ink-3">→</span> {version.title_after || "—"}
              </p>
            ) : null}
            {projectChanged ? (
              <p className="mt-1 text-xs">
                <span className="text-ink-3">Project </span>
                <del className="text-ink-3">{projectName(version.project)}</del>{" "}
                <span aria-hidden className="text-ink-3">→</span> {projectName(version.project_after)}
              </p>
            ) : null}
            {categoryChanged && version.category_after ? (
              <p className="mt-1 text-xs">
                <span className="text-ink-3">Category </span>
                <del className="text-ink-3">{labelFor(version.category)}</del>{" "}
                <span aria-hidden className="text-ink-3">→</span> {labelFor(version.category_after)}
              </p>
            ) : null}

            {/* Text: a delete shows the last text; an update shows before and after when it differs. */}
            {isDelete || contentChanged ? (
              <p className="mt-1 whitespace-pre-wrap text-xs text-ink-3">
                <span className="sr-only">Before: </span>
                <del>{version.content_before}</del>
              </p>
            ) : null}
            {contentChanged ? (
              <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2">
                <span className="sr-only">After: </span>
                {version.content_after}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
