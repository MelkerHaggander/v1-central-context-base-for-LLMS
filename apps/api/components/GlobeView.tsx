"use client";

/**
 * The map of memories, and the whole of the dashboard's main view.
 *
 * Position is project, colour is category. Clicking goes down one level at a
 * time: the whole sphere to a project, a project to a single memory. The panel
 * beside it is the same information as text, always reachable, so nothing here
 * depends on being able to see or click a coloured dot.
 *
 * v1.2: everything is scoped to one space, picked in the switcher at the top
 * (Personal or Team). The switcher only steers this view. It never reaches MCP.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { summarise, countProjects } from "@/lib/aggregate";
import { categoryVar, labelFor } from "@/lib/categories";
import { buildLayout } from "@/lib/globe/sphere";
import { formatAge } from "@/lib/format";
import {
  changedSince,
  exportFileName,
  exportJson,
  exportMarkdown,
  findDuplicates,
  isNew,
  spaceLabel,
} from "@/lib/insights";
import type { Memory, SessionUser, Space } from "@/lib/types";
import { buildChecklist } from "@/lib/checklist";
import { LEAVE_MS } from "@/lib/motion";
import { keepSource, sourceKnown, toReview } from "@/lib/review";
import { ChecklistPanel } from "./ChecklistPanel";
import { ReviewPanel } from "./ReviewPanel";
import { useReviewed } from "./useReviewed";
import { DeletedPanel } from "./DeletedPanel";
import { DuplicatesPanel } from "./DuplicatesPanel";
import { GlobeCanvas } from "./globe/GlobeCanvas";
import { DownloadIcon, MoreIcon, PauseIcon, PlayIcon } from "./icons";
import { MemoryEditor, type EditorTarget } from "./MemoryEditor";
import { MemoryPanel } from "./MemoryPanel";
import { ProjectList } from "./ProjectList";
import { SpaceSwitch } from "./SpaceSwitch";
import { TeamPanel } from "./TeamPanel";
import { useMembers } from "./useMembers";
import { useAllMemories } from "./useAllMemories";
import { useLastVisit } from "./useLastVisit";
import { usePresence, useTrailing } from "./useMotion";
import { Button, CategoryChip, CountUp, ErrorText, LeavingContext, Skeleton } from "./ui";

type Panel =
  | { kind: "projects" }
  | { kind: "project"; project: string }
  | { kind: "all" }
  | { kind: "category"; category: string }
  | { kind: "new" }
  | { kind: "duplicates" }
  | { kind: "deleted" }
  | { kind: "team" }
  | { kind: "checklist" }
  | { kind: "review" }
  | null;

export function GlobeView({
  user,
  space,
  spaces,
  onSpace,
  onSpacesChanged,
  onRenamed,
  hiddenIds,
  onDelete,
  onSaved,
}: {
  user: SessionUser;
  space: Space;
  spaces: readonly Space[];
  onSpace: (id: string) => void;
  /** Refetch the spaces and show `prefer`, or personal when it is gone. */
  onSpacesChanged: (prefer?: string) => Promise<void>;
  onRenamed: (space: Space) => void;
  /** Deleted or about to be, see lib/delete-queue.ts. */
  hiddenIds: ReadonlySet<string>;
  /** Hands the rows to the undo queue. Nothing is sent to the server yet. */
  onDelete: (memories: readonly Memory[], label?: string) => void;
  /** A save came back; if its id was waiting to be deleted, it must not be. */
  onSaved: (ids: readonly string[]) => void;
}) {
  const data = useAllMemories(user.id, space.id);
  const members = useMembers(space, user.id);
  // Rows waiting for their Undo window, or already deleted, are gone from
  // every view at once: globe, totals, lists, duplicates and export.
  const memories = useMemo(
    () => (hiddenIds.size ? data.memories.filter((m) => !hiddenIds.has(m.id)) : data.memories),
    [data.memories, hiddenIds],
  );

  // FORBIDDEN on a space we were showing means someone removed us from it.
  // Ask for the spaces again once; if it is gone, the page falls back to
  // personal and says why. Once per space, so a server that disagrees with
  // itself cannot loop.
  const recheck = useRef(false);
  useEffect(() => {
    if (data.error?.code !== "FORBIDDEN" || recheck.current) return;
    recheck.current = true;
    void onSpacesChanged(space.id);
  }, [data.error, onSpacesChanged, space.id]);
  const since = useLastVisit(user.id, space.id);
  const name = spaceLabel(space);

  const [panel, setPanel] = useState<Panel>(null);
  // A panel that closes slides out: its last kind is kept for the length of the
  // animation. The globe follows `panel` at once; only the panel uses `view`.
  const closedPanel = useTrailing(panel, LEAVE_MS.panel);
  const view: Panel = panel ?? closedPanel;
  const panelLeaving = panel === null && closedPanel !== null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightCategory, setHighlightCategory] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoverProject, setHoverProject] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  // Every opening is a fresh form, also one that starts while the last closes.
  const [editorSeq, setEditorSeq] = useState(0);
  const closedEditor = useTrailing(editor, LEAVE_MS.modal);
  const editorView = editor ?? closedEditor;
  const openEditor = (target: EditorTarget) => {
    setEditor(target);
    setEditorSeq((n) => n + 1);
  };
  // What was just saved flashes once where it lands, in the list and on the
  // globe: a save or a restore lands there with a ring, a checklist tick rings.
  // `n` replays it for a second save of the same row.
  const [flash, setFlash] = useState<{ id: string; n: number; kind: "land" | "ring" } | null>(null);
  const flashRow = (id: string, kind: "land" | "ring" = "land") =>
    setFlash((f) => ({ id, n: (f?.n ?? 0) + 1, kind }));
  // The row under the pointer in a panel, for the line to its dot. A ref: the
  // globe reads it every frame, so hovering down a list re-renders nothing.
  const linkRef = useRef<{ id: string; y: number } | null>(null);
  const hoverRow = useCallback((id: string | null, y = 0) => {
    linkRef.current = id ? { id, y } : null;
  }, []);
  useEffect(() => {
    linkRef.current = null;
  }, [panel]);
  const [paused, setPaused] = usePausedSpin();
  const [drafts, setDrafts] = useDrafts(user.id, space.id);
  const [reviewed, markReviewed] = useReviewed(user.id, space.id);
  // Captured when the data changes, not on every render, so "new" is stable
  // for the life of a fetch and render stays pure.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setTimeout(() => setNow(new Date()), 0);
    return () => window.clearTimeout(id);
  }, [data.fetchedAt]);

  const layout = useMemo(() => buildLayout(memories), [memories]);
  const totals = useMemo(() => summarise(memories, data.complete), [memories, data.complete]);
  const byId = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);
  const newIds = useMemo(
    () => new Set(memories.filter((m) => isNew(m, now)).map((m) => m.id)),
    [memories, now],
  );
  const changedCount = useMemo(
    () => memories.filter((m) => !newIds.has(m.id) && changedSince(m, since)).length,
    [memories, newIds, since],
  );
  const duplicates = useMemo(() => findDuplicates(memories), [memories]);
  const checklist = useMemo(() => buildChecklist(memories, now), [memories, now]);
  // null: the server does not send `source` on list rows yet, so there is no inbox.
  const review = useMemo(
    () => (sourceKnown(memories) ? toReview(memories, reviewed) : null),
    [memories, reviewed],
  );
  const overdueIds = useMemo(() => new Set(checklist.overdue.map((i) => i.memory.id)), [checklist]);
  const doneIds = useMemo(() => new Set(checklist.done.map((i) => i.memory.id)), [checklist]);

  // A draft becomes real the moment a memory carries its name.
  const liveDrafts = useMemo(
    () => drafts.filter((d) => !totals.projects_.some((p) => p.project === d)),
    [drafts, totals.projects_],
  );
  // Empty drafts count too: creating "Hej" with no memories is still 1 project.
  const projectCount = countProjects(totals.projects, liveDrafts.length);

  // Derived, not stored. A project that disappears (renamed, emptied by a delete)
  // must not leave the globe zoomed into nothing.
  const focusProject =
    panel?.kind === "project" && layout.clusters.some((c) => c.project === panel.project)
      ? panel.project
      : null;

  const highlightIds = useMemo<ReadonlySet<string> | null>(() => {
    if (hoverProject && !focusProject) {
      return new Set(memories.filter((m) => m.project === hoverProject).map((m) => m.id));
    }
    if (panel?.kind === "new") {
      return new Set(memories.filter((m) => newIds.has(m.id) || changedSince(m, since)).map((m) => m.id));
    }
    if (panel?.kind === "duplicates") {
      return new Set(duplicates.flatMap((p) => [p.a.id, p.b.id]));
    }
    if (panel?.kind === "checklist") {
      return new Set(
        [...checklist.overdue, ...checklist.upcoming, ...checklist.undated].map((i) => i.memory.id),
      );
    }
    if (panel?.kind === "review" && review) {
      return new Set(review.map((m) => m.id));
    }
    return null;
  }, [hoverProject, focusProject, panel, memories, newIds, since, duplicates, checklist, review]);

  const categoryLit = panel?.kind === "category" ? panel.category : highlightCategory;

  // Panel-driven only. Recomputed when the panel changes, not on every refetch.
  const flyKey = panel?.kind === "category" ? `c:${panel.category}` : panel?.kind ?? "";
  const flyToIds = useMemo<ReadonlySet<string> | null>(() => {
    // A category no longer turns the globe: its dots are gathered in front instead.
    if (panel?.kind === "new" || panel?.kind === "duplicates" || panel?.kind === "review") return highlightIds;
    // Turn towards what is overdue, or else what is coming up.
    if (panel?.kind === "checklist") {
      const first = checklist.overdue.length ? checklist.overdue : checklist.upcoming;
      return first.length ? new Set(first.map((i) => i.memory.id)) : null;
    }
    return null;
    // Keyed on the panel so a 15 second refresh does not turn the globe again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || editor) return;
      if (selectedId) setSelectedId(null);
      else if (panel?.kind === "project") setPanel({ kind: "projects" });
      else setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, selectedId, panel]);

  const hovered = hover ? byId.get(hover.id) ?? null : null;

  const panelMemories = useMemo(() => {
    switch (view?.kind) {
      case "project":
        return memories.filter((m) => m.project === view.project);
      case "all":
        // Memories tab: only free-standing rows. Project memories live under Projects.
        return memories.filter((m) => !m.project.trim());
      case "category":
        return memories.filter((m) => m.category === view.category);
      case "new":
        return memories
          .filter((m) => newIds.has(m.id) || changedSince(m, since))
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      default:
        return [];
    }
  }, [view, memories, newIds, since]);

  function openProject(project: string) {
    setPanel({ kind: "project", project });
    setSelectedId(null);
    setHoverProject(null);
  }

  function afterSave(memory: Memory) {
    // The server reuses the id of an existing subject, so a new save can land
    // on a row that is waiting to be deleted. Keep it.
    onSaved([memory.id]);
    // What the reader wrote or fixed themselves needs no review.
    markReviewed([memory]);
    data.apply((rows) => {
      const existing = rows.findIndex((r) => r.id === memory.id);
      const row = keepSource(memory, existing === -1 ? undefined : rows[existing], sourceKnown(rows));
      if (existing === -1) return [row, ...rows];
      const next = rows.slice();
      next[existing] = row;
      return next;
    });
    setEditor(null);
    flashRow(memory.id);
    // A fix made from the review inbox stays there, so the next one is at hand.
    if (panel?.kind !== "review") {
      // A free-standing memory (empty project) lives under Memories, not in
      // a project panel with an empty name.
      setPanel(memory.project.trim() ? { kind: "project", project: memory.project } : { kind: "all" });
      setSelectedId(memory.id);
    }
    data.refresh();
  }

  /** A deleted memory was saved again from the Deleted panel: show it now, stay in the panel. */
  function afterRestore(memory: Memory) {
    flashRow(memory.id);
    onSaved([memory.id]);
    markReviewed([memory]);
    data.apply((rows) => {
      const existing = rows.findIndex((r) => r.id === memory.id);
      const row = keepSource(memory, existing === -1 ? undefined : rows[existing], sourceKnown(rows));
      if (existing === -1) return [row, ...rows];
      const next = rows.slice();
      next[existing] = row;
      return next;
    });
    data.refresh();
  }

  /** A checklist toggle came back from the server: show it now, then refresh. */
  function afterUpdate(memory: Memory) {
    flashRow(memory.id, "ring");
    markReviewed([memory]);
    data.apply((rows) => {
      const known = sourceKnown(rows);
      return rows.map((r) => (r.id === memory.id ? keepSource(memory, r, known) : r));
    });
    data.refresh();
  }

  /** Personal → Team: drop the Personal row, open the team, show Memories. */
  function afterMovedToTeam(fromId: string, teamId: string, created: Memory) {
    data.apply((rows) => rows.filter((r) => r.id !== fromId));
    if (selectedId === fromId) setSelectedId(null);
    onSaved([created.id]);
    // Land in Memories (free-standing), not under a project that only existed in Personal.
    setPanel({ kind: "all" });
    setSelectedId(created.id);
    onSpace(teamId);
  }

  function remove(rows: readonly Memory[], label?: string) {
    onDelete(rows, label);
    if (selectedId && rows.some((m) => m.id === selectedId)) setSelectedId(null);
  }

  function download(kind: "json" | "md") {
    const meta = { space: name, exportedAt: new Date().toISOString() };
    const body = kind === "json" ? exportJson(memories, meta) : exportMarkdown(memories, meta);
    const blob = new Blob([body], { type: kind === "json" ? "application/json" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(name, new Date(), kind);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const panelProject = view?.kind === "project" ? view.project : undefined;
  const freeStandingCount = useMemo(
    () => memories.filter((m) => !m.project.trim()).length,
    [memories],
  );
  const panelHeading =
    view?.kind === "all"
      ? `Memories (${freeStandingCount})`
      : view?.kind === "category"
        ? `${labelFor(view.category)} (${panelMemories.length})`
        : view?.kind === "new"
          ? "What's new"
          : panelProject ?? "";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col sm:flex-row">
      <section className="relative min-h-0 flex-1 overflow-hidden">
        {data.first ? (
          <div className="absolute inset-0 grid place-items-center">
            <Skeleton className="size-64 rounded-full" />
          </div>
        ) : (
          <div className="fade-in-slow absolute inset-0">
            <GlobeCanvas
              points={layout.points}
              clusters={layout.clusters}
              focusProject={focusProject}
              selectedId={selectedId}
              highlightCategory={categoryLit}
              highlightIds={highlightIds}
              newIds={newIds}
              paused={paused}
              flyToIds={flyToIds}
              gatherCategory={panel?.kind === "category" ? panel.category : null}
              ping={flash}
              linkRef={linkRef}
              onPickProject={openProject}
              onPickMemory={(id) => {
                setSelectedId(id);
                // Clicked inside a gathered category: stay in that list.
                if (panel?.kind === "category") return;
                const memory = byId.get(id);
                if (memory) setPanel({ kind: "project", project: memory.project });
              }}
              onHover={setHover}
            />
          </div>
        )}

        {/* Top: space, where you are, totals. Right: the panels and tools. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-6">
          <div className="pointer-events-auto min-w-0">
            <SpaceSwitch
              spaces={spaces}
              active={space}
              userId={user.id}
              teams={members.supported === true}
              teamOpen={panel?.kind === "team"}
              onChange={onSpace}
              onCreated={(created) => void onSpacesChanged(created.id)}
              onTeam={() => setPanel(panel?.kind === "team" ? null : { kind: "team" })}
            />

            <nav className="mt-3 flex items-center gap-1 text-sm" aria-label="Breadcrumb">
              <button
                type="button"
                onClick={() => {
                  setPanel(null);
                  setSelectedId(null);
                }}
                className={`press py-0.5 ${focusProject ? "text-ink-2 hover:text-ink" : "font-medium text-ink"}`}
              >
                All memories
              </button>
              {focusProject ? (
                <span key={focusProject} className="rise inline-flex min-w-0 items-center">
                  <span aria-hidden className="px-1 text-ink-3">
                    /
                  </span>
                  <span className="max-w-[12rem] truncate font-medium">{focusProject}</span>
                </span>
              ) : null}
            </nav>

            <p className="tnum mt-0.5 text-xs text-ink-3">
              <CountUp value={totals.memories} /> {totals.memories === 1 ? "memory" : "memories"} ·{" "}
              <CountUp value={projectCount} /> {projectCount === 1 ? "project" : "projects"}
              {totals.newest ? ` · newest ${formatAge(totals.newest)}` : ""}
              {data.loading && !data.first ? <span className="fade-in"> · refreshing</span> : null}
            </p>

            {newIds.size + changedCount > 0 ? (
              <button
                type="button"
                onClick={() => setPanel(panel?.kind === "new" ? null : { kind: "new" })}
                className="fade-in press mt-2 text-xs text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
              >
                {newIds.size > 0 ? `${newIds.size} new today` : ""}
                {newIds.size > 0 && changedCount > 0 ? " · " : ""}
                {changedCount > 0 ? `${changedCount} changed since your last visit` : ""}
              </button>
            ) : null}

            {review && review.length > 0 ? (
              <button
                type="button"
                onClick={() => setPanel(panel?.kind === "review" ? null : { kind: "review" })}
                className="fade-in press mt-1 block text-xs text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
              >
                {review.length} saved by the AI to review
              </button>
            ) : null}

            {checklist.overdue.length > 0 ? (
              <button
                type="button"
                onClick={() => setPanel(panel?.kind === "checklist" ? null : { kind: "checklist" })}
                className="fade-in press mt-1 block text-xs font-medium text-danger underline decoration-danger/40 underline-offset-4 transition-colors hover:decoration-danger"
              >
                {checklist.overdue.length} overdue {checklist.overdue.length === 1 ? "deadline" : "deadlines"}
              </button>
            ) : null}

            {!totals.complete ? (
              <p className="mt-1 max-w-sm text-xs text-danger">
                Showing the first {totals.memories} rows. The API returns 50 per request and has no
                count, so these totals describe what was loaded, not the whole space.
              </p>
            ) : null}
          </div>

          <div className="pointer-events-auto flex items-center gap-0.5">
            <Button
              variant="quiet"
              className="whitespace-nowrap px-2.5 max-sm:px-1.5"
              aria-pressed={panel?.kind === "projects"}
              onClick={() => setPanel(panel?.kind === "projects" ? null : { kind: "projects" })}
            >
              <span className="u-line" data-on={panel?.kind === "projects"}>
                Projects (<CountUp value={projectCount} />)
              </span>
            </Button>
            <Button
              variant="quiet"
              className="whitespace-nowrap px-2.5 max-sm:px-1.5"
              aria-pressed={panel?.kind === "all"}
              onClick={() => setPanel(panel?.kind === "all" ? null : { kind: "all" })}
            >
              <span className="u-line" data-on={panel?.kind === "all"}>
                Memories
              </span>
            </Button>
            <Button
              variant="quiet"
              className="whitespace-nowrap px-2.5 max-sm:px-1.5"
              aria-pressed={panel?.kind === "checklist"}
              onClick={() => setPanel(panel?.kind === "checklist" ? null : { kind: "checklist" })}
            >
              <span className="u-line" data-on={panel?.kind === "checklist"}>
                Checklist
              </span>
            </Button>
            <Button
              variant="quiet"
              className="whitespace-nowrap px-2.5 max-sm:px-1.5"
              aria-pressed={panel?.kind === "deleted"}
              onClick={() => setPanel(panel?.kind === "deleted" ? null : { kind: "deleted" })}
            >
              <span className="u-line" data-on={panel?.kind === "deleted"}>
                Deleted
              </span>
            </Button>
            <ToolsMenu
              duplicates={duplicates.length}
              empty={memories.length === 0}
              onDuplicates={() => setPanel({ kind: "duplicates" })}
              onExport={download}
              onNew={() => openEditor({ mode: "create" })}
            />
          </div>
        </div>

        {/* The legend. Always all six, zeros included: a colour that vanishes when
            its count hits zero teaches the wrong thing about what exists.
            Alfredo's point 1: a click lists that category in the panel. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 sm:p-6">
          <div className="pointer-events-auto min-w-0 flex-1">
            <div className="no-scrollbar -mx-1.5 flex items-center gap-1 overflow-x-auto sm:flex-wrap">
              {totals.byCategory.map((row) => {
                const active = panel?.kind === "category" && panel.category === row.category;
                return (
                  <CategoryChip
                    key={row.category}
                    category={row.category}
                    count={row.count}
                    active={active}
                    onClick={() => {
                      setHighlightCategory(null);
                      setSelectedId(null);
                      setPanel(active ? null : { kind: "category", category: row.category });
                    }}
                  />
                );
              })}
            </div>
            <p className="mt-1 hidden max-w-xl text-xs text-ink-3 sm:block">
              One dot is one memory. Position is the project, colour is the category. A ring means new
              today. Click a colour to gather it.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setPaused(!paused)}
            aria-pressed={paused}
            aria-label={paused ? "Resume rotation" : "Pause rotation"}
            title={paused ? "Resume rotation" : "Pause rotation"}
            className="press pointer-events-auto grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-sm hover:text-ink"
          >
            <span key={paused ? "play" : "pause"} className="swap grid place-items-center">
              {paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
            </span>
          </button>
        </div>

        {hovered && hover ? (
          <div
            key={hovered.id}
            className="pop-in pointer-events-none absolute z-20 max-w-64 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs shadow-lg"
            style={{ left: Math.max(8, hover.x + 14), top: Math.max(8, hover.y - 8) }}
          >
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: categoryVar(hovered.category) }} />
              <span className="truncate">{hovered.title}</span>
            </span>
            <span className="mt-0.5 block text-ink-3">
              {labelFor(hovered.category)} · {hovered.project}
              {newIds.has(hovered.id) ? " · new today" : ""}
            </span>
          </div>
        ) : null}

        {data.error ? (
          <div className="absolute inset-x-0 top-40 mx-auto w-fit max-w-[90%]">
            <ErrorText code={data.error.code} message={data.error.message} />
          </div>
        ) : null}
      </section>

      <LeavingContext.Provider value={panelLeaving}>
      {view?.kind === "projects" ? (
        <ProjectList
          totals={totals}
          drafts={liveDrafts}
          spaceName={name}
          onPick={openProject}
          onHover={setHoverProject}
          onClose={() => {
            setPanel(null);
            setHoverProject(null);
          }}
          onCreateProject={(project) => {
            if (!totals.projects_.some((p) => p.project === project) && !drafts.includes(project)) {
              setDrafts([...drafts, project]);
            }
            openProject(project);
          }}
          onDeleteDraft={(project) => {
            setDrafts(drafts.filter((d) => d !== project));
            if (panel?.kind === "project" && panel.project === project) {
              setPanel({ kind: "projects" });
            }
          }}
          onDeleteProject={(project) => {
            // Soft-delete every memory in the project via the undo queue → Deleted.
            const rows = memories.filter((m) => m.project === project);
            if (rows.length > 0) {
              const n = rows.length;
              remove(
                rows,
                `Project "${project}" (${n} ${n === 1 ? "memory" : "memories"})`,
              );
            }
            setDrafts(drafts.filter((d) => d !== project));
            setPanel({ kind: "projects" });
            setHoverProject(null);
          }}
        />
      ) : null}

      {view?.kind === "duplicates" ? (
        <DuplicatesPanel
          pairs={duplicates}
          spaceName={name}
          onOpen={(memory) => {
            setPanel({ kind: "project", project: memory.project });
            setSelectedId(memory.id);
          }}
          onEdit={(memory) => openEditor({ mode: "edit", memory })}
          onDelete={remove}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {view?.kind === "deleted" ? (
        <DeletedPanel
          spaceId={space.id}
          spaceKind={space.kind}
          spaceName={name}
          userId={user.id}
          people={members.people}
          memories={memories}
          onRestored={afterRestore}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {view?.kind === "review" && review ? (
        <ReviewPanel
          memories={review}
          spaceName={name}
          onKeep={markReviewed}
          onEdit={(memory) => openEditor({ mode: "edit", memory })}
          onDelete={remove}
          onOpen={(memory) => {
            setPanel({ kind: "project", project: memory.project });
            setSelectedId(memory.id);
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {view?.kind === "checklist" ? (
        <ChecklistPanel
          checklist={checklist}
          now={now}
          userId={user.id}
          spaceId={space.id}
          spaceName={name}
          onOpen={(memory) => {
            setPanel({ kind: "project", project: memory.project });
            setSelectedId(memory.id);
          }}
          onUpdated={afterUpdate}
          flash={flash}
          onRowHover={hoverRow}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {view?.kind === "team" ? (
        <TeamPanel
          space={space}
          userId={user.id}
          members={members}
          onRenamed={onRenamed}
          onLeft={() => void onSpacesChanged()}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {view &&
      view.kind !== "projects" &&
      view.kind !== "duplicates" &&
      view.kind !== "deleted" &&
      view.kind !== "team" &&
      view.kind !== "checklist" &&
      view.kind !== "review" ? (
        <MemoryPanel
          key={view.kind === "project" ? `p:${view.project}` : view.kind === "category" ? `c:${view.category}` : view.kind}
          heading={panelHeading}
          subheading={
            view.kind === "all"
              ? `${projectCount} projects`
              : view.kind === "new"
                ? "new today or changed since your last visit"
                : name
          }
          memories={panelMemories}
          selectedId={selectedId}
          userId={user.id}
          spaceKind={space.kind}
          people={members.people}
          newIds={newIds}
          overdueIds={overdueIds}
          doneIds={doneIds}
          since={since}
          emptyText={
            view.kind === "project" && liveDrafts.includes(view.project)
              ? "Empty project. Its first memory saves it on the server."
              : view.kind === "category"
                ? `No ${labelFor(view.category).toLowerCase()} memories in ${name} yet.`
                : undefined
          }
          flash={flash}
          onRowHover={hoverRow}
          onSelect={setSelectedId}
          onEdit={(memory) => openEditor({ mode: "edit", memory })}
          onCreate={
            view.kind === "new"
              ? undefined
              : () =>
                  openEditor({
                    mode: "create",
                    project: view.kind === "project" ? view.project : undefined,
                  })
          }
          onDelete={remove}
          knownProjects={[...totals.projects_.map((p) => p.project), ...liveDrafts]}
          // Shared spaces only; MemoryPanel shows them solely from Personal.
          teamSpaces={spaces.filter((s) => s.kind === "shared")}
          onMoved={afterUpdate}
          onMovedToTeam={afterMovedToTeam}
          onClose={() => {
            setPanel(view.kind === "project" ? { kind: "projects" } : null);
            setSelectedId(null);
          }}
        />
      ) : null}
      </LeavingContext.Provider>

      {editorView ? (
        <MemoryEditor
          key={editorSeq}
          target={editorView}
          leaving={editor === null}
          knownProjects={[...totals.projects_.map((p) => p.project), ...liveDrafts]}
          // Titles already used in the project the editor will save into.
          knownTitles={memories
            .filter((m) => {
              const project =
                editorView.mode === "edit"
                  ? editorView.memory.project
                  : (editorView.project ?? "");
              return m.project === project && (editorView.mode !== "edit" || m.id !== editorView.memory.id);
            })
            .map((m) => m.title)}
          userId={user.id}
          spaceId={space.id}
          spaceName={name}
          onClose={() => setEditor(null)}
          onSaved={afterSave}
        />
      ) : null}
    </div>
  );
}

function ToolsMenu({
  duplicates,
  empty,
  onDuplicates,
  onExport,
  onNew,
}: {
  duplicates: number;
  empty: boolean;
  onDuplicates: () => void;
  onExport: (kind: "json" | "md") => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = usePresence(open, LEAVE_MS.menu);
  const box = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  const item =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-3 disabled:opacity-45";

  return (
    <div
      ref={box}
      className="relative"
      onKeyDown={(event) => {
        // Closes only the menu, not the panel behind it.
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        close();
      }}
    >
      <Button
        variant="quiet"
        className="px-2 max-sm:px-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon />
      </Button>
      {menu.mounted ? (
        <div
          role="menu"
          inert={menu.leaving || undefined}
          className={`${menu.leaving ? "menu-out" : "menu-in"} absolute right-0 top-9 z-40 w-60 origin-top-right rounded-xl border border-line bg-surface p-1.5 shadow-xl`}
        >
          <button type="button" role="menuitem" className={item} onClick={() => (close(), onNew())}>
            New memory
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => (close(), onDuplicates())}
          >
            Find duplicates
            <span className="tnum ml-auto text-xs text-ink-3">{duplicates}</span>
          </button>
          <div className="my-1 border-t border-line" />
          <button type="button" role="menuitem" className={item} disabled={empty} onClick={() => (close(), onExport("md"))}>
            <DownloadIcon className="size-3.5" /> Export as Markdown
          </button>
          <button type="button" role="menuitem" className={item} disabled={empty} onClick={() => (close(), onExport("json"))}>
            <DownloadIcon className="size-3.5" /> Export as JSON
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Empty projects, per space and per tab, until their first memory saves them. */
function useDrafts(userId: string, spaceId: string): [string[], (next: string[]) => void] {
  const key = `bc-drafts:${userId}:${spaceId}`;
  const [drafts, setState] = useState<string[]>([]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        setState(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
      } catch {
        setState([]);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [key]);

  const set = useCallback(
    (next: string[]) => {
      setState(next);
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode: drafts last until reload */
      }
    },
    [key],
  );

  return [drafts, set];
}

/**
 * The spin's pause, remembered in this browser. It is the one way to stop the
 * globe (it no longer stops for reduced motion), so it should not have to be
 * pressed again on every visit.
 */
function usePausedSpin(): [boolean, (next: boolean) => void] {
  const [paused, setState] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        setState(localStorage.getItem("bc-globe-paused") === "1");
      } catch {
        /* storage blocked: spinning is the default */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const set = useCallback((next: boolean) => {
    setState(next);
    try {
      if (next) localStorage.setItem("bc-globe-paused", "1");
      else localStorage.removeItem("bc-globe-paused");
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
  }, []);

  return [paused, set];
}
