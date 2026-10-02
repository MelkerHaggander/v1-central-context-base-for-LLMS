"use client";

/**
 * The text side of the globe.
 *
 * Every dot on the sphere is also a row here, with its title, project, category,
 * both timestamps and its id. That is deliberate: colour and position are a fast
 * way to see shape, never the only way to read a value, and two of the six hues
 * sit below 3:1 contrast on the light surface. If it is on the globe it is
 * readable as text.
 *
 * v1.2 adds: a New tag (created in the last 24 hours), a Changed tag (updated
 * since the reader's last visit to this space), the history of each memory,
 * where it came from when the server says so, and select-and-delete for many
 * rows at once. Deleting stays dashboard only; a language model has no delete
 * tool.
 */

import { useEffect, useMemo, useState } from "react";
import { filterMemories } from "@/lib/aggregate";
import { createMemory, deleteMemory, updateMemory } from "@/lib/api";
import { categoryVar, labelFor } from "@/lib/categories";
import { formatAge, formatDateTime } from "@/lib/format";
import { changedSince, latestChange, projectMatch, teamMoveLabel, whoChanged } from "@/lib/insights";
import { LEAVE_MS } from "@/lib/motion";
import { isApiError, type Memory, type MemorySource, type Space, type SpaceKind } from "@/lib/types";
import { MemoryHistory } from "./MemoryHistory";
import { motionReduced, usePresenceList } from "./useMotion";
import { Button, Collapsible, ConfirmButton, ErrorText, PanelShell, Row, Tag, inputClass } from "./ui";
import { useVersions } from "./useVersions";

const SOURCE_TEXT: Record<MemorySource, string> = {
  dashboard: "Added in the dashboard",
  brain: "Saved by the AI from a chat",
};

export function MemoryPanel({
  heading,
  subheading,
  memories,
  selectedId,
  userId,
  spaceKind,
  people,
  newIds,
  overdueIds,
  doneIds,
  since,
  emptyText,
  flash,
  onRowHover,
  onSelect,
  onEdit,
  onCreate,
  onDelete,
  onMoved,
  onMovedToTeam,
  knownProjects = [],
  teamSpaces = [],
  onClose,
}: {
  heading: string;
  subheading?: string;
  memories: readonly Memory[];
  selectedId: string | null;
  userId: string;
  spaceKind: SpaceKind;
  /** user_id -> email for the history, when the server lists members. */
  people?: ReadonlyMap<string, string>;
  newIds: ReadonlySet<string>;
  /** Goals and deadlines whose date has passed without being checked off. */
  overdueIds?: ReadonlySet<string>;
  /** Checked off in the checklist. */
  doneIds?: ReadonlySet<string>;
  /** ISO time of the previous visit to this space, or null on a first visit. */
  since: string | null;
  emptyText?: string;
  /** The row that was just saved: it lights up once and scrolls into view. */
  flash?: { id: string; n: number } | null;
  /** The row under the pointer and its vertical middle, for the line to its dot on the globe. */
  onRowHover?: (id: string | null, y?: number) => void;
  onSelect: (id: string | null) => void;
  onEdit: (memory: Memory) => void;
  onCreate?: () => void;
  /** Hands rows to the undo queue; they vanish now and are deleted a few seconds later. */
  onDelete: (memories: readonly Memory[]) => void;
  /** After a successful move to another project in the same space. */
  onMoved?: (memory: Memory) => void;
  /**
   * After Personal → Team: the old Personal id is gone; the copy lives in `teamId`.
   * Team → Personal is never offered.
   */
  onMovedToTeam?: (fromId: string, teamId: string, created: Memory) => void;
  /** Existing project names for same-space project moves. */
  knownProjects?: readonly string[];
  /** Shared spaces to offer when the reader is in Personal. */
  teamSpaces?: readonly Space[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  // Move menu is separate from History so the two actions are not confused.
  const [moveOpen, setMoveOpen] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ code?: string; message: string } | null>(null);

  // Teams only appear as destinations from Personal. Never the reverse.
  const moveTeams = spaceKind === "personal" ? teamSpaces.filter((s) => s.kind === "shared") : [];
  const projectTargets = [...knownProjects]
    .map((name) => name.trim())
    .filter((name, index, all) => name && all.indexOf(name) === index);

  // The open memory's history: who changed it last, shown right away, and the
  // full list under History. One request when a memory opens.
  const openMemory = selecting ? null : (memories.find((m) => m.id === selectedId) ?? null);
  const history = useVersions(openMemory?.id ?? null, openMemory?.updated_at ?? null, userId);
  const last = history.versions ? latestChange(history.versions) : null;
  const versionSource: MemorySource | null = history.versions?.find((v) => v.source)?.source ?? null;

  const rows = useMemo(() => filterMemories(memories, { query }), [memories, query]);
  // Rows that leave (a delete, a filter) close in height instead of vanishing.
  const shown = usePresenceList(rows, (m) => m.id, LEAVE_MS.row);
  const pickedVisible = rows.filter((m) => picked.has(m.id));

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => {
      document
        .getElementById(`memory-row-${flash.id}`)
        ?.scrollIntoView({ block: "nearest", behavior: motionReduced() ? "auto" : "smooth" });
    }, 60);
    return () => window.clearTimeout(id);
  }, [flash]);

  /**
   * Picked rows go to the undo queue as one batch, so one Undo brings them all
   * back. The queue sends one DELETE at a time and returns any row that fails.
   */
  function removePicked() {
    if (pickedVisible.length === 0) return;
    onDelete(pickedVisible);
    setPicked(new Set());
    setSelecting(false);
  }

  /**
   * Same-space project move. Clearing the project (→ Personal free-standing)
   * is blocked: once it has a project name it stays in a project.
   */
  async function moveToProject(memory: Memory, rawTarget: string) {
    const target = projectMatch(rawTarget, knownProjects) ?? rawTarget.trim();
    if (!target) {
      setMoveError({
        code: "PROJECT_REQUIRED",
        message: "A memory cannot be moved to Personal. Pick a project or a team.",
      });
      return;
    }
    if (target === memory.project.trim()) return;
    setMovingId(memory.id);
    setMoveError(null);
    const result = await updateMemory(
      memory.id,
      {
        project: target,
        category: memory.category,
        title: memory.title,
        content: memory.content,
      },
      userId,
      true,
    );
    setMovingId(null);
    if (isApiError(result)) {
      setMoveError(result.error);
      return;
    }
    setMoveOpen(null);
    onMoved?.(result);
  }

  /**
   * Personal → Team only. PATCH cannot change space_id, so we create in the
   * team then delete the Personal copy. The copy lands as a free-standing
   * memory (empty project → Memories tab), not under the Personal project
   * name. Team → Personal is never offered.
   */
  async function moveToTeam(memory: Memory, team: Space) {
    if (spaceKind !== "personal" || team.kind !== "shared") {
      setMoveError({
        code: "MOVE_TO_PERSONAL_BLOCKED",
        message: "A memory cannot be moved from a team back to Personal.",
      });
      return;
    }
    setMovingId(memory.id);
    setMoveError(null);
    const created = await createMemory(
      {
        // Drop the Personal project: a moved memory is a single Memories row in the team.
        project: "",
        category: memory.category,
        title: memory.title,
        content: memory.content,
        space_id: team.id,
      },
      userId,
    );
    if (isApiError(created)) {
      setMovingId(null);
      setMoveError(created.error);
      return;
    }
    const removed = await deleteMemory(memory.id, userId);
    setMovingId(null);
    if (isApiError(removed)) {
      setMoveError({
        code: removed.error.code,
        message: `Saved in ${teamMoveLabel(team)}, but the Personal copy could not be removed: ${removed.error.message}`,
      });
      // Still leave Personal so the reader does not keep staring at a duplicate.
      onMovedToTeam?.(memory.id, team.id, created);
      return;
    }
    setMoveOpen(null);
    onMovedToTeam?.(memory.id, team.id, created);
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allPicked = rows.length > 0 && pickedVisible.length === rows.length;

  return (
    <PanelShell
      label={heading}
      title={heading}
      subtitle={`${memories.length} ${memories.length === 1 ? "memory" : "memories"}${subheading ? ` · ${subheading}` : ""}`}
      onClose={onClose}
      actions={
        <>
          {memories.length > 0 ? (
            <Button
              variant="quiet"
              className="px-2"
              onClick={() => {
                setSelecting((v) => !v);
                setPicked(new Set());
              }}
              aria-pressed={selecting}
            >
              <span key={selecting ? "done" : "select"} className="fade-in">
                {selecting ? "Done" : "Select"}
              </span>
            </Button>
          ) : null}
          {onCreate && !selecting ? (
            <Button variant="quiet" className="px-2" onClick={onCreate} title="New memory here">
              New
            </Button>
          ) : null}
        </>
      }
      footer={
        selecting ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="press text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline"
              onClick={() => setPicked(allPicked ? new Set() : new Set(rows.map((m) => m.id)))}
            >
              {allPicked ? "Clear" : `Select all ${rows.length}`}
            </button>
            <span key={pickedVisible.length} className="fade-in tnum ml-auto text-xs text-ink-3">
              {pickedVisible.length} selected
            </span>
            <ConfirmButton
              idleLabel={`Delete ${pickedVisible.length || ""}`.trim()}
              confirmLabel={`Really delete ${pickedVisible.length}`}
              busy={pickedVisible.length === 0}
              onConfirm={removePicked}
            />
          </div>
        ) : undefined
      }
    >
      {memories.length > 6 ? (
        <div className="px-5 pb-2">
          <input
            className={inputClass}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter these memories"
            aria-label="Filter these memories"
          />
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="fade-in px-5 py-10 text-center text-sm text-ink-3">
          <p>{memories.length === 0 ? emptyText ?? "Nothing here yet." : "No memory matches that filter."}</p>
          {memories.length === 0 && onCreate ? (
            <Button variant="ghost" className="mt-3" onClick={onCreate}>
              Add a memory
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="pb-4">
          {shown.map(({ item: memory, leaving }, index) => {
            const open = memory.id === selectedId && !selecting && !leaving;
            const lit = flash?.id === memory.id;
            const fresh = newIds.has(memory.id);
            const changed = !fresh && changedSince(memory, since);
            const source = memory.source ?? (open ? versionSource : null);
            // null from the server means "not recorded" (saved before v1.2 kept
            // track); a missing field means this server does not send it.
            const sent = Object.prototype.hasOwnProperty.call(memory, "source");
            return (
              <Row key={memory.id} leaving={leaving} index={index}>
                <div
                  id={`memory-row-${memory.id}`}
                  onMouseEnter={(event) => onRowHover?.(memory.id, middle(event.currentTarget))}
                  onMouseMove={(event) => onRowHover?.(memory.id, middle(event.currentTarget))}
                  onMouseLeave={() => onRowHover?.(null)}
                  onFocus={(event) => onRowHover?.(memory.id, middle(event.currentTarget))}
                  onBlur={() => onRowHover?.(null)}
                  // Remounted for each save, so the flash plays again.
                  key={lit ? `flash-${flash?.n}` : "row"}
                  className={`flex items-start gap-2.5 px-4 py-2 transition-colors active:bg-surface-3 ${
                    open ? "bg-surface-2" : "hover:bg-surface-2"
                  } ${lit ? "flash" : ""}`}
                >
                  {selecting ? (
                    <input
                      type="checkbox"
                      className="tick pop-in mt-1 size-3.5 shrink-0 accent-[var(--ink)]"
                      checked={picked.has(memory.id)}
                      onChange={() => togglePick(memory.id)}
                      aria-label={`Select ${memory.title}`}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="pop-in mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ background: categoryVar(memory.category) }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => (selecting ? togglePick(memory.id) : onSelect(open ? null : memory.id))}
                    aria-expanded={selecting ? undefined : open}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{memory.title}</span>
                      {fresh ? <Tag title="Created in the last 24 hours">New</Tag> : null}
                      {changed ? <Tag title="Changed since your last visit">Changed</Tag> : null}
                      {overdueIds?.has(memory.id) ? <Tag title="Its date has passed and it is not checked off">Overdue</Tag> : null}
                      {doneIds?.has(memory.id) ? <Tag title="Checked off in the checklist">Done</Tag> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {labelFor(memory.category)}
                      {memory.project.trim() ? ` · ${memory.project}` : ""} ·{" "}
                      <time dateTime={memory.created_at} title={`Created ${formatDateTime(memory.created_at)}`}>
                        {formatAge(memory.created_at)}
                      </time>
                    </span>
                  </button>
                </div>

                <Collapsible open={open} className="bg-surface-2 px-4 pb-4 pl-[2.2rem]">
                    <p className="whitespace-pre-wrap text-sm text-ink-2">{memory.content}</p>
                    <dl className="tnum mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-3">
                      <dt>Created</dt>
                      <dd>{formatDateTime(memory.created_at)}</dd>
                      {/* Team only: who first wrote the row (email via members map). */}
                      {spaceKind === "shared" ? (
                        <>
                          <dt>Created by</dt>
                          <dd>
                            {memory.created_by
                              ? whoChanged(
                                  { changed_by: memory.created_by },
                                  userId,
                                  spaceKind,
                                  people,
                                )
                              : "Unknown"}
                          </dd>
                        </>
                      ) : null}
                      <dt>Updated</dt>
                      <dd>{formatDateTime(memory.updated_at)}</dd>
                      <dt>Last change</dt>
                      <dd>
                        {history.error ? (
                          "Could not load who changed it"
                        ) : !history.versions ? (
                          "…"
                        ) : last ? (
                          <>
                            <span className="text-ink-2">{whoChanged(last, userId, spaceKind, people)}</span>
                            {" · "}
                            <time dateTime={last.created_at} title={formatDateTime(last.created_at)}>
                              {formatAge(last.created_at)}
                            </time>
                          </>
                        ) : (
                          "Not changed since it was saved"
                        )}
                      </dd>
                      <dt>Source</dt>
                      <dd
                        title={
                          source
                            ? undefined
                            : sent
                              ? "Saved before the server recorded where a memory comes from."
                              : "The server did not say where this memory came from."
                        }
                      >
                        {source ? SOURCE_TEXT[source] : sent ? "Not recorded" : "Not sent by the server"}
                      </dd>
                      <dt>Id</dt>
                      <dd className="font-mono break-all">{memory.id}</dd>
                    </dl>

                    <div className="mt-3 flex flex-wrap items-center gap-1">
                      <Button
                        variant="quiet"
                        className="-ml-3"
                        aria-expanded={historyOpen === memory.id}
                        onClick={() => {
                          setHistoryOpen(historyOpen === memory.id ? null : memory.id);
                          setMoveOpen(null);
                        }}
                      >
                        <span key={historyOpen === memory.id ? "hide" : "show"} className="fade-in">
                          {historyOpen === memory.id ? "Hide history" : "History"}
                        </span>
                      </Button>
                      <span className="ml-auto" />
                      {/* Move: Personal → Team (labelled "Name (Teams)"), or same-space project.
                          Team → Personal is never listed. */}
                      <Button
                        variant="quiet"
                        className="px-2"
                        aria-expanded={moveOpen === memory.id}
                        disabled={movingId === memory.id}
                        onClick={() => {
                          setMoveOpen(moveOpen === memory.id ? null : memory.id);
                          setHistoryOpen(null);
                          setMoveError(null);
                        }}
                      >
                        {movingId === memory.id ? "Moving…" : "Move"}
                      </Button>
                      <Button variant="ghost" onClick={() => onEdit(memory)}>
                        Edit
                      </Button>
                      <ConfirmButton onConfirm={() => onDelete([memory])} />
                    </div>
                    {moveOpen === memory.id ? (
                      <div className="fade-in mt-2 rounded-lg border border-line bg-surface px-2 py-2">
                        <p className="mb-1.5 px-1 text-xs text-ink-3">Move to</p>
                        {moveTeams.length === 0 && projectTargets.length === 0 ? (
                          <p className="px-1 py-1 text-sm text-ink-3">No teams or projects to move to.</p>
                        ) : (
                          <ul className="flex flex-col gap-0.5">
                            {moveTeams.map((team) => (
                              <li key={team.id}>
                                <button
                                  type="button"
                                  className="press w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
                                  disabled={movingId === memory.id}
                                  onClick={() => void moveToTeam(memory, team)}
                                >
                                  {teamMoveLabel(team)}
                                </button>
                              </li>
                            ))}
                            {projectTargets.map((name) => (
                              <li key={name}>
                                <button
                                  type="button"
                                  className={`press w-full rounded-md px-2 py-1.5 text-left text-sm ${
                                    memory.project === name
                                      ? "bg-surface-3 font-medium text-ink"
                                      : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                                  }`}
                                  disabled={movingId === memory.id || memory.project === name}
                                  onClick={() => void moveToProject(memory, name)}
                                >
                                  {name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                    {moveError && selectedId === memory.id ? (
                      <div className="mt-2">
                        <ErrorText code={moveError.code} message={moveError.message} />
                      </div>
                    ) : null}

                    <Collapsible open={historyOpen === memory.id} className="pt-3">
                      <MemoryHistory
                        versions={history.versions}
                        error={history.error}
                        userId={userId}
                        spaceKind={spaceKind}
                        people={people}
                        live={memory}
                      />
                    </Collapsible>
                </Collapsible>
              </Row>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

/** The vertical middle of an element on screen. */
function middle(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return r.top + r.height / 2;
}
