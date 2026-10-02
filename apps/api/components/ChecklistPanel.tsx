"use client";

/**
 * Goals and deadlines, to check off.
 *
 * Checking one off writes a last line "Done: YYYY-MM-DD" into the memory
 * (lib/checklist.ts), through the normal PATCH. So the AI reads it as done,
 * everyone in a team sees it, and the history says who did it. Unchecking
 * removes the line. Overdue items come first: a deadline that has passed but
 * is not checked off is the one most likely to mislead a chat.
 */

import { useState } from "react";
import { searchMemories, updateMemory } from "@/lib/api";
import { categoryVar, labelFor } from "@/lib/categories";
import { dayKey, doneDate, markDone, reopen, type Checklist, type ChecklistItem } from "@/lib/checklist";
import { LEAVE_MS } from "@/lib/motion";
import { isApiError, type Memory } from "@/lib/types";
import { usePresenceList, type Presence } from "./useMotion";
import { Collapsible, ErrorText, PanelShell, Row } from "./ui";

function shortDate(date: Date, now: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function ChecklistPanel({
  checklist,
  now,
  userId,
  spaceId,
  spaceName,
  onOpen,
  onUpdated,
  flash,
  onRowHover,
  onClose,
}: {
  checklist: Checklist;
  now: Date;
  userId: string;
  spaceId: string;
  spaceName: string;
  onOpen: (memory: Memory) => void;
  onUpdated: (memory: Memory) => void;
  /** Just checked or unchecked: lights up once in the section it moved to. */
  flash?: { id: string; n: number } | null;
  /** The row under the pointer and its vertical middle, for the line to its dot on the globe. */
  onRowHover?: (id: string | null, y?: number) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  // The box shows the new state at once; it snaps back if the server says no.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [showDone, setShowDone] = useState(false);

  const open = checklist.overdue.length + checklist.upcoming.length + checklist.undated.length;

  function setBusyFor(id: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function toggle(item: ChecklistItem) {
    const m = item.memory;
    if (busy.has(m.id)) return;
    const wantDone = !item.done;
    setBusyFor(m.id, true);
    setError(null);
    setOptimistic((prev) => ({ ...prev, [m.id]: wantDone }));

    const finish = () => {
      setBusyFor(m.id, false);
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
    };

    // PATCH replaces the whole text and has no version check. The row on
    // screen can be 15 seconds old, and a teammate or the AI may have changed
    // it since, so read the current text right before writing it back.
    const fresh = await searchMemories({ space_id: spaceId, project: m.project, category: m.category, expectedUserId: userId });
    const current = !isApiError(fresh) ? fresh.find((r) => r.id === m.id) : undefined;
    const base = current ?? m;
    if (current && (doneDate(current.content) !== null) === wantDone) {
      // Someone else already did it.
      finish();
      onUpdated(current);
      return;
    }

    const content = wantDone ? markDone(base.content, dayKey(now)) : reopen(base.content);
    if (content === null) {
      finish();
      setError({ code: "INVALID_CONTENT", message: "The memory is too long to add a done line. Shorten it first." });
      return;
    }
    const result = await updateMemory(
      m.id,
      { project: base.project, category: base.category, title: base.title, content },
      userId,
    );
    finish();
    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    onUpdated(result);
  }

  // A row that leaves its section keeps showing where it went: a ticked one
  // stays ticked and struck through while it closes, instead of flicking back.
  const doneNow = new Set(checklist.done.map((i) => i.memory.id));

  function row(item: ChecklistItem, leaving: boolean, index: number) {
    const m = item.memory;
    const checked = optimistic[m.id] ?? (leaving ? doneNow.has(m.id) : Boolean(item.done));
    const lit = flash?.id === m.id;
    const label = item.done
      ? `done ${shortDate(new Date(`${item.done}T12:00:00`), now)}`
      : item.due
        ? `${item.overdue ? "was due" : "due"} ${shortDate(item.due, now)}`
        : null;
    return (
      <Row
        key={m.id}
        leaving={leaving}
        index={index}
        innerClassName={`flex items-start gap-2.5 py-2 ${lit ? "flash -mx-2 rounded-md px-2" : ""}`}
        onHover={(y) => onRowHover?.(y === null ? null : m.id, y ?? 0)}
      >
        <input
          type="checkbox"
          className="tick mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          checked={checked}
          disabled={busy.has(m.id)}
          onChange={() => void toggle(item)}
          aria-label={item.done ? `Mark "${m.title}" as not done` : `Mark "${m.title}" as done`}
        />
        <button type="button" onClick={() => onOpen(m)} className="press min-w-0 flex-1 text-left">
          {/* The line is drawn through as the box is ticked, before the server has answered. */}
          <span className={`block truncate text-sm transition-colors ${checked ? "text-ink-3" : "text-ink"}`}>
            <span className="strike" data-on={checked}>
              {m.title}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: categoryVar(m.category) }} />
            <span className="truncate">
              {labelFor(m.category)} · {m.project}
            </span>
            {label ? (
              <span className={`shrink-0 ${item.overdue ? "font-medium text-danger" : ""}`}>· {label}</span>
            ) : null}
          </span>
        </button>
      </Row>
    );
  }

  const overdue = usePresenceList(checklist.overdue, (i) => i.memory.id, LEAVE_MS.row);
  const upcoming = usePresenceList(checklist.upcoming, (i) => i.memory.id, LEAVE_MS.row);
  const undated = usePresenceList(checklist.undated, (i) => i.memory.id, LEAVE_MS.row);
  const done = usePresenceList(checklist.done, (i) => i.memory.id, LEAVE_MS.row);

  function section(title: string, items: Presence<ChecklistItem>[], live: number) {
    if (items.length === 0) return null;
    return (
      <section className="px-4 pb-3">
        <h3 className="text-xs font-medium text-ink-3">
          {title}{" "}
          <span key={live} className="fade-in tnum inline-block">
            ({live})
          </span>
        </h3>
        <ul className="divide-y divide-line">{items.map((p, i) => row(p.item, p.leaving, i))}</ul>
      </section>
    );
  }

  return (
    <PanelShell
      label="Checklist"
      title="Checklist"
      subtitle={`${spaceName} · ${open} open${checklist.overdue.length ? ` · ${checklist.overdue.length} overdue` : ""}`}
      onClose={onClose}
    >
      {error ? (
        <div className="px-4 pb-2">
          <ErrorText code={error.code} message={error.message} />
        </div>
      ) : null}

      {open === 0 && checklist.done.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-3">
          No goals or deadlines in {spaceName} yet. They show up here as soon as one is saved.
        </p>
      ) : (
        <>
          {section("Overdue", overdue, checklist.overdue.length)}
          {section("Coming up", upcoming, checklist.upcoming.length)}
          {section("No date", undated, checklist.undated.length)}
          {checklist.done.length > 0 ? (
            <div className="fade-in px-4 pb-4">
              <button
                type="button"
                className="press text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline"
                aria-expanded={showDone}
                onClick={() => setShowDone((v) => !v)}
              >
                <span key={`${showDone}-${checklist.done.length}`} className="fade-in">
                  {showDone ? "Hide done" : `Show done (${checklist.done.length})`}
                </span>
              </button>
              <Collapsible open={showDone}>
                <ul className="mt-1 divide-y divide-line">{done.map((p, i) => row(p.item, p.leaving, i))}</ul>
              </Collapsible>
            </div>
          ) : null}
          <p className="px-4 pb-6 text-xs text-ink-3">
            Checking one off adds a line &quot;Done: date&quot; to the memory, so the AI knows it is finished.
            In a team everyone sees it, and the history shows who did it.
          </p>
        </>
      )}
    </PanelShell>
  );
}
