"use client";

/**
 * The map of memories, and the whole of the dashboard's main view.
 *
 * Position is project, colour is category. Clicking goes down one level at a
 * time: the whole sphere to a project, a project to a single memory. The panel on
 * the right is the same information as text, always reachable, so nothing here
 * depends on being able to see or click a coloured dot.
 */

import { useEffect, useMemo, useState } from "react";
import { summarise } from "@/lib/aggregate";
import { CATEGORY_LABEL, DISPLAY_ORDER, categoryVar, labelFor } from "@/lib/categories";
import { buildLayout } from "@/lib/globe/sphere";
import { formatAge } from "@/lib/format";
import type { Category, Memory, SessionUser } from "@/lib/types";
import { GlobeCanvas } from "./globe/GlobeCanvas";
import { MemoryEditor, type EditorTarget } from "./MemoryEditor";
import { MemoryPanel } from "./MemoryPanel";
import { useAllMemories } from "./useAllMemories";
import { Button, CategoryChip, ErrorText, Skeleton } from "./ui";

type Panel = { kind: "projects" } | { kind: "project"; project: string } | { kind: "all" } | null;

export function GlobeView({ user }: { user: SessionUser }) {
  const data = useAllMemories(user.id);
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightCategory, setHighlightCategory] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  const layout = useMemo(() => buildLayout(data.memories), [data.memories]);
  const totals = useMemo(() => summarise(data.memories, data.complete), [data.memories, data.complete]);
  const byId = useMemo(() => new Map(data.memories.map((m) => [m.id, m])), [data.memories]);

  // Derived, not stored. A project that disappears (renamed, emptied by a delete)
  // must not leave the globe zoomed into nothing, and deriving it means there is
  // no moment where the two disagree.
  const focusProject =
    panel?.kind === "project" && layout.clusters.some((c) => c.project === panel.project)
      ? panel.project
      : null;

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

  const panelMemories =
    panel?.kind === "project"
      ? data.memories.filter((m) => m.project === panel.project)
      : panel?.kind === "all"
        ? data.memories
        : [];

  function openProject(project: string) {
    setPanel({ kind: "project", project });
    setSelectedId(null);
  }

  function afterSave(memory: Memory) {
    data.apply((rows) => {
      const existing = rows.findIndex((r) => r.id === memory.id);
      if (existing === -1) return [memory, ...rows];
      const next = rows.slice();
      next[existing] = memory;
      return next;
    });
    setEditor(null);
    setPanel({ kind: "project", project: memory.project });
    setSelectedId(memory.id);
    data.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <section className="relative min-h-[22rem] flex-1 overflow-hidden">
        {data.first ? (
          <div className="absolute inset-0 grid place-items-center">
            <Skeleton className="size-64 rounded-full" />
          </div>
        ) : (
          <div className="absolute inset-0">
            <GlobeCanvas
              points={layout.points}
              clusters={layout.clusters}
              focusProject={focusProject}
              selectedId={selectedId}
              highlightCategory={highlightCategory}
              onPickProject={openProject}
              onPickMemory={(id) => {
                setSelectedId(id);
                const memory = byId.get(id);
                if (memory) setPanel({ kind: "project", project: memory.project });
              }}
              onHover={setHover}
            />
          </div>
        )}

        {/* Where you are. The only chrome over the sphere. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-4">
          <div className="pointer-events-auto">
          <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
            <button
              type="button"
              onClick={() => {
                setPanel(null);
                setSelectedId(null);
              }}
              className={`rounded-md px-2 py-1 transition-colors ${
                focusProject ? "text-ink-2 hover:bg-surface-2 hover:text-ink" : "font-medium text-ink"
              }`}
            >
              All memories
            </button>
            {focusProject ? (
              <>
                <span aria-hidden className="text-ink-3">
                  /
                </span>
                <span className="max-w-[12rem] truncate rounded-md px-2 py-1 font-medium">
                  {focusProject}
                </span>
              </>
            ) : null}
          </nav>

          <p className="tnum mt-0.5 px-2 text-xs text-ink-3">
            {totals.memories} {totals.memories === 1 ? "memory" : "memories"} · {totals.projects}{" "}
            {totals.projects === 1 ? "project" : "projects"}
            {totals.newest ? ` · newest ${formatAge(totals.newest)}` : ""}
            {data.loading && !data.first ? " · refreshing" : ""}
          </p>

          {!totals.complete ? (
            <p className="mt-1 max-w-sm px-2 text-xs text-danger">
              Showing the first {totals.memories} rows. The API returns 50 per request and has no
              count, so these totals describe what was loaded, not the whole account.
            </p>
          ) : null}
          </div>

          <div className="pointer-events-auto flex items-center gap-1">
            <Button
              variant="ghost"
              className="whitespace-nowrap"
              onClick={() => setPanel({ kind: "projects" })}
            >
              Projects {totals.projects}
            </Button>
            <Button
              variant="ghost"
              className="whitespace-nowrap"
              onClick={() => setPanel({ kind: "all" })}
            >
              List
            </Button>
          </div>
        </div>

        {/* The legend. Always all six, zeros included: a colour that vanishes when
            its count hits zero teaches the wrong thing about what exists. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
            {totals.byCategory.map((row) => (
              <CategoryChip
                key={row.category}
                category={row.category}
                count={row.count}
                active={highlightCategory === row.category}
                onClick={() =>
                  setHighlightCategory(highlightCategory === row.category ? null : row.category)
                }
              />
            ))}
            {highlightCategory ? (
              <Button variant="quiet" onClick={() => setHighlightCategory(null)}>
                Show all
              </Button>
            ) : null}
          </div>

          <p className="max-w-xl text-xs text-ink-3">
            One dot is one memory. Position is the project, colour is the category.
          </p>
        </div>

        {hovered && hover ? (
          <div
            className="pointer-events-none absolute z-20 max-w-64 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs shadow-lg"
            style={{
              left: Math.max(8, hover.x + 14),
              top: Math.max(8, hover.y - 8),
            }}
          >
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: categoryVar(hovered.category) }}
              />
              <span className="truncate">{hovered.title}</span>
            </span>
            <span className="mt-0.5 block text-ink-3">
              {labelFor(hovered.category)} · {hovered.project}
            </span>
          </div>
        ) : null}

        {data.error ? (
          <div className="absolute inset-x-0 top-16 mx-auto w-fit max-w-[90%]">
            <ErrorText code={data.error.code} message={data.error.message} />
          </div>
        ) : null}
      </section>

      {panel?.kind === "projects" ? (
        <ProjectList
          totals={totals}
          onPick={openProject}
          onClose={() => setPanel(null)}
          onCreate={() => setEditor({ mode: "create" })}
        />
      ) : null}

      {panel?.kind === "project" || panel?.kind === "all" ? (
        <MemoryPanel
          heading={panel.kind === "all" ? "All memories" : panel.project}
          subheading={panel.kind === "all" ? `${totals.projects} projects` : undefined}
          memories={panelMemories}
          selectedId={selectedId}
          userId={user.id}
          onSelect={setSelectedId}
          onEdit={(memory) => setEditor({ mode: "edit", memory })}
          onCreate={() =>
            setEditor({
              mode: "create",
              project: panel.kind === "project" ? panel.project : undefined,
            })
          }
          onDeleted={(id) => {
            data.apply((rows) => rows.filter((r) => r.id !== id));
            if (selectedId === id) setSelectedId(null);
            data.refresh();
          }}
          onClose={() => {
            setPanel(panel.kind === "project" ? { kind: "projects" } : null);
            setSelectedId(null);
          }}
        />
      ) : null}

      {editor ? (
        <MemoryEditor
          target={editor}
          knownProjects={totals.projects_.map((p) => p.project)}
          userId={user.id}
          onClose={() => setEditor(null)}
          onSaved={afterSave}
        />
      ) : null}
    </div>
  );
}

function ProjectList({
  totals,
  onPick,
  onClose,
  onCreate,
}: {
  totals: ReturnType<typeof summarise>;
  onPick: (project: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <aside
      className="slide-in thin-scroll flex h-full w-full flex-col overflow-hidden border-line bg-surface sm:w-[26rem] sm:border-l"
      aria-label="Projects"
    >
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Projects</h2>
          <p className="tnum mt-0.5 text-xs text-ink-3">
            {totals.projects} {totals.projects === 1 ? "project" : "projects"} · {totals.memories}{" "}
            {totals.memories === 1 ? "memory" : "memories"}
          </p>
        </div>
        <Button variant="quiet" onClick={onCreate}>
          New
        </Button>
        <Button variant="quiet" onClick={onClose} aria-label="Close panel">
          Close
        </Button>
      </header>

      <div className="thin-scroll flex-1 overflow-y-auto">
        {totals.projects_.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-3">
            No memories yet. Ask a connected model to remember something, or add one here.
          </p>
        ) : (
          <ul>
            {totals.projects_.map((project) => (
              <li key={project.project} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => onPick(project.project)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.project}</span>
                    <span className="tnum mt-0.5 block text-xs text-ink-3">
                      {project.count} {project.count === 1 ? "memory" : "memories"} · updated{" "}
                      {formatAge(project.lastUpdated)}
                    </span>
                  </span>
                  <span aria-hidden className="flex shrink-0 gap-1">
                    {DISPLAY_ORDER.filter((category: Category) =>
                      project.byCategory.some((c) => c.category === category),
                    ).map((category: Category) => (
                      <span
                        key={category}
                        title={CATEGORY_LABEL[category]}
                        className="size-2 rounded-full"
                        style={{ background: categoryVar(category) }}
                      />
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
