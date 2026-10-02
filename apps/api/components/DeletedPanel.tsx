"use client";

/**
 * What was deleted in this space: the title and text it had, who deleted it
 * and when. GET /api/memories/deleted?space_id= (memory_versions, event
 * "delete"). A deleted memory is gone from the globe, the lists and the chat,
 * so this is the one place its history can still be read.
 *
 * Rows are grouped by project. Named projects get Restore project, which puts
 * every restorable memory back in one go (same space, project, category,
 * title and text). Free-standing deletes stay one-by-one. Individual Restore
 * remains under each group. restoreState blocks overwrite when a title is
 * already back with other text. A delete reaches the server a few seconds
 * after the click (the undo queue), so Refresh picks up one made while open.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createMemory, fetchDeleted } from "@/lib/api";
import { categoryVar, labelFor } from "@/lib/categories";
import { formatAge, formatDateTime } from "@/lib/format";
import {
  groupDeletedByProject,
  restoreState,
  whoChanged,
  type DeletedProjectGroup,
} from "@/lib/insights";
import { isApiError, type Memory, type MemoryVersion, type SpaceKind } from "@/lib/types";
import { Button, Collapsible, ErrorText, PanelShell, Row, Skeleton, Tag } from "./ui";

export function DeletedPanel({
  spaceId,
  spaceKind,
  spaceName,
  userId,
  people,
  memories,
  onRestored,
  onClose,
}: {
  spaceId: string;
  spaceKind: SpaceKind;
  spaceName: string;
  userId: string;
  people?: ReadonlyMap<string, string>;
  /** What is in the space now, to tell whether a deleted one is back or in the way. */
  memories: readonly Memory[];
  /** A restore came back from the server: show it now. */
  onRestored: (memory: Memory) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MemoryVersion[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<{ key: string; code?: string; message: string } | null>(null);

  const groups = useMemo(() => (rows ? groupDeletedByProject(rows) : []), [rows]);

  /** Save the deleted text as a new memory. Returns what createMemory returns, so isApiError narrows it. */
  function postRestore(v: MemoryVersion) {
    return createMemory(
      {
        project: v.project,
        category: v.category,
        title: v.title_before,
        content: v.content_before,
        space_id: spaceId,
      },
      userId,
    );
  }

  async function restore(v: MemoryVersion, key: string) {
    if (restoring) return;
    setRestoring(key);
    setRestoreError(null);
    const result = await postRestore(v);
    setRestoring(null);
    if (isApiError(result)) {
      setRestoreError({ key, ...result.error });
      return;
    }
    onRestored(result);
  }

  /** Put every restorable memory in a named project back, one after another. */
  async function restoreProject(group: DeletedProjectGroup) {
    if (restoring || !group.isProject) return;
    const groupKey = `project:${group.key}`;
    setRestoring(groupKey);
    setRestoreError(null);
    // Local snapshot so later rows in this batch see titles already restored.
    let live: readonly Pick<Memory, "project" | "category" | "title" | "content">[] = memories;
    let failed: { code?: string; message: string } | null = null;
    for (const version of group.items) {
      if (restoreState(version, live) !== "restorable") continue;
      const result = await postRestore(version);
      if (isApiError(result)) {
        failed = result.error;
        continue;
      }
      onRestored(result);
      live = [...live, result];
    }
    setRestoring(null);
    if (failed) setRestoreError({ key: groupKey, ...failed });
  }

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchDeleted(spaceId, userId);
    setLoading(false);
    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result);
  }, [spaceId, userId]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  let rowIndex = 0;

  return (
    <PanelShell
      label="Deleted"
      title={rows ? `Deleted (${rows.length})` : "Deleted"}
      subtitle={`${spaceName} · who deleted what, and the text it had`}
      actions={
        <Button variant="quiet" className="px-2" onClick={() => void load()} disabled={loading} busy={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      }
      onClose={onClose}
    >
      {error ? (
        <div className="px-4 pb-3">
          <ErrorText code={error.code} message={error.message} />
        </div>
      ) : null}

      {!rows && !error ? (
        <div className="px-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : rows && rows.length === 0 ? (
        <p className="fade-in px-5 py-10 text-center text-sm text-ink-3">Nothing has been deleted in {spaceName}.</p>
      ) : rows ? (
        <div className="flex flex-col gap-4 px-4 pb-4">
          {groups.map((group) => {
            const groupKey = `project:${group.key}`;
            const states = group.items.map((v) => restoreState(v, memories));
            const restorable = states.filter((s) => s === "restorable").length;
            const allRestored = states.length > 0 && states.every((s) => s === "restored");
            const heading = group.isProject
              ? `${group.label} · ${group.items.length} ${group.items.length === 1 ? "memory" : "memories"}`
              : `Memories · ${group.items.length} ${group.items.length === 1 ? "memory" : "memories"}`;

            return (
              <section key={group.key || "free"} className="rounded-lg border border-line">
                <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-ink">{heading}</h3>
                    {group.isProject ? (
                      <p className="mt-0.5 text-xs text-ink-3">Deleted project — restore puts every memory back</p>
                    ) : (
                      <p className="mt-0.5 text-xs text-ink-3">Free-standing memories (no project)</p>
                    )}
                  </div>
                  {group.isProject ? (
                    allRestored ? (
                      <Tag>Restored</Tag>
                    ) : restorable > 0 ? (
                      <Button
                        variant="ghost"
                        className="shrink-0 px-2.5 py-1 text-xs"
                        disabled={restoring !== null}
                        busy={restoring === groupKey}
                        onClick={() => void restoreProject(group)}
                        aria-label={`Restore project ${group.label}`}
                      >
                        {restoring === groupKey ? "Restoring…" : "Restore project"}
                      </Button>
                    ) : null
                  ) : null}
                </div>
                {restoreError?.key === groupKey ? (
                  <div className="px-3 pt-2">
                    <ErrorText code={restoreError.code} message={restoreError.message} />
                  </div>
                ) : null}
                <ul className="flex flex-col px-1">
                  {group.items.map((v) => {
                    const key = `${v.memory_id}:${v.version_number}`;
                    const expanded = open === key;
                    const state = restoreState(v, memories);
                    const index = rowIndex++;
                    return (
                      <Row key={key} index={index} className="border-b border-line last:border-0" innerClassName="px-2 py-3">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            className="press block min-w-0 flex-1 text-left"
                            aria-expanded={expanded}
                            onClick={() => setOpen(expanded ? null : key)}
                          >
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: categoryVar(v.category) }}
                              />
                              <span className="truncate">{v.title_before || "Untitled"}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-3">{labelFor(v.category)}</span>
                            <span className="mt-0.5 block text-xs text-ink-3">
                              <span className="font-medium text-ink-2">
                                {whoChanged(v, userId, spaceKind, people)}
                              </span>{" "}
                              deleted it ·{" "}
                              <time dateTime={v.created_at} title={formatDateTime(v.created_at)}>
                                {formatAge(v.created_at)}
                              </time>
                            </span>
                          </button>
                          {state === "restored" ? (
                            <Tag>Restored</Tag>
                          ) : state === "taken" ? (
                            <span
                              className="fade-in shrink-0 pt-0.5 text-xs text-ink-3"
                              title="A memory with this title is back with other text. Restoring would overwrite it."
                            >
                              Title in use
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              className="shrink-0 px-2.5 py-1 text-xs"
                              disabled={restoring !== null}
                              busy={restoring === key}
                              onClick={() => void restore(v, key)}
                              aria-label={`Restore ${v.title_before || "this memory"}`}
                            >
                              {restoring === key ? "Restoring…" : "Restore"}
                            </Button>
                          )}
                        </div>
                        {restoreError?.key === key ? (
                          <div className="mt-1.5">
                            <ErrorText code={restoreError.code} message={restoreError.message} />
                          </div>
                        ) : null}
                        {state === "taken" ? (
                          <p className="mt-1 text-xs text-ink-3">
                            A memory called &quot;{v.title_before}&quot; is back in {v.project || "Memories"} with
                            other text. Restoring would overwrite it, so open that one instead.
                          </p>
                        ) : null}
                        <Collapsible open={expanded}>
                          <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-2">
                            <span className="sr-only">Text before it was deleted: </span>
                            {v.content_before}
                          </p>
                        </Collapsible>
                      </Row>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}

      <p className="px-4 pb-6 text-xs text-ink-3">
        Deleted memories are gone from the globe and from every chat. Their last text stays here so the team can
        see who removed what. Restore project puts a whole named project back; Restore puts one memory back. A
        delete shows up a few seconds after the click, once it has been sent.
      </p>
    </PanelShell>
  );
}
