"use client";

/**
 * Projects in the active space.
 *
 * Melker's points 1 and 3. A search field like the one on memories, and "New
 * project" that asks for a name and nothing else. v1.1 opened the memory editor,
 * so making a project meant inventing a first memory and a category for it.
 *
 * A project is only the text in memories.project; there is no projects table.
 * So a project with no memories cannot be stored on the server. It is kept here
 * as a draft for this tab, shown dashed, until its first memory is saved and it
 * becomes real. The server's name matching applies to that first save.
 *
 * Delete removes every memory in the project (they land in Deleted / trash for
 * 30 days). Empty drafts are only removed locally.
 */

import { useMemo, useState } from "react";
import { countProjects, type summarise } from "@/lib/aggregate";
import { CATEGORY_LABEL, DISPLAY_ORDER, categoryVar } from "@/lib/categories";
import { formatAge } from "@/lib/format";
import { projectMatch } from "@/lib/insights";
import { LEAVE_MS } from "@/lib/motion";
import type { Category } from "@/lib/types";
import { Button, Collapsible, ConfirmButton, PanelShell, Row, inputClass } from "./ui";
import { SearchIcon } from "./icons";
import { usePresenceList } from "./useMotion";

export function ProjectList({
  totals,
  drafts,
  spaceName,
  onPick,
  onHover,
  onClose,
  onCreateProject,
  onDeleteProject,
  onDeleteDraft,
}: {
  totals: ReturnType<typeof summarise>;
  drafts: readonly string[];
  spaceName: string;
  onPick: (project: string) => void;
  onHover: (project: string | null) => void;
  onClose: () => void;
  onCreateProject: (name: string) => void;
  /** Delete a real project: all its memories go to Deleted (trash). */
  onDeleteProject: (project: string) => void;
  /** Remove an empty draft project (local only, nothing on the server). */
  onDeleteDraft: (project: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const needle = query.trim().toLowerCase();
  const projects = useMemo(
    () => totals.projects_.filter((p) => !needle || p.project.toLowerCase().includes(needle)),
    [totals.projects_, needle],
  );
  const visibleDrafts = drafts.filter((d) => !needle || d.toLowerCase().includes(needle));
  // Searching closes the rows that stop matching instead of cutting them out.
  const shownProjects = usePresenceList(projects, (p) => p.project, LEAVE_MS.row);
  const existingNames = [...totals.projects_.map((p) => p.project), ...drafts];
  const clash = projectMatch(name, existingNames);
  const exact = existingNames.includes(name.trim());

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) return;
    onCreateProject(clash ?? trimmed);
    setName("");
    setNaming(false);
  }

  // Same rule as the tab badge: empty drafts count as projects.
  const projectCount = countProjects(totals.projects, drafts.length);

  return (
    <PanelShell
      label="Projects"
      title={`Projects (${projectCount})`}
      subtitle={`${spaceName} · ${totals.memories} ${totals.memories === 1 ? "memory" : "memories"}`}
      onClose={onClose}
      actions={
        <Button variant="quiet" className="px-2" onClick={() => setNaming((v) => !v)} aria-expanded={naming}>
          <span className="u-line" data-on={naming}>
            New project
          </span>
        </Button>
      }
    >
      <Collapsible open={naming}>
        <form onSubmit={submit} className="px-5 pb-3">
          <label className="flex flex-col gap-1 text-sm">
            Project name
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              autoFocus
              placeholder="Mässa oktober"
            />
          </label>
          {clash ? (
            <p key="clash" className="fade-in mt-1.5 text-xs text-ink-2">
              That is the same project as <strong>{clash}</strong>. The server ignores case, spaces and
              hyphens, so it will open that one.
            </p>
          ) : exact ? (
            <p key="exact" className="fade-in mt-1.5 text-xs text-ink-2">That project already exists. It will open.</p>
          ) : (
            <p key="new" className="fade-in mt-1.5 text-xs text-ink-3">
              Just a name. It is saved on the server with its first memory.
            </p>
          )}
          <div className="mt-2 flex justify-end gap-1.5">
            <Button type="button" variant="quiet" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {clash || exact ? "Open" : "Create"}
            </Button>
          </div>
        </form>
      </Collapsible>

      {totals.projects + drafts.length > 0 ? (
        <div className="relative px-5 pb-2">
          <SearchIcon className="pointer-events-none absolute left-8 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            className={`${inputClass} pl-8`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
          />
        </div>
      ) : null}

      {shownProjects.length === 0 && visibleDrafts.length === 0 ? (
        <p className="fade-in px-5 py-10 text-center text-sm text-ink-3">
          {needle
            ? "No project matches that search."
            : "No memories yet. Ask a connected model to remember something, or add one here."}
        </p>
      ) : (
        <ul className="pb-4" onMouseLeave={() => onHover(null)}>
          {visibleDrafts.map((draft, index) => (
            <Row key={`draft:${draft}`} index={index}>
              <div className="flex items-center gap-1 px-2 py-1 hover:bg-surface-2">
                <button
                  type="button"
                  onClick={() => onPick(draft)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left transition-colors active:bg-surface-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{draft}</span>
                    <span className="mt-0.5 block text-xs text-ink-3">Empty · add its first memory</span>
                  </span>
                  <span aria-hidden className="size-2 rounded-full border border-dashed border-ink-3" />
                </button>
                <ConfirmButton
                  idleLabel="Delete"
                  confirmLabel="Remove draft"
                  onConfirm={() => onDeleteDraft(draft)}
                />
              </div>
            </Row>
          ))}
          {shownProjects.map(({ item: project, leaving }, index) => (
            <Row key={project.project} leaving={leaving} index={index + visibleDrafts.length}>
              <div
                className="flex items-center gap-1 px-2 py-1 hover:bg-surface-2"
                onMouseEnter={() => onHover(project.project)}
                onMouseLeave={() => onHover(null)}
              >
                <button
                  type="button"
                  onClick={() => onPick(project.project)}
                  onFocus={() => onHover(project.project)}
                  onBlur={() => onHover(null)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left transition-colors active:bg-surface-3"
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
                {/* Deletes every memory in the project into Deleted (30-day trash). */}
                <ConfirmButton
                  idleLabel="Delete"
                  confirmLabel={`Delete ${project.count}`}
                  onConfirm={() => onDeleteProject(project.project)}
                />
              </div>
            </Row>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
