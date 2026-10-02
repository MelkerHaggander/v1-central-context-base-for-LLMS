"use client";

/**
 * Create and edit. docs/filip-auth.md is the contract: POST /api/memories to
 * create, PATCH /api/memories/:id to change. Title, content and category are
 * always required. Project is optional: a memory from Memories can stand alone;
 * saving from a project (or editing) still shows the project field.
 *
 * The limits below are the same ones boringcontext enforces,
 * checked in the same order (project, title, content, category), so the reader
 * sees the problem before the round trip instead of a bare INVALID_TITLE after
 * it. The server stays the authority: if it refuses anyway, its code and message
 * are shown as they came.
 *
 * Dates (29 Sep): a Deadline must have a real date and a Goal may have one,
 * picked in a date field, not typed as free text. It is saved as a last line
 * "Due: YYYY-MM-DD" (lib/due.ts), which the checklist reads first. A date in
 * the title or text that cannot exist ("32 oktober", "2026-02-30") stops the
 * save, whatever the category.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_HINT, CATEGORY_LABEL, DISPLAY_ORDER, categoryVar } from "@/lib/categories";
import { createMemory, updateMemory, type MemoryFields } from "@/lib/api";
import { dayKey, dueDate, withDue } from "@/lib/checklist";
import { DUE_MAX, DUE_MIN, dateRule, dueProblem, impossibleDateProblem, realDay, splitDue } from "@/lib/due";
import { projectMatch } from "@/lib/insights";
import { LIMITS, firstProblem } from "@/lib/validate-fields";
import { isApiError, type Category, type Memory } from "@/lib/types";
import { Button, CharCount, Collapsible, ErrorText, inputClass } from "./ui";

/** Where the editor starts from: the text without its Due line, and the date it had. */
function startingPoint(existing: Memory | null): { body: string; due: string; fromLine: boolean } {
  if (!existing) return { body: "", due: "", fromLine: false };
  if (!dateRule(existing.category)) return { body: existing.content, due: "", fromLine: false };
  const split = splitDue(existing.content);
  if (split.due) return { body: split.body, due: split.due, fromLine: true };
  // Saved before the date field: show the date the checklist reads from the text.
  const read = dueDate(existing);
  const iso = read ? dayKey(read) : "";
  return { body: existing.content, due: realDay(iso) ? iso : "", fromLine: false };
}

export type EditorTarget = { mode: "create"; project?: string } | { mode: "edit"; memory: Memory };

export function MemoryEditor({
  target,
  knownProjects,
  knownTitles = [],
  userId,
  spaceId,
  spaceName,
  onClose,
  onSaved,
  leaving = false,
}: {
  target: EditorTarget;
  knownProjects: readonly string[];
  /** Titles already used in the target project (or among free-standing memories). */
  knownTitles?: readonly string[];
  userId: string;
  /** v1.2: where a new memory goes. Edits keep their space; PATCH takes no space_id. */
  spaceId: string;
  spaceName: string;
  onClose: () => void;
  onSaved: (memory: Memory) => void;
  /** GlobeView keeps the editor mounted while it animates out. */
  leaving?: boolean;
}) {
  const existing = target.mode === "edit" ? target.memory : null;
  // From Memories: no project field — the memory stands alone. Editing a
  // free-standing memory hides it too; otherwise the autofocused field with
  // its suggestion list makes it far too easy to drop the memory into a
  // project by accident. Moving is the Move button's job.
  // From a project (or when editing one that has a project): show the field.
  const showProject =
    target.mode === "edit"
      ? Boolean(existing?.project.trim())
      : target.mode === "create" && Boolean(target.project?.trim());
  const [start] = useState(() => startingPoint(existing));
  const [today] = useState(() => dayKey(new Date()));

  const [project, setProject] = useState(existing?.project ?? (target.mode === "create" ? target.project ?? "" : ""));
  const [category, setCategory] = useState<string>(existing?.category ?? "fact");
  // The API refuses to turn an ordinary memory into a lesson afterwards
  // (LESSON_CATEGORY_REQUIRES_TOOL): lessons come from a chat. So an edit only
  // offers Lesson when the memory already is one. A new memory can be one.
  const offered: readonly Category[] =
    existing && existing.category !== "lesson" ? DISPLAY_ORDER.filter((c) => c !== "lesson") : DISPLAY_ORDER;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(start.body);
  const [due, setDue] = useState(start.due);
  // The date field's own flag: true while day, month or year is half typed.
  const [dueBad, setDueBad] = useState(false);
  const [dueTouched, setDueTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The server reuses the saved spelling anyway (canonicalProject). Doing the same
  // here keeps an edit from looking like a project move when only the case differs.
  const match = projectMatch(project, knownProjects);
  const rule = dateRule(category);
  // The date is written only when it says something new: a date read from old
  // text and left alone stays in the text as it was.
  const writeDue = rule && realDay(due) && (start.fromLine || due !== start.due) ? due : null;
  const fields: MemoryFields = useMemo(
    () => ({
      project: match ?? project.trim(),
      category,
      title: title.trim(),
      content: withDue(writeDue ? splitDue(content).body.trim() : content.trim(), writeDue),
    }),
    [match, project, category, title, content, writeDue],
  );

  const dateIssue = dueProblem(category, due, dueBad);
  const textIssue = impossibleDateProblem(title, content);
  // Titles must be unique inside a project (and among free-standing memories).
  const titleClash =
    fields.title &&
    knownTitles.some(
      (t) =>
        t.trim().toLocaleLowerCase("sv-SE") === fields.title.toLocaleLowerCase("sv-SE") &&
        t.trim() !== (existing?.title ?? "").trim(),
    )
      ? "A memory with that title already exists in this project."
      : null;
  // The text itself must say something: a Due line alone is not content. Then
  // the whole saved text against the limits, then the dates.
  const problem =
    firstProblem({ ...fields, content: content.trim() }) ??
    firstProblem(fields) ??
    titleClash ??
    dateIssue ??
    textIssue;
  const dropsDate = !rule && start.fromLine;
  const past = !existing && rule !== null && realDay(due) !== null && due < today;
  const unchanged =
    existing !== null &&
    existing.project === fields.project &&
    existing.category === fields.category &&
    existing.title === fields.title &&
    existing.content === fields.content;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // Already saved and on its way out: a second Enter must not save again.
    if (leaving) return;
    if (problem) {
      setError({ message: problem });
      return;
    }
    setBusy(true);
    setError(null);

    const result = existing
      ? await updateMemory(
          existing.id,
          fields,
          userId,
          existing.project !== fields.project,
        )
      : await createMemory({ ...fields, space_id: spaceId }, userId);

    setBusy(false);
    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    onSaved(result);
  }

  return (
    <div
      inert={leaving || undefined}
      className={`${leaving ? "fade-out" : "fade-in"} fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-6`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "Edit memory" : "New memory"}
        className={`${leaving ? "dialog-out" : "dialog-in"} thin-scroll max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-2xl sm:rounded-2xl`}
      >
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">{existing ? "Edit memory" : "New memory"}</h2>
          {existing ? (
            <span className="font-mono text-[11px] text-ink-3">{existing.id}</span>
          ) : (
            <span className="text-xs text-ink-3">
              Saving to <strong className="font-medium text-ink-2">{spaceName}</strong>
            </span>
          )}
        </div>

        {showProject ? (
          <label className="mb-3 flex flex-col gap-1 text-sm">
            <span className="flex items-baseline justify-between">
              Project
              <CharCount value={project} max={LIMITS.project} />
            </span>
            <input
              ref={firstField}
              className={inputClass}
              list="known-projects"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="Project A"
              autoComplete="off"
            />
            <datalist id="known-projects">
              {knownProjects.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {match ? (
              <span className="text-xs text-ink-2">
                Goes into the existing project <strong>{match}</strong>. The server ignores case, spaces
                and hyphens in project names.
              </span>
            ) : (
              <span className="text-xs text-ink-3">
                Case, spaces and hyphens do not matter: &quot;Boring Context&quot; and
                &quot;boringcontext&quot; are one project.
              </span>
            )}
          </label>
        ) : null}

        <fieldset className="mb-3">
          <legend className="mb-1.5 text-sm">Category</legend>
          <div className="flex flex-wrap gap-1.5">
            {offered.map((value: Category) => {
              const active = category === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCategory(value)}
                  aria-pressed={active}
                  title={CATEGORY_HINT[value]}
                  className={`press inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
                    active
                      ? "border-line-2 bg-surface-3 text-ink"
                      : "border-line bg-surface text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: categoryVar(value) }}
                  />
                  {CATEGORY_LABEL[value]}
                </button>
              );
            })}
          </div>
          <p key={category} className="fade-in mt-1.5 text-xs text-ink-3">
            {CATEGORY_HINT[category as Category]}
          </p>
          {dropsDate && due ? (
            <p className="fade-in mt-1 text-xs text-ink-2">
              {CATEGORY_LABEL[category as Category]} has no date, so the line &quot;Due: {due}&quot; is left out.
            </p>
          ) : null}
        </fieldset>

        <Collapsible open={rule !== null} className="pb-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-baseline justify-between">
              {rule === "optional" ? "Target date" : "Due date"}
              <span className="text-xs text-ink-3">{rule === "optional" ? "Optional" : "Required"}</span>
            </span>
            <input
              type="date"
              className={`${inputClass} tnum ${dueTouched && dateIssue ? "border-danger/60" : ""}`}
              value={due}
              min={DUE_MIN}
              max={DUE_MAX}
              required={rule === "required"}
              aria-invalid={Boolean(dueTouched && dateIssue)}
              aria-describedby="due-help"
              onChange={(event) => {
                setDue(event.target.value);
                setDueBad(event.currentTarget.validity.badInput);
              }}
              // A half-typed date keeps value "" and fires no change, so the
              // field's own validity is read on every keystroke and on leave.
              onInput={(event) => setDueBad(event.currentTarget.validity.badInput)}
              onBlur={(event) => {
                setDueBad(event.currentTarget.validity.badInput);
                setDueTouched(true);
              }}
            />
            <span
              id="due-help"
              key={dueTouched && dateIssue ? dateIssue : past ? "past" : "help"}
              className={`fade-in text-xs ${dueTouched && dateIssue ? "text-danger" : past ? "text-ink-2" : "text-ink-3"}`}
            >
              {dueTouched && dateIssue
                ? dateIssue
                : past
                  ? "That date has already passed. It will show as overdue in the checklist."
                  : `Saved as the line "Due: ${realDay(due) ? due : "YYYY-MM-DD"}" at the end of the text, so the checklist and the AI read the same date.`}
            </span>
          </label>
        </Collapsible>

        <label className="mb-3 flex flex-col gap-1 text-sm">
          <span className="flex items-baseline justify-between">
            Title
            <CharCount value={title} max={LIMITS.title} />
          </span>
          <input
            ref={showProject ? undefined : firstField}
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Launch date"
          />
        </label>

        <label className="mb-4 flex flex-col gap-1 text-sm">
          <span className="flex items-baseline justify-between">
            Content
            <CharCount value={content} max={LIMITS.content} />
          </span>
          <textarea
            className={`${inputClass} min-h-32 resize-y ${textIssue ? "border-danger/60" : ""}`}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={rule ? "We launch at the fair in Gothenburg." : "We launch on 15 October 2026."}
            aria-invalid={Boolean(textIssue)}
            aria-describedby={textIssue ? "text-date-problem" : undefined}
          />
          {textIssue ? (
            <span id="text-date-problem" className="fade-in text-xs text-danger">
              {textIssue}
            </span>
          ) : null}
        </label>

        {error ? <ErrorText code={error.code} message={error.message} /> : null}
        {!error && problem ? <p className="fade-in text-xs text-danger">{problem}</p> : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="quiet" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={busy || Boolean(problem) || unchanged}>
            {busy ? "Saving…" : existing ? "Save changes" : "Save memory"}
          </Button>
        </div>

        {unchanged ? (
          <p className="fade-in mt-2 text-right text-xs text-ink-3">Nothing changed yet.</p>
        ) : null}
      </form>
    </div>
  );
}
